create extension if not exists pgcrypto;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null,
  price_cents integer not null check (price_cents > 0),
  image_url text not null,
  category text not null,
  inventory integer not null default 0 check (inventory >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cart_id, product_id)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_name text not null,
  customer_email text not null,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  status text not null default 'paid' check (status in ('paid', 'fulfilled', 'cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null,
  unit_price_cents integer not null check (unit_price_cents > 0),
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now()
);

create index if not exists cart_items_cart_id_idx on public.cart_items(cart_id);
create index if not exists cart_items_product_id_idx on public.cart_items(product_id);
create index if not exists orders_user_id_idx on public.orders(user_id);
create index if not exists order_items_order_id_idx on public.order_items(order_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_carts_updated_at on public.carts;
create trigger set_carts_updated_at
before update on public.carts
for each row execute function public.set_updated_at();

drop trigger if exists set_cart_items_updated_at on public.cart_items;
create trigger set_cart_items_updated_at
before update on public.cart_items
for each row execute function public.set_updated_at();

alter table public.products enable row level security;
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

drop policy if exists "Products are readable by everyone" on public.products;
create policy "Products are readable by everyone"
on public.products for select
using (true);

drop policy if exists "Users can read their own cart" on public.carts;
create policy "Users can read their own cart"
on public.carts for select
using (auth.uid() = user_id);

drop policy if exists "Users can create their own cart" on public.carts;
create policy "Users can create their own cart"
on public.carts for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own cart" on public.carts;
create policy "Users can update their own cart"
on public.carts for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can read their own cart items" on public.cart_items;
create policy "Users can read their own cart items"
on public.cart_items for select
using (
  exists (
    select 1
    from public.carts
    where carts.id = cart_items.cart_id
      and carts.user_id = auth.uid()
  )
);

drop policy if exists "Users can create their own cart items" on public.cart_items;
create policy "Users can create their own cart items"
on public.cart_items for insert
with check (
  exists (
    select 1
    from public.carts
    where carts.id = cart_items.cart_id
      and carts.user_id = auth.uid()
  )
);

drop policy if exists "Users can update their own cart items" on public.cart_items;
create policy "Users can update their own cart items"
on public.cart_items for update
using (
  exists (
    select 1
    from public.carts
    where carts.id = cart_items.cart_id
      and carts.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.carts
    where carts.id = cart_items.cart_id
      and carts.user_id = auth.uid()
  )
);

drop policy if exists "Users can delete their own cart items" on public.cart_items;
create policy "Users can delete their own cart items"
on public.cart_items for delete
using (
  exists (
    select 1
    from public.carts
    where carts.id = cart_items.cart_id
      and carts.user_id = auth.uid()
  )
);

drop policy if exists "Users can read their own orders" on public.orders;
create policy "Users can read their own orders"
on public.orders for select
using (auth.uid() = user_id);

drop policy if exists "Users can read their own order items" on public.order_items;
create policy "Users can read their own order items"
on public.order_items for select
using (
  exists (
    select 1
    from public.orders
    where orders.id = order_items.order_id
      and orders.user_id = auth.uid()
  )
);

grant select on public.products to anon, authenticated;
grant select, insert, update on public.carts to authenticated;
grant select, insert, update, delete on public.cart_items to authenticated;
grant select on public.orders to authenticated;
grant select on public.order_items to authenticated;

create or replace function public.checkout_cart(
  customer_name text,
  customer_email text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  active_cart_id uuid;
  current_user_id uuid := auth.uid();
  item_count integer;
  new_order_id uuid;
  subtotal integer;
begin
  if current_user_id is null then
    raise exception 'Authentication is required to check out.'
      using errcode = '28000';
  end if;

  if nullif(trim(customer_name), '') is null then
    raise exception 'Customer name is required.'
      using errcode = '22023';
  end if;

  if nullif(trim(customer_email), '') is null then
    raise exception 'Customer email is required.'
      using errcode = '22023';
  end if;

  select id
  into active_cart_id
  from public.carts
  where user_id = current_user_id;

  if active_cart_id is null then
    raise exception 'Cart not found.'
      using errcode = '22023';
  end if;

  perform 1
  from public.products p
  join public.cart_items ci on ci.product_id = p.id
  where ci.cart_id = active_cart_id
  for update of p;

  select count(*), coalesce(sum(ci.quantity * p.price_cents), 0)::integer
  into item_count, subtotal
  from public.cart_items ci
  join public.products p on p.id = ci.product_id
  where ci.cart_id = active_cart_id;

  if item_count = 0 then
    raise exception 'Cannot check out an empty cart.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.cart_items ci
    join public.products p on p.id = ci.product_id
    where ci.cart_id = active_cart_id
      and p.inventory < ci.quantity
  ) then
    raise exception 'One or more items are no longer available in the requested quantity.'
      using errcode = '22023';
  end if;

  insert into public.orders (
    user_id,
    customer_name,
    customer_email,
    subtotal_cents
  )
  values (
    current_user_id,
    trim(customer_name),
    lower(trim(customer_email)),
    subtotal
  )
  returning id into new_order_id;

  insert into public.order_items (
    order_id,
    product_id,
    product_name,
    unit_price_cents,
    quantity
  )
  select
    new_order_id,
    p.id,
    p.name,
    p.price_cents,
    ci.quantity
  from public.cart_items ci
  join public.products p on p.id = ci.product_id
  where ci.cart_id = active_cart_id;

  update public.products p
  set inventory = p.inventory - ci.quantity
  from public.cart_items ci
  where ci.cart_id = active_cart_id
    and ci.product_id = p.id;

  delete from public.cart_items
  where cart_id = active_cart_id;

  return new_order_id;
end;
$$;

revoke all on function public.checkout_cart(text, text) from public;
grant execute on function public.checkout_cart(text, text) to authenticated;

insert into public.products (name, description, price_cents, image_url, category, inventory)
values
  (
    'Everyday Tote',
    'A sturdy canvas tote with reinforced straps for daily errands.',
    4200,
    'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=80',
    'Bags',
    18
  ),
  (
    'Desk Plant Trio',
    'Three low-maintenance plants that brighten workspaces and shelves.',
    3600,
    'https://images.unsplash.com/photo-1485955900006-10f4d324d411?auto=format&fit=crop&w=900&q=80',
    'Home',
    14
  ),
  (
    'Ceramic Pour Over',
    'A hand-glazed brewer designed for smooth, balanced morning coffee.',
    5800,
    'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=80',
    'Kitchen',
    10
  ),
  (
    'Travel Tumbler',
    'Double-wall insulated steel for coffee, tea, and cold drinks on the go.',
    3100,
    'https://images.unsplash.com/photo-1542556398-95fb5b9f9b57?auto=format&fit=crop&w=900&q=80',
    'Kitchen',
    22
  ),
  (
    'Linen Notebook',
    'A lay-flat notebook with dotted pages and a durable linen cover.',
    1800,
    'https://images.unsplash.com/photo-1517842645767-c639042777db?auto=format&fit=crop&w=900&q=80',
    'Stationery',
    30
  ),
  (
    'Brass Pen',
    'A refillable brass pen with a satisfying weight and smooth ink flow.',
    2700,
    'https://images.unsplash.com/photo-1583485088034-697b5bc54ccd?auto=format&fit=crop&w=900&q=80',
    'Stationery',
    16
  )
on conflict (name) do nothing;
