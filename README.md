# SupaCart

A Vite + React + TypeScript shopping cart backed by Supabase. The app uses GitHub OAuth, row-level-security-protected cart tables, seeded products, and a Postgres checkout function that creates orders and decrements inventory atomically.

## Features

- Product catalog loaded from Supabase
- Category filters and stock-aware add-to-cart buttons
- Shop-page cart preview with quick quantity controls
- Dedicated shopping cart page for review and checkout
- Persistent per-user carts using Supabase GitHub login
- Quantity controls, cart subtotal, and checkout form
- `checkout_cart` Postgres RPC for order creation and inventory validation

## Supabase setup

1. Create a Supabase project.
2. Enable GitHub in **Authentication > Providers > GitHub**.
3. Create a GitHub OAuth app with this callback URL:

```text
https://oloocptvdvacubknnvbq.supabase.co/auth/v1/callback
```

4. Add the GitHub OAuth app's client ID and client secret to the Supabase GitHub provider settings.
5. Add the local and GitHub Pages URLs to **Authentication > URL Configuration > Redirect URLs**:

```text
http://localhost:5173/
https://zachtsch.github.io/shopping-cart/
```

6. Run `supabase/migrations/20260506131427_create_shopping_cart.sql` in the Supabase SQL editor or with the Supabase CLI. This creates six starter products: Everyday Tote, Desk Plant Trio, Ceramic Pour Over, Travel Tumbler, Linen Notebook, and Brass Pen.
7. Copy `.env.example` to `.env.local` and fill in your project URL and publishable or anon key:

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
