# SupaCart

A Vite + React + TypeScript shopping cart backed by Supabase. The app uses anonymous Supabase auth, row-level-security-protected cart tables, seeded products, and a Postgres checkout function that creates orders and decrements inventory atomically.

## Features

- Product catalog loaded from Supabase
- Category filters and stock-aware add-to-cart buttons
- Persistent guest carts using Supabase anonymous auth
- Quantity controls, cart subtotal, and checkout form
- `checkout_cart` Postgres RPC for order creation and inventory validation

## Supabase setup

1. Create a Supabase project.
2. Enable anonymous sign-ins in **Authentication > Providers > Anonymous sign-ins**.
3. Run `supabase/migrations/20260506131427_create_shopping_cart.sql` in the Supabase SQL editor or with the Supabase CLI. This creates six starter products: Everyday Tote, Desk Plant Trio, Ceramic Pour Over, Travel Tumbler, Linen Notebook, and Brass Pen.
4. Copy `.env.example` to `.env.local` and fill in your project URL and publishable or anon key:

```bash
cp .env.example .env.local
```

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
```

## Local development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## GitHub Pages

The repository includes a GitHub Actions workflow that builds and deploys the app to GitHub Pages. Add a repository secret named `SUPABASE_ANON_KEY` with your Supabase publishable key before the first deployment.

## License

MIT
