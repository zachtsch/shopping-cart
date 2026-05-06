import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  LogIn,
  LogOut,
  Loader2,
  Minus,
  PackageCheck,
  Plus,
  ShoppingCart,
  Sparkles,
  Store,
  Trash2,
} from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import './App.css'
import { hasSupabaseConfig, supabase } from './lib/supabase'

const PRODUCT_COLUMNS =
  'id, name, description, price_cents, image_url, category, inventory'

type Product = {
  id: string
  name: string
  description: string
  price_cents: number
  image_url: string
  category: string
  inventory: number
}

type CartItem = {
  id: string
  quantity: number
  product: Product
}

type CartItemRow = {
  id: string
  quantity: number
  product: Product | Product[] | null
}

const currencyFormatter = new Intl.NumberFormat('en-US', {
  currency: 'USD',
  style: 'currency',
})

function formatCurrency(cents: number) {
  return currencyFormatter.format(cents / 100)
}

function normalizeProduct(value: Product | Product[] | null) {
  return Array.isArray(value) ? value[0] : value
}

function getErrorMessage(error: unknown) {
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }

  return 'Something went wrong. Please try again.'
}

function isMissingSchemaError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase()

  return (
    message.includes('schema cache') &&
    (message.includes('public.products') ||
      message.includes('public.carts') ||
      message.includes('public.cart_items'))
  )
}

function App() {
  const [products, setProducts] = useState<Product[]>([])
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [cartId, setCartId] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [error, setError] = useState('')
  const [orderId, setOrderId] = useState<string | null>(null)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isCheckingOut, setIsCheckingOut] = useState(false)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [busyProductId, setBusyProductId] = useState<string | null>(null)

  const loadProducts = useCallback(async () => {
    if (!supabase) {
      return
    }

    const { data, error: productsError } = await supabase
      .from('products')
      .select(PRODUCT_COLUMNS)
      .order('category', { ascending: true })
      .order('name', { ascending: true })

    if (productsError) {
      throw productsError
    }

    setProducts((data ?? []) as Product[])
  }, [])

  const loadCart = useCallback(async (activeCartId: string) => {
    if (!supabase) {
      return
    }

    const { data, error: cartError } = await supabase
      .from('cart_items')
      .select(`id, quantity, product:products(${PRODUCT_COLUMNS})`)
      .eq('cart_id', activeCartId)
      .order('created_at', { ascending: true })

    if (cartError) {
      throw cartError
    }

    const rows = (data ?? []) as CartItemRow[]
    const items = rows.flatMap((row) => {
      const product = normalizeProduct(row.product)
      return product ? [{ id: row.id, product, quantity: row.quantity }] : []
    })

    setCartItems(items)
  }, [])

  const bootstrap = useCallback(async () => {
    if (!hasSupabaseConfig || !supabase) {
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError('')
    setNeedsMigration(false)

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession()

      if (sessionError) {
        throw sessionError
      }

      let user = session?.user ?? null

      if (!user) {
        const { data: signInData, error: signInError } =
          await supabase.auth.signInAnonymously()

        if (signInError) {
          throw new Error(
            `Anonymous sign-in failed. Enable anonymous sign-ins in Supabase Auth settings. ${signInError.message}`,
          )
        }

        user = signInData.user
      }

      if (!user) {
        throw new Error('Supabase did not return an authenticated guest user.')
      }

      setCurrentUser(user)
      setCustomerEmail(user.email ?? '')
      setCustomerName(
        typeof user.user_metadata.full_name === 'string'
          ? user.user_metadata.full_name
          : 'Guest Shopper',
      )

      const { data: cart, error: cartError } = await supabase
        .from('carts')
        .upsert({ user_id: user.id }, { onConflict: 'user_id' })
        .select('id')
        .single()

      if (cartError) {
        throw cartError
      }

      const activeCartId = (cart as { id: string }).id
      setCartId(activeCartId)
      await Promise.all([loadProducts(), loadCart(activeCartId)])
    } catch (bootstrapError) {
      if (isMissingSchemaError(bootstrapError)) {
        setNeedsMigration(true)
        setError('')
      } else {
        setError(getErrorMessage(bootstrapError))
      }
    } finally {
      setIsLoading(false)
    }
  }, [loadCart, loadProducts])

  useEffect(() => {
    const bootstrapTimer = window.setTimeout(() => {
      void bootstrap()
    }, 0)

    return () => window.clearTimeout(bootstrapTimer)
  }, [bootstrap])

  const categories = useMemo(
    () => ['All', ...Array.from(new Set(products.map((product) => product.category)))],
    [products],
  )

  const visibleProducts = useMemo(() => {
    if (selectedCategory === 'All') {
      return products
    }

    return products.filter((product) => product.category === selectedCategory)
  }, [products, selectedCategory])

  const subtotalCents = useMemo(
    () =>
      cartItems.reduce(
        (total, item) => total + item.product.price_cents * item.quantity,
        0,
      ),
    [cartItems],
  )

  const cartQuantity = useMemo(
    () => cartItems.reduce((total, item) => total + item.quantity, 0),
    [cartItems],
  )

  const getProductQuantity = useCallback(
    (productId: string) =>
      cartItems.find((item) => item.product.id === productId)?.quantity ?? 0,
    [cartItems],
  )

  const refreshCart = useCallback(async () => {
    if (!cartId) {
      return
    }

    await loadCart(cartId)
  }, [cartId, loadCart])

  const handleSignIn = async () => {
    if (!supabase) {
      setError('Connect Supabase before starting a guest cart.')
      return
    }

    setIsSigningIn(true)
    setError('')

    const { error: signInError } = await supabase.auth.signInAnonymously()

    if (signInError) {
      setError(
        `Anonymous sign-in failed. Enable anonymous sign-ins in Supabase Auth settings. ${signInError.message}`,
      )
      setIsSigningIn(false)
      return
    }

    await bootstrap()
    setIsSigningIn(false)
  }

  const handleSignOut = async () => {
    if (!supabase) {
      setError('Connect Supabase before signing out.')
      return
    }

    setIsSigningOut(true)
    setError('')

    try {
      const { error: signOutError } = await supabase.auth.signOut()

      if (signOutError) {
        throw signOutError
      }

      setCurrentUser(null)
      setCartId(null)
      setCartItems([])
      setOrderId(null)
      setCustomerName('')
      setCustomerEmail('')
      await loadProducts()
    } catch (signOutError) {
      setError(getErrorMessage(signOutError))
    } finally {
      setIsSigningOut(false)
    }
  }

  const handleAddItem = async (product: Product) => {
    if (!supabase || !cartId) {
      await handleSignIn()
      return
    }

    const existingItem = cartItems.find((item) => item.product.id === product.id)
    const nextQuantity = (existingItem?.quantity ?? 0) + 1

    if (nextQuantity > product.inventory) {
      setError(`Only ${product.inventory} ${product.name} available.`)
      return
    }

    setBusyProductId(product.id)
    setError('')
    setOrderId(null)

    try {
      if (existingItem) {
        const { error: updateError } = await supabase
          .from('cart_items')
          .update({ quantity: nextQuantity })
          .eq('id', existingItem.id)

        if (updateError) {
          throw updateError
        }
      } else {
        const { error: insertError } = await supabase
          .from('cart_items')
          .insert({ cart_id: cartId, product_id: product.id, quantity: 1 })

        if (insertError) {
          throw insertError
        }
      }

      await refreshCart()
    } catch (cartError) {
      if (isMissingSchemaError(cartError)) {
        setNeedsMigration(true)
      } else {
        setError(getErrorMessage(cartError))
      }
    } finally {
      setBusyProductId(null)
    }
  }

  const handleQuantityChange = async (item: CartItem, nextQuantity: number) => {
    if (!supabase) {
      setError('Connect Supabase before editing the cart.')
      return
    }

    if (nextQuantity > item.product.inventory) {
      setError(`Only ${item.product.inventory} ${item.product.name} available.`)
      return
    }

    setBusyProductId(item.product.id)
    setError('')

    try {
      if (nextQuantity <= 0) {
        const { error: deleteError } = await supabase
          .from('cart_items')
          .delete()
          .eq('id', item.id)

        if (deleteError) {
          throw deleteError
        }
      } else {
        const { error: updateError } = await supabase
          .from('cart_items')
          .update({ quantity: nextQuantity })
          .eq('id', item.id)

        if (updateError) {
          throw updateError
        }
      }

      await refreshCart()
    } catch (cartError) {
      if (isMissingSchemaError(cartError)) {
        setNeedsMigration(true)
      } else {
        setError(getErrorMessage(cartError))
      }
    } finally {
      setBusyProductId(null)
    }
  }

  const handleCheckout = async () => {
    if (!supabase || !cartId) {
      setError('Connect Supabase before checking out.')
      return
    }

    if (cartItems.length === 0) {
      setError('Add an item before checking out.')
      return
    }

    if (!customerName.trim() || !customerEmail.trim()) {
      setError('Enter a customer name and email before checking out.')
      return
    }

    setIsCheckingOut(true)
    setError('')
    setOrderId(null)

    try {
      const { data, error: checkoutError } = await supabase.rpc('checkout_cart', {
        customer_email: customerEmail.trim(),
        customer_name: customerName.trim(),
      })

      if (checkoutError) {
        throw checkoutError
      }

      setOrderId(String(data))
      setCustomerName('')
      setCustomerEmail('')
      await Promise.all([loadProducts(), loadCart(cartId)])
    } catch (checkoutError) {
      if (isMissingSchemaError(checkoutError)) {
        setNeedsMigration(true)
      } else {
        setError(getErrorMessage(checkoutError))
      }
    } finally {
      setIsCheckingOut(false)
    }
  }

  if (!hasSupabaseConfig) {
    return (
      <main className="app-shell setup-shell">
        <section className="setup-card">
          <div className="badge">
            <Store size={16} />
            Supabase setup required
          </div>
          <h1>Plug in your Supabase backend to start selling.</h1>
          <p>
            Create a Supabase project, run the SQL migration in
            <code> supabase/migrations</code>, then add these values to a local
            <code> .env.local</code> file.
          </p>
          <pre>{`VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key`}</pre>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <header className="hero">
        <nav className="topbar">
          <a className="brand" href="/" aria-label="Home">
            <span className="brand-mark">
              <Store size={22} />
            </span>
            SupaCart
          </a>
          <div className="topbar-actions">
            {currentUser ? (
              <>
                <span className="user-pill">
                  {currentUser.email ?? 'Guest shopper'}
                </span>
                <button
                  className="cart-pill auth-button"
                  disabled={isSigningOut}
                  onClick={() => void handleSignOut()}
                  type="button"
                >
                  {isSigningOut ? (
                    <Loader2 className="spin" size={18} />
                  ) : (
                    <LogOut size={18} />
                  )}
                  Reset guest
                </button>
              </>
            ) : (
              <button
                className="cart-pill auth-button"
                disabled={isSigningIn}
                onClick={() => void handleSignIn()}
                type="button"
              >
                {isSigningIn ? (
                  <Loader2 className="spin" size={18} />
                ) : (
                  <LogIn size={18} />
                )}
                Start guest cart
              </button>
            )}
            <a className="cart-pill" href="#cart">
              <ShoppingCart size={18} />
              {cartQuantity} item{cartQuantity === 1 ? '' : 's'}
            </a>
          </div>
        </nav>

        <div className="hero-grid">
          <section>
            <div className="badge">
              <Sparkles size={16} />
              Supabase-powered storefront
            </div>
            <h1>Fresh finds, instant carts, and reliable checkout.</h1>
            <p>
              Browse the catalog, persist a cart to Supabase, and convert it into
              an order with inventory checks handled in Postgres.
            </p>
            {!currentUser ? (
              <button
                className="hero-login"
                disabled={isSigningIn}
                onClick={() => void handleSignIn()}
                type="button"
              >
                {isSigningIn ? (
                  <Loader2 className="spin" size={18} />
                ) : (
                  <LogIn size={18} />
                )}
                Start a guest cart
              </button>
            ) : null}
          </section>

          <aside className="hero-stat" aria-label="Cart summary">
            <span>Cart total</span>
            <strong>{formatCurrency(subtotalCents)}</strong>
            <small>{cartQuantity} item{cartQuantity === 1 ? '' : 's'} ready</small>
          </aside>
        </div>
      </header>

      {error ? <div className="alert">{error}</div> : null}
      {needsMigration ? (
        <section className="migration-card">
          <div className="badge">
            <Store size={16} />
            Backend migration required
          </div>
          <h2>Create the Supabase tables and starter products</h2>
          <p>
            Your app is connected to Supabase, but the shopping tables do not
            exist yet. Run this file in the Supabase SQL editor:
          </p>
          <code>supabase/migrations/20260506131427_create_shopping_cart.sql</code>
          <p>
            It creates the catalog, carts, orders, RLS policies, checkout RPC,
            and six starter products that can be added to the cart.
          </p>
        </section>
      ) : null}
      {orderId ? (
        <div className="success">
          <PackageCheck size={20} />
          Order created: <strong>{orderId.slice(0, 8)}</strong>
        </div>
      ) : null}

      {isLoading ? (
        <section className="loading-state">
          <Loader2 className="spin" size={28} />
          Loading your storefront...
        </section>
      ) : (
        <div className="commerce-layout">
          <section className="catalog" aria-labelledby="catalog-title">
            <div className="section-heading">
              <div>
                <p>Catalog</p>
                <h2 id="catalog-title">Shop products</h2>
              </div>
              <div className="category-tabs" aria-label="Filter products by category">
                {categories.map((category) => (
                  <button
                    className={selectedCategory === category ? 'active' : ''}
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    type="button"
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>

            {visibleProducts.length === 0 ? (
              <div className="empty-catalog">
                <Store size={34} />
                <strong>No products yet</strong>
                <span>
                  Run the Supabase migration to create the catalog and seed the
                  starter products.
                </span>
              </div>
            ) : (
              <div className="product-grid">
                {visibleProducts.map((product) => {
                  const quantity = getProductQuantity(product.id)
                  const isBusy = busyProductId === product.id
                  const isSoldOut = product.inventory === 0

                  return (
                    <article className="product-card" key={product.id}>
                      <img src={product.image_url} alt="" />
                      <div className="product-body">
                        <span>{product.category}</span>
                        <h3>{product.name}</h3>
                        <p>{product.description}</p>
                      </div>
                      <div className="product-footer">
                        <div>
                          <strong>{formatCurrency(product.price_cents)}</strong>
                          <small>
                            {product.inventory} in stock
                            {quantity ? ` • ${quantity} in cart` : ''}
                          </small>
                        </div>
                        <button
                          className="primary-action"
                          disabled={
                            isBusy ||
                            isSigningIn ||
                            isSoldOut ||
                            quantity >= product.inventory
                          }
                          onClick={() => void handleAddItem(product)}
                          type="button"
                        >
                          {isBusy || isSigningIn ? (
                            <Loader2 className="spin" size={18} />
                          ) : currentUser ? (
                            <Plus size={18} />
                          ) : (
                            <LogIn size={18} />
                          )}
                          {isSoldOut ? 'Sold out' : currentUser ? 'Add' : 'Start cart'}
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          <aside className="cart-panel" id="cart" aria-labelledby="cart-title">
            <div className="section-heading">
              <div>
                <p>Checkout</p>
                <h2 id="cart-title">Your cart</h2>
              </div>
              <ShoppingCart size={24} />
            </div>

            {!currentUser ? (
              <div className="empty-cart">
                <LogIn size={34} />
                <strong>Start a guest cart</strong>
                <span>Anonymous auth creates your private Supabase cart.</span>
                <button
                  className="checkout-button"
                  disabled={isSigningIn}
                  onClick={() => void handleSignIn()}
                  type="button"
                >
                  {isSigningIn ? <Loader2 className="spin" size={18} /> : null}
                  Start guest cart
                </button>
              </div>
            ) : cartItems.length === 0 ? (
              <div className="empty-cart">
                <ShoppingCart size={34} />
                <strong>Your cart is empty</strong>
                <span>Add a product to start an order.</span>
              </div>
            ) : (
              <div className="cart-items">
                {cartItems.map((item) => (
                  <article className="cart-item" key={item.id}>
                    <img src={item.product.image_url} alt="" />
                    <div>
                      <h3>{item.product.name}</h3>
                      <span>
                        {formatCurrency(item.product.price_cents)} each
                      </span>
                      <div className="quantity-controls">
                        <button
                          aria-label={`Decrease ${item.product.name}`}
                          disabled={busyProductId === item.product.id}
                          onClick={() =>
                            void handleQuantityChange(item, item.quantity - 1)
                          }
                          type="button"
                        >
                          <Minus size={14} />
                        </button>
                        <strong>{item.quantity}</strong>
                        <button
                          aria-label={`Increase ${item.product.name}`}
                          disabled={
                            busyProductId === item.product.id ||
                            item.quantity >= item.product.inventory
                          }
                          onClick={() =>
                            void handleQuantityChange(item, item.quantity + 1)
                          }
                          type="button"
                        >
                          <Plus size={14} />
                        </button>
                        <button
                          aria-label={`Remove ${item.product.name}`}
                          disabled={busyProductId === item.product.id}
                          onClick={() => void handleQuantityChange(item, 0)}
                          type="button"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <strong>
                      {formatCurrency(item.product.price_cents * item.quantity)}
                    </strong>
                  </article>
                ))}
              </div>
            )}

            {currentUser ? (
              <>
                <div className="cart-total">
                  <span>Subtotal</span>
                  <strong>{formatCurrency(subtotalCents)}</strong>
                </div>

                <div className="checkout-form">
                  <label>
                    Name
                    <input
                      autoComplete="name"
                      onChange={(event) => setCustomerName(event.target.value)}
                      placeholder="Ada Lovelace"
                      value={customerName}
                    />
                  </label>
                  <label>
                    Email
                    <input
                      autoComplete="email"
                      onChange={(event) => setCustomerEmail(event.target.value)}
                      placeholder="ada@example.com"
                      type="email"
                      value={customerEmail}
                    />
                  </label>
                  <button
                    className="checkout-button"
                    disabled={isCheckingOut || cartItems.length === 0}
                    onClick={() => void handleCheckout()}
                    type="button"
                  >
                    {isCheckingOut ? <Loader2 className="spin" size={18} /> : null}
                    Create order
                  </button>
                </div>
              </>
            ) : null}
          </aside>
        </div>
      )}
    </main>
  )
}

export default App
