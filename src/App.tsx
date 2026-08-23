import { useEffect, useState, type FormEvent } from "react";
import { jsPDF } from "jspdf";
import "./App.css";

type Product = {
  id: number;
  name: string;
  category: string;
  price: number;
  mrp: number;
  pack: string;
  image: string;
};
type CartItem = Product & { quantity: number };
type OrderSelection = { product: Product; quantity: number };
const s3BaseUrl = "https://blast-crackers.s3.ap-south-1.amazonaws.com/";

const seed: Product[] = [
  {
    id: 1,
    name: '2 3/4" Kuruvai Crackers',
    category: "One Sound Crackers",
    price: 9,
    mrp: 45,
    pack: "5 Pieces / Packet",
    image: `${s3BaseUrl}kuruvi_1.webp`,
  },
  {
    id: 2,
    name: '4" Lakshmi Crackers',
    category: "One Sound Crackers",
    price: 23,
    mrp: 115,
    pack: "5 Pieces / Packet",
    image:
      "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=160&q=80",
  },
  {
    id: 3,
    name: '4" Deluxe Lakshmi',
    category: "One Sound Crackers",
    price: 37,
    mrp: 185,
    pack: "5 Pieces / Packet",
    image:
      "https://images.unsplash.com/photo-1509228627152-72ae9ae6848d?auto=format&fit=crop&w=160&q=80",
  },
  {
    id: 4,
    name: '4" Deluxe Gold Lakshmi Crackers',
    category: "One Sound Crackers",
    price: 41,
    mrp: 205,
    pack: "5 Pieces / Packet",
    image:
      "https://images.unsplash.com/photo-1577083288073-40892c0860a4?auto=format&fit=crop&w=160&q=80",
  },
  {
    id: 5,
    name: "Colour Changing Flower Pots",
    category: "Flower Pots Crackers",
    price: 85,
    mrp: 300,
    pack: "5 Pieces / Box",
    image:
      "https://images.unsplash.com/photo-1533230399637-4f2a1d9d4f0c?auto=format&fit=crop&w=160&q=80",
  },
  {
    id: 6,
    name: "Whistling Moon",
    category: "Night Time Collection",
    price: 120,
    mrp: 400,
    pack: "10 Pieces / Box",
    image:
      "https://images.unsplash.com/photo-1464207687429-7505649dae38?auto=format&fit=crop&w=160&q=80",
  },
];
const defaultCategories = [
  "Kids Collection",
  "Day Time Collection",
  "Night Time Collection",
  "One Sound Crackers",
  "Flower Pots Crackers",
  "Ground Chakkars",
  "Fancy Ground Chakkars",
  "Fancy Fountains",
  "Peacock Fountains",
  "Fancy Repeating Fountains",
  "Bijili Bombs",
  "Wala Crackers (Garlands)",
  "Fancy Spinners",
];
const offers = [
  { threshold: 2000, discount: 250 },
  { threshold: 1000, discount: 100 },
];
const money = (n: number) => `₹${n.toLocaleString("en-IN")}`;
type View = "login" | "shop" | "cart" | "catalogue" | "order-entry";
const routeForView = (view: View) => ({ login: "#/login", shop: "#/", cart: "#/cart", catalogue: "#/catalogue", "order-entry": "#/order-entry" })[view];
const viewForRoute = (): View => {
  const route = ({ "#/": "shop", "#/cart": "cart", "#/catalogue": "catalogue", "#/login": "login", "#/order-entry": "order-entry" } as Record<string, View>)[window.location.hash] || "login";
  return route === "catalogue" && localStorage.getItem("blast-admin-session") !== "true" ? "login" : route;
};
const downloadCartPdf = (
  cart: CartItem[],
  subtotal: number,
  total: number,
  offer?: { threshold: number; discount: number },
) => {
  const pdf = new jsPDF();
  pdf.setFontSize(20);
  pdf.text("BLAST FIREWORKS", 15, 20);
  pdf.setFontSize(11);
  pdf.text(`Cart summary - ${new Date().toLocaleDateString("en-IN")}`, 15, 29);
  pdf.line(15, 34, 195, 34);
  let y = 45;
  const columns = [15, 28, 128, 145, 175];
  const widths = [13, 100, 17, 30, 20];
  const drawRow = (values: string[], height: number, bold = false) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    values.forEach((value, index) => {
      pdf.rect(columns[index], y - 6, widths[index], height);
      pdf.text(value, columns[index] + 2, y, { maxWidth: widths[index] - 4 });
    });
    y += height;
  };
  drawRow(["No.", "Product", "Qty", "Unit price", "Total"], 10, true);
  cart.forEach((item, index) => {
    const productName = pdf.splitTextToSize(`${item.name} (${item.pack})`, 96);
    const rowHeight = Math.max(10, productName.length * 5 + 5);
    if (y + rowHeight > 275) { pdf.addPage(); y = 20; drawRow(["No.", "Product", "Qty", "Unit price", "Total"], 10, true); }
    drawRow([String(index + 1), productName.join("\n"), String(item.quantity), `Rs. ${item.price}`, `Rs. ${item.price * item.quantity}`], rowHeight);
  });
  pdf.line(120, y, 195, y);
  y += 8;
  pdf.text(`Subtotal: Rs. ${subtotal}`, 145, y);
  y += 7;
  if (offer) {
    pdf.text(`Discount: -Rs. ${offer.discount}`, 145, y);
    y += 7;
  }
  pdf.setFont("helvetica", "bold");
  pdf.text(`Total: Rs. ${total}`, 145, y);
  pdf.save("blast-cart.pdf");
};
function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    localStorage.removeItem(key);
    return fallback;
  }
}

function App() {
  const [products, setProducts] = useState<Product[]>(() =>
    readStorage<Product[]>("blast-products", seed),
  );
  const [cart, setCart] = useState<CartItem[]>(() =>
    readStorage<CartItem[]>("blast-cart", []),
  );
  const [categories, setCategories] = useState<string[]>(() => readStorage<string[]>("blast-categories", defaultCategories));
  const [category, setCategory] = useState(() => readStorage<string[]>("blast-categories", defaultCategories).includes("One Sound Crackers") ? "One Sound Crackers" : readStorage<string[]>("blast-categories", defaultCategories)[0] || "");
  const [view, setView] = useState<View>(() => viewForRoute());
  const [authOpen, setAuthOpen] = useState(false);
  const [user, setUser] = useState<string | null>(() =>
    localStorage.getItem("blast-user"),
  );
  useEffect(() => {
    localStorage.setItem("blast-products", JSON.stringify(products));
  }, [products]);
  useEffect(() => {
    localStorage.setItem("blast-categories", JSON.stringify(categories));
  }, [categories]);
  useEffect(() => {
    localStorage.setItem("blast-cart", JSON.stringify(cart));
  }, [cart]);
  const visible = products.filter((item) => item.category === category);
  const subtotal = cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  const offer = offers.find((item) => subtotal >= item.threshold);
  const total = subtotal - (offer?.discount || 0);
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  const changeQuantity = (product: Product, delta: number) =>
    setCart((items) => {
      const current =
        items.find((item) => item.id === product.id)?.quantity || 0;
      const next = Math.max(0, current + delta);
      return next === 0
        ? items.filter((item) => item.id !== product.id)
        : items.some((item) => item.id === product.id)
          ? items.map((item) =>
              item.id === product.id ? { ...item, quantity: next } : item,
            )
          : [...items, { ...product, quantity: next }];
    });
  const submitOrderSelections = (selections: OrderSelection[]) => setCart((items) => selections.reduce((nextItems, selection) => {
    const existing = nextItems.find((item) => item.id === selection.product.id);
    return existing
      ? nextItems.map((item) => item.id === selection.product.id ? { ...item, quantity: item.quantity + selection.quantity } : item)
      : [...nextItems, { ...selection.product, quantity: selection.quantity }];
  }, items));
  const navigate = (nextView: View, nextCategory?: string) => {
    setView(nextView);
    if (nextCategory) setCategory(nextCategory);
    window.history.pushState({}, "", routeForView(nextView));
  };
  const setShopView = (nextCategory?: string) => navigate("shop", nextCategory);
  useEffect(() => {
    const syncRoute = () => setView(viewForRoute());
    window.addEventListener("popstate", syncRoute);
    window.addEventListener("hashchange", syncRoute);
    return () => { window.removeEventListener("popstate", syncRoute); window.removeEventListener("hashchange", syncRoute); };
  }, []);
  const openAdmin = () => {
    if (user) navigate("catalogue");
    else setAuthOpen(true);
  };
  return (
    <div className="site-shell">
      {view !== "login" && (
        <header className="site-header">
          <button
            className="logo"
            onClick={() => setShopView("One Sound Crackers")}
          >
            <span className="logo-spark">✦</span>
            <span>
              BLAST<small>SPARK THE CELEBRATION</small>
            </span>
          </button>
          <nav>
            <button
              className={view === "shop" ? "nav-active" : ""}
              onClick={() => setShopView()}
            >
              Home
            </button>
            <button
              className={view === "shop" ? "nav-active" : ""}
              onClick={() => setShopView()}
            >
              Quick Enquiry
            </button>
            <button onClick={() => navigate("order-entry")}>Order Entry</button>
            <button onClick={() => setShopView("One Sound Crackers")}>
              Crackers
            </button>
            <button onClick={() => setShopView()}>Refer and Earn</button>
            <button onClick={() => setShopView()}>About</button>
            <button onClick={() => setShopView()}>Contact</button>
          </nav>
          <div className="header-tools">
            <button>English⌄</button>
            <button>⌖ Location</button>
            <button aria-label="Toggle theme">☼</button>
            <button
              className="header-cart"
              aria-label="Open cart"
              onClick={() => navigate("cart")}
            >
              🛒<b>{count}</b>
            </button>
          </div>
        </header>
      )}
      {view === "login" && (
        <AdminLogin
          onLogin={() => {
            localStorage.setItem("blast-admin-session", "true");
            navigate("catalogue");
          }}
        />
      )}
      {view === "shop" && (
        <main className="quick-order">
          <aside className="category-panel">
            <h3>CATEGORIES</h3>
            <select value={category} onChange={(event) => setShopView(event.target.value)} aria-label="Choose category">
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            {categories.map((item, index) => (
              <button
                className={category === item ? "category-active" : ""}
                key={item}
                onClick={() => setShopView(item)}
              >
                <span>
                  {
                    [
                      "♟",
                      "☀",
                      "☾",
                      "➳",
                      "✺",
                      "◉",
                      "◌",
                      "♨",
                      "➶",
                      "➶",
                      "✣",
                      "▧",
                      "⟳",
                    ][index]
                  }
                </span>
                {item}
              </button>
            ))}
          </aside>
          <section className="order-content">
            <div className="crumb">
              Home <span>/</span> Quick Enquiry
            </div>
            <div className="order-heading">
              <div>
                <h1>
                  Diwali Crackers Categories &amp; Price Overview{" "}
                  <span>(2026)</span>
                </h1>
                <p>
                  Prices may vary based on brand, packing, and seasonal demand.
                  For exact offers, please use the quick enquiry option.
                </p>
              </div>
              <button className="mobile-cart" onClick={() => navigate("cart")}>
                Cart ({count})
              </button>
            </div>
            <div className="table-wrap">
              <div className="table-title">
                <span>✺</span>
                <strong>{category}</strong>
              </div>
              <div className="table-head">
                <span>No.</span>
                <span>Product Name</span>
                <span>MRP</span>
                <span>Best Price</span>
                <span>Quantity</span>
                <span>Total</span>
              </div>
              {visible.map((product) => {
                const quantity =
                  cart.find((item) => item.id === product.id)?.quantity || 0;
                return (
                  <div className="product-row" key={product.id}>
                    <span>#{product.id}</span>
                    <div className="product-name">
                      <div
                        className="product-photo"
                        style={{ backgroundImage: `url(${product.image})` }}
                      />
                      <strong>{product.name}</strong>
                      <small>{product.pack}</small>
                      <span className="media-badges">▧ ●</span>
                    </div>
                    <del>{money(product.mrp)}</del>
                    <strong className="best-price">
                      {money(product.price)}
                    </strong>
                    <div className="stepper">
                      <button onClick={() => changeQuantity(product, -1)}>
                        −
                      </button>
                      <input
                        aria-label={`Quantity for ${product.name}`}
                        type="number"
                        min="0"
                        value={quantity || ""}
                        onChange={(event) =>
                          changeQuantity(
                            product,
                            Number(event.target.value || 0) - quantity,
                          )
                        }
                      />
                      <button onClick={() => changeQuantity(product, 1)}>
                        +
                      </button>
                    </div>
                    <strong>{money(product.price * quantity)}</strong>
                  </div>
                );
              })}
            </div>
          </section>
        </main>
      )}
      {view === "cart" && (
        <Cart
          cart={cart}
          subtotal={subtotal}
          total={total}
          offer={offer}
          count={count}
          onChange={changeQuantity}
          onBack={() => setShopView()}
          user={user}
          onLogin={() => setAuthOpen(true)}
        />
      )}
      {view === "order-entry" && (
        <OrderEntry products={products} onSubmit={(selections) => { submitOrderSelections(selections); navigate("cart"); }} onCart={() => navigate("cart")} />
      )}
      {view === "catalogue" && (
        <Catalogue
          products={products}
          setProducts={setProducts}
          categories={categories}
          setCategories={setCategories}
          onWebsite={() => setShopView()}
          onLogout={() => {
            localStorage.removeItem("blast-admin-session");
            navigate("login");
          }}
        />
      )}
      {view !== "login" && (
        <div className="floating-actions">
          <button className="whatsapp" aria-label="Contact BLAST">
            ☎
          </button>
          <button
            className="floating-cart"
            onClick={() => navigate("cart")}
            aria-label="Open cart"
          >
            🛒<b>{count}</b>
          </button>
        </div>
      )}
      <footer>
        <span>BLAST FIREWORKS</span>
        <span>Safe products. Bright celebrations.</span>
        {view !== "login" && (
          <button onClick={openAdmin}>Shop management</button>
        )}
      </footer>
      {authOpen && (
        <Auth
          onClose={() => setAuthOpen(false)}
          onAuth={(name) => {
            setUser(name);
            localStorage.setItem("blast-user", name);
            setAuthOpen(false);
          }}
        />
      )}
    </div>
  );
}

function OrderEntry({ products, onSubmit, onCart }: { products: Product[]; onSubmit: (selections: OrderSelection[]) => void; onCart: () => void }) {
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState("");
  const [selections, setSelections] = useState<OrderSelection[]>([]);
  const selected = products[Number(productId) - 1];
  const addItem = (event: FormEvent) => {
    event.preventDefault();
    if (!selected || quantity < 1) { setMessage("Enter a valid product ID and quantity."); return; }
    setSelections((items) => items.some((item) => item.product.id === selected.id)
      ? items.map((item) => item.product.id === selected.id ? { ...item, quantity: item.quantity + quantity } : item)
      : [...items, { product: selected, quantity }]);
    setMessage(`${selected.name} added to the selection.`);
    setProductId("");
    setQuantity(1);
  };
  return <main className="order-entry-page"><div className="entry-header"><div><p className="admin-kicker">BLAST / ORDER ENTRY</p><h1>Add items by product ID</h1><p>Select multiple products and quantities, then submit them together to the cart.</p></div><button className="download-pdf" onClick={onCart}>Go to cart</button></div><div className="order-entry-grid"><div><form className="order-entry-form" onSubmit={addItem}><label>Product ID<input type="number" min="1" max={products.length} value={productId} onChange={(event) => setProductId(event.target.value)} placeholder="Example: 1" required /></label><label>Quantity<div className="entry-stepper"><button type="button" onClick={() => setQuantity(Math.max(1, quantity - 1))}>−</button><input type="number" min="1" value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))} /><button type="button" onClick={() => setQuantity(quantity + 1)}>+</button></div></label>{selected && <div className="selected-product"><strong>#{Number(productId)} {selected.name}</strong><span>{selected.category} / {selected.pack} / {money(selected.price)}</span></div>}{message && <p className="entry-message">{message}</p>}<button className="save-product" type="submit">Add item</button></form></div><section className="entry-reference">{selections.length > 0 && <><h2>Selected items</h2>{selections.map((item) => <div className="entry-product selected-entry-product" key={item.product.id}><b>#{products.indexOf(item.product) + 1}</b><span>{item.product.name}<small>Qty {item.quantity} × {money(item.product.price)}</small></span><strong>{money(item.product.price * item.quantity)}</strong><button type="button" onClick={() => setSelections(selections.filter((selectedItem) => selectedItem.product.id !== item.product.id))}>Remove</button></div>)}<div className="selection-total"><span>Estimated total</span><strong>{money(selections.reduce((sum, item) => sum + item.product.price * item.quantity, 0))}</strong></div><button className="save-product" type="button" onClick={() => onSubmit(selections)}>Submit selected items to cart →</button></>}<h2>Product IDs</h2>{products.map((product, index) => <div className="entry-product" key={product.id}><b>#{index + 1}</b><span>{product.name}<small>{product.category}</small></span><strong>{money(product.price)}</strong></div>)}</section></div></main>;
}

function Cart({
  cart,
  subtotal,
  total,
  offer,
  count,
  onChange,
  onBack,
  user,
  onLogin,
}: {
  cart: CartItem[];
  subtotal: number;
  total: number;
  offer?: { threshold: number; discount: number };
  count: number;
  onChange: (product: Product, delta: number) => void;
  onBack: () => void;
  user: string | null;
  onLogin: () => void;
}) {
  return (
    <main className="cart-page">
      <button className="back-link" onClick={onBack}>
        ← Continue shopping
      </button>
      <div className="cart-heading">
        <h1>
          Your cart <span>({count} items)</span>
        </h1>
        <button
          className="download-pdf"
          disabled={!cart.length}
          onClick={() => downloadCartPdf(cart, subtotal, total, offer)}
        >
          Download PDF
        </button>
      </div>
      <div className="cart-grid">
        <section>
          {cart.length === 0 ? (
            <div className="empty-cart">
              Your cart is empty.
              <button onClick={onBack}>Browse crackers</button>
            </div>
          ) : (
            cart.map((item) => (
              <div className="cart-item" key={item.id}>
                <span className="item-number">#{item.id}</span>
                <div
                  className="product-photo"
                  style={{ backgroundImage: `url(${item.image})` }}
                />
                <div>
                  <strong>{item.name}</strong>
                  <small>
                    {money(item.price)} / {item.pack}
                  </small>
                </div>
                <div className="stepper">
                  <button onClick={() => onChange(item, -1)}>−</button>
                  <span>{item.quantity}</span>
                  <button onClick={() => onChange(item, 1)}>+</button>
                </div>
                <strong>{money(item.price * item.quantity)}</strong>
              </div>
            ))
          )}
        </section>
        <aside className="cart-summary">
          <h3>ORDER SUMMARY</h3>
          <p>
            Subtotal <b>{money(subtotal)}</b>
          </p>
          {offer && (
            <p className="discount">
              BLAST offer <b>-{money(offer.discount)}</b>
            </p>
          )}
          <hr />
          <h2>
            Total <b>{money(total)}</b>
          </h2>
          <p className="offer-note">
            {offer
              ? `You unlocked ₹${offer.discount} off!`
              : "Spend ₹1,000 to get ₹100 off."}
          </p>
          <button
            disabled={!cart.length}
            onClick={() =>
              user ? alert("Payment gateway ready for integration.") : onLogin()
            }
          >
            Proceed to payment →
          </button>
        </aside>
      </div>
    </main>
  );
}

function Auth({
  onClose,
  onAuth,
}: {
  onClose: () => void;
  onAuth: (name: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <div className="modal-backdrop">
      <form
        className="auth-box"
        onSubmit={(event) => {
          event.preventDefault();
          onAuth(name || "Customer");
        }}
      >
        <button type="button" className="close" onClick={onClose}>
          ×
        </button>
        <h2>Welcome to BLAST</h2>
        <p>Login or register to continue checkout.</p>
        <input required type="email" placeholder="Email address" />
        <input required type="password" placeholder="Password" />
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Your name"
        />
        <button type="submit">Continue →</button>
      </form>
    </div>
  );
}

function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (email === "admin@blast.in" && password === "Blast@123") onLogin();
    else setError("Incorrect admin email or password.");
  };
  return (
    <main className="admin-login-page">
      <div className="admin-login-card">
        <div className="admin-login-brand">
          <span>✦</span> BLAST
        </div>
        <p className="admin-kicker">STORE ADMINISTRATION</p>
        <h1>Welcome back.</h1>
        <p className="admin-intro">
          Sign in to update your crackers, rates, and customer catalogue.
        </p>
        <form onSubmit={submit}>
          <label>
            Admin email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@blast.in"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter password"
              required
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit">Sign in to dashboard →</button>
        </form>
        <p className="demo-hint">Demo access: admin@blast.in / Blast@123</p>
      </div>
      <div className="admin-login-art">
        <span>BLAST</span>
        <p>
          Products in.
          <br />
          Celebrations out.
        </p>
      </div>
    </main>
  );
}

function Catalogue({
  products,
  setProducts,
  categories,
  setCategories,
  onWebsite,
  onLogout,
}: {
  products: Product[];
  setProducts: (products: Product[]) => void;
  categories: string[];
  setCategories: (categories: string[]) => void;
  onWebsite: () => void;
  onLogout: () => void;
}) {
  const empty: Product = {
    id: 0,
    name: "",
    category: "One Sound Crackers",
    price: 0,
    mrp: 0,
    pack: "",
    image: seed[0].image,
  };
  const [draft, setDraft] = useState<Product>(empty);
  const [editing, setEditing] = useState<number | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const save = () => {
    if (!draft.name || draft.price <= 0 || draft.mrp <= 0 || !draft.pack)
      return;
    const saved = editing === null ? { ...draft, id: Date.now() } : draft;
    setProducts(
      editing === null
        ? [...products, saved]
        : products.map((product) => (product.id === editing ? saved : product)),
    );
    setDraft(empty);
    setEditing(null);
  };
  const edit = (product: Product) => {
    setDraft(product);
    setEditing(product.id);
  };
  const saveCategory = () => {
    const nextName = categoryName.trim();
    if (!nextName) return;
    if (editingCategory) {
      setCategories(categories.map((item) => item === editingCategory ? nextName : item));
      setProducts(products.map((product) => product.category === editingCategory ? { ...product, category: nextName } : product));
    } else if (!categories.includes(nextName)) setCategories([...categories, nextName]);
    setCategoryName("");
    setEditingCategory(null);
  };
  const deleteCategory = (name: string) => {
    if (window.confirm(`Delete ${name} and its products?`)) {
      setCategories(categories.filter((item) => item !== name));
      setProducts(products.filter((product) => product.category !== name));
    }
  };
  return (
    <main className="admin-page">
      <div className="admin-top">
        <div>
          <p className="admin-kicker">BLAST / SHOP CONTROL</p>
          <h1>Cracker catalogue</h1>
          <p>
            Update details here and they appear on the customer website
            immediately.
          </p>
        </div>
        <div className="admin-actions">
          <button onClick={onWebsite}>View customer site</button>
          <button onClick={onLogout}>Sign out</button>
        </div>
      </div>
      <section className="admin-editor">
        <h2>
          {editing === null ? "Add a new cracker" : "Edit cracker details"}
        </h2>
        <div className="editor-grid">
          <label>
            Product name
            <input
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
              placeholder="Example: 4 inch Lakshmi"
            />
          </label>
          <label>
            Category
            <select
              value={draft.category}
              onChange={(event) =>
                setDraft({ ...draft, category: event.target.value })
              }
            >
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            Pack detail
            <input
              value={draft.pack}
              onChange={(event) =>
                setDraft({ ...draft, pack: event.target.value })
              }
              placeholder="5 Pieces / Packet"
            />
          </label>
          <label>
            MRP (₹)
            <input
              type="number"
              value={draft.mrp || ""}
              onChange={(event) =>
                setDraft({ ...draft, mrp: Number(event.target.value) })
              }
            />
          </label>
          <label>
            Best price (₹)
            <input
              type="number"
              value={draft.price || ""}
              onChange={(event) =>
                setDraft({ ...draft, price: Number(event.target.value) })
              }
            />
          </label>
          <label>
            Upload product image
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () =>
                  setDraft({ ...draft, image: String(reader.result) });
                reader.readAsDataURL(file);
              }}
            />
          </label>
          <label>
            Image URL (optional)
            <input
              value={draft.image}
              onChange={(event) =>
                setDraft({ ...draft, image: event.target.value })
              }
              placeholder="Paste an image URL if not uploading"
            />
          </label>
        </div>
        <button className="save-product" onClick={save}>
          {editing === null ? "Add product" : "Save product"} →
        </button>
        {editing !== null && (
          <button
            className="cancel-edit"
            onClick={() => {
              setEditing(null);
              setDraft(empty);
            }}
          >
            Cancel
          </button>
        )}
      </section>
      <section className="admin-products category-manager">
        <div className="admin-products-head"><h2>Categories</h2><span>{categories.length} categories</span></div>
        <div className="category-form"><input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Category name" /><button onClick={saveCategory}>{editingCategory ? "Save category" : "Add category"}</button>{editingCategory && <button className="cancel-edit" onClick={() => { setEditingCategory(null); setCategoryName(""); }}>Cancel</button>}</div>
        {categories.map((item) => <div className="admin-category-row" key={item}><strong>{item}</strong><button onClick={() => { setEditingCategory(item); setCategoryName(item); }}>Edit</button><button onClick={() => deleteCategory(item)}>Delete</button></div>)}
      </section>
      <section className="admin-products">
        <div className="admin-products-head">
          <h2>Live products</h2>
          <span>{products.length} products</span>
        </div>
        {products.map((product) => (
          <div className="admin-product-row" key={product.id}>
            <div
              className="product-photo"
              style={{ backgroundImage: `url(${product.image})` }}
            />
            <div>
              <strong>{product.name}</strong>
              <small>
                {product.category} / {product.pack}
              </small>
            </div>
            <span>{money(product.price)}</span>
            <button onClick={() => edit(product)}>Edit</button>
            <button onClick={() => { if (window.confirm(`Delete ${product.name}?`)) setProducts(products.filter((item) => item.id !== product.id)); }}>Delete</button>
          </div>
        ))}
      </section>
    </main>
  );
}
export default App;
