import { useEffect, useState, type FormEvent } from "react";
import { jsPDF } from "jspdf";
import CatalogMaker from "./CatalogMaker";
import { crackerCatalog } from "./crackerCatalog";
import productImages from "./productImages.json";
import { initialRewardTiers, isRewardTierList, type RewardTier } from "./rewardTiers";
import "./App.css";

const productImagePaths = productImages as Record<string, string>;

type Product = {
  id: number;
  name: string;
  category: string;
  price: number;
  pack: string;
  image: string;
};
type CartItem = Product & { quantity: number };
type OrderSelection = { product: Product; quantity: number };
type Offer = {
  id: "first-order" | "repeat-order";
  title: string;
  description: string;
  threshold: number;
  discount: number;
  firstOrderOnly: boolean;
  enabled: boolean;
};
const parsePrice = (value: string | null) => Number(String(value ?? "0").replace(/[^0-9]/g, "")) || 0;
const seed: Product[] = crackerCatalog.map((item, index) => ({
  id: index + 1,
  name: item.name,
  category: item.category,
  price: parsePrice(item.price),
  pack: "As per product listing",
  image: productImagePaths[String(index + 1)] ?? "https://images.unsplash.com/photo-1533230399637-4f2a1d9d4f0c?auto=format&fit=crop&w=160&q=80",
}));
const defaultCategories = Array.from(new Set(crackerCatalog.map((item) => item.category)));
const migrateFamilyPack = <T extends Product>(product: T): T =>
  product.id === 100 && product.category === "Family Packs" && product.name === "40-Item Pack"
    ? { ...product, name: "45-Item Pack" }
    : product;
const getInitialProducts = () => {
  const saved = readStorage<Product[]>("blast-products", []);
  const pdfCategories = new Set(defaultCategories);
  const savedPdfProducts = saved
    .filter((product) => pdfCategories.has(product.category))
    .map(migrateFamilyPack);
  const savedById = new Map(savedPdfProducts.map((product) => [product.id, product]));
  return [
    ...seed.map((product) => savedById.get(product.id) ?? product),
    ...savedPdfProducts.filter((product) => !seed.some((seedProduct) => seedProduct.id === product.id)),
  ];
};
const defaultOffers: Offer[] = [
  { id: "first-order", title: "Welcome first order", description: "Register and get ₹50 welcome bonus plus ₹100 off on your first qualifying purchase.", threshold: 1150, discount: 100, firstOrderOnly: true, enabled: true },
  { id: "repeat-order", title: "Every next order", description: "Get ₹100 off on future purchases when your cart reaches the qualifying amount.", threshold: 1100, discount: 100, firstOrderOnly: false, enabled: true },
];
const money = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const getEarnedRewards = (tiers: RewardTier[], subtotal: number) =>
  tiers
    .filter((tier) => tier.enabled && tier.threshold <= subtotal)
    .sort((left, right) => left.threshold - right.threshold);
const rewardCopy = (tier: RewardTier) => [
  tier.candleValue > 0 ? `₹${tier.candleValue} candle gift` : "",
  tier.crackerValue > 0 ? `₹${tier.crackerValue} cracker gift` : "",
  tier.bonusPack,
].filter(Boolean).join(" + ");
type View = "login" | "shop" | "cart" | "catalogue" | "offers" | "order-entry" | "pdf-builder";
const routeForView = (view: View) => ({ login: "#/login", shop: "#/", cart: "#/cart", catalogue: "#/catalogue", offers: "#/offers", "order-entry": "#/order-entry", "pdf-builder": "#/pdf-builder" })[view];
const viewForRoute = (): View => {
  const route = ({ "#/": "shop", "#/cart": "cart", "#/catalogue": "catalogue", "#/offers": "offers", "#/login": "login", "#/order-entry": "order-entry", "#/pdf-builder": "pdf-builder" } as Record<string, View>)[window.location.hash] || "shop";
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
  pdf.text("SLV CRACKERS", 15, 20);
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
  const [products, setProducts] = useState<Product[]>(getInitialProducts);
  const [productStorageError, setProductStorageError] = useState("");
  const [cart, setCart] = useState<CartItem[]>(() =>
    readStorage<CartItem[]>("blast-cart", []).map(migrateFamilyPack),
  );
  const categories = defaultCategories;
  const [offers, setOffers] = useState<Offer[]>(() => readStorage<Offer[]>("blast-offers", defaultOffers));
  const [rewardTiers, setRewardTiers] = useState<RewardTier[]>(initialRewardTiers);
  const [rewardTiersError, setRewardTiersError] = useState("");
  const [orderCount, setOrderCount] = useState(() => readStorage<number>("blast-order-count", 0));
  const [category, setCategory] = useState(() => {
    return defaultCategories.includes("Sparklers") ? "Sparklers" : defaultCategories[0] || "";
  });
  const [view, setView] = useState<View>(() => viewForRoute());
  const [authOpen, setAuthOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentAfterLogin, setPaymentAfterLogin] = useState(false);
  const [user, setUser] = useState<string | null>(() =>
    localStorage.getItem("blast-user"),
  );
  const [welcomeOpen, setWelcomeOpen] = useState(() =>
    !localStorage.getItem("blast-welcome-claimed"),
  );
  useEffect(() => {
    try {
      localStorage.setItem("blast-products", JSON.stringify(products));
    } catch {
      setProductStorageError("This browser could not save the product photo. Free up browser storage and try again.");
    }
  }, [products]);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/product-images")
      .then(async (response) => {
        if (!response.ok) throw new Error("Saved product photos could not be loaded from the server.");
        return response.json() as Promise<Record<string, string | null>>;
      })
      .then((manifest) => {
        if (cancelled) return;
        setProducts((current) => current.map((product) => {
          if (!Object.hasOwn(manifest, String(product.id))) return product;
          const image = manifest[String(product.id)];
          return { ...product, image: image ?? "" };
        }));
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setProductStorageError(cause instanceof Error ? cause.message : "Saved product photos could not be loaded from the server.");
        }
      });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/reward-tiers")
      .then(async (response) => {
        if (!response.ok) throw new Error("Purchase reward offers could not be loaded.");
        const value: unknown = await response.json();
        if (!isRewardTierList(value)) throw new Error("Purchase reward offers from the server are invalid.");
        return value;
      })
      .then((tiers) => {
        if (!cancelled) {
          setRewardTiers(tiers);
          setRewardTiersError("");
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setRewardTiersError(cause instanceof Error ? cause.message : "Purchase reward offers could not be loaded.");
        }
      });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    localStorage.setItem("blast-offers", JSON.stringify(offers));
  }, [offers]);
  useEffect(() => {
    localStorage.setItem("blast-order-count", String(orderCount));
  }, [orderCount]);
  useEffect(() => {
    localStorage.setItem("blast-cart", JSON.stringify(cart));
  }, [cart]);
  const visible = products.filter((item) => item.category === category);
  const subtotal = cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  const welcomeClaimed = Boolean(localStorage.getItem("blast-welcome-claimed"));
  const activeOffer = offers.find((item) => item.enabled && subtotal >= item.threshold && (item.firstOrderOnly ? orderCount === 0 && welcomeClaimed : orderCount > 0));
  const welcomeBonus = activeOffer?.id === "first-order" ? 50 : 0;
  const total = Math.max(0, subtotal - (activeOffer?.discount || 0) - welcomeBonus);
  const earnedRewardTiers = getEarnedRewards(rewardTiers, subtotal);
  const rewardCandleValue = earnedRewardTiers.reduce((sum, tier) => sum + tier.candleValue, 0);
  const rewardCrackerValue = earnedRewardTiers.reduce((sum, tier) => sum + tier.crackerValue, 0);
  const rewardBonusPacks = [...new Set(earnedRewardTiers.map((tier) => tier.bonusPack).filter(Boolean))];
  const nextRewardTier = rewardTiers
    .filter((tier) => tier.enabled && tier.threshold > subtotal)
    .sort((left, right) => left.threshold - right.threshold)[0];
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
  const startPayment = () => setPaymentOpen(true);
  const requestPaymentLogin = () => {
    setPaymentAfterLogin(true);
    setAuthOpen(true);
  };
  const completePurchase = () => {
    setPaymentOpen(false);
    setOrderCount((count) => count + 1);
    setCart([]);
    alert("Payment successful. Your order has been recorded.");
    navigate("shop");
  };
  return (
    <div className="site-shell">
      {view !== "login" && (
        <header className="site-header">
          <button
            className="logo"
            onClick={() => setShopView("Sparklers")}
          >
            <span className="logo-spark">✦</span>
            <span>
              SLV<small>BRIGHT CELEBRATIONS | GREAT PRICES</small>
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
            <button className={view === "pdf-builder" ? "nav-active" : ""} onClick={() => navigate("pdf-builder")}>PDF Catalog</button>
            <button onClick={() => setShopView("Sparklers")}>
              Crackers
            </button>
            <button className={view === "offers" ? "nav-active" : ""} onClick={() => navigate("offers")}>Offers</button>
            <button onClick={() => setShopView()}>About</button>
            <button onClick={() => setShopView()}>Contact</button>
          </nav>
          <div className="header-tools">
            <button>English⌄</button>
            <button>⌖ Location</button>
            <button aria-label="Toggle theme">☼</button>
            {!welcomeClaimed && (
              <button className="header-claim" onClick={() => setWelcomeOpen(true)}>
                Claim ₹50
              </button>
            )}
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
            {rewardTiersError && <p className="reward-api-error" role="alert">{rewardTiersError}</p>}
            <section className="shop-offers-banner">
              <div>
                <p className="offer-card-kicker">SLV SHOPPING OFFERS</p>
                <strong>
                  {nextRewardTier
                    ? `Spend ${money(nextRewardTier.threshold)} and get ${rewardCopy(nextRewardTier)}`
                    : "Explore our current shopping offers"}
                </strong>
                <span>Rewards stack as you reach each target.</span>
              </div>
              <button type="button" onClick={() => navigate("offers")}>View all offers →</button>
            </section>
            <RewardProgress
              subtotal={subtotal}
              earnedCandleValue={rewardCandleValue}
              earnedCrackerValue={rewardCrackerValue}
              earnedBonusPacks={rewardBonusPacks}
              nextTier={nextRewardTier}
            />
            <div className="table-wrap">
              <div className="table-title">
                <span>✺</span>
                <strong>{category}</strong>
              </div>
              <div className="table-head">
                <span>No.</span>
                <span>Product Name</span>
                <span>Price</span>
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
                      <div className="product-details">
                        <strong>{product.name}</strong>
                        <small>{product.pack}</small>
                      </div>
                    </div>
                    <strong className="best-price">
                      {money(product.price)}
                    </strong>
                    <div className="stepper">
                      <button type="button" aria-label={`Decrease quantity for ${product.name}`} onClick={() => changeQuantity(product, -1)}>
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
                      <button type="button" aria-label={`Increase quantity for ${product.name}`} onClick={() => changeQuantity(product, 1)}>
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
          offer={activeOffer}
          welcomeBonus={welcomeBonus}
          rewardTiers={rewardTiers}
          rewardTiersError={rewardTiersError}
          count={count}
          onChange={changeQuantity}
          onBack={() => setShopView()}
          user={user}
          onLogin={requestPaymentLogin}
          onCheckout={startPayment}
        />
      )}
      {view === "offers" && <OffersPage offers={offers} rewardTiers={rewardTiers} rewardTiersError={rewardTiersError} onBack={() => setShopView()} />}
      {view === "order-entry" && (
        <OrderEntry products={products} onSubmit={(selections) => { submitOrderSelections(selections); navigate("cart"); }} onCart={() => navigate("cart")} />
      )}
      {view === "pdf-builder" && (
        <CatalogMaker
          products={products}
          storageError={productStorageError}
          onProductImageChange={(productId, image) => {
            setProductStorageError("");
            setProducts((current) =>
              current.map((product) =>
                product.id === productId
                  ? { ...product, image: image ?? "" }
                  : product,
              ),
            );
          }}
        />
      )}
      {view === "catalogue" && (
        <Catalogue
          products={products}
          setProducts={setProducts}
          categories={categories}
          offers={offers}
          setOffers={setOffers}
          rewardTiers={rewardTiers}
          rewardTiersError={rewardTiersError}
          onSaveRewardTiers={(tiers) => {
            setRewardTiers(tiers);
            setRewardTiersError("");
          }}
          onWebsite={() => setShopView()}
          onPhotoManagement={() => navigate("pdf-builder")}
          onLogout={() => {
            localStorage.removeItem("blast-admin-session");
            navigate("login");
          }}
        />
      )}
      {view !== "login" && view !== "pdf-builder" && (
        <div className="floating-actions">
          <button className="whatsapp" aria-label="Contact SLV Crackers">
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
        <span>SLV CRACKERS</span>
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
            if (paymentAfterLogin) {
              setPaymentAfterLogin(false);
              setPaymentOpen(true);
            }
          }}
        />
      )}
      {paymentOpen && <PaymentModal total={total} onClose={() => setPaymentOpen(false)} onPaid={completePurchase} />}
      {welcomeOpen && view !== "login" && (
        <WelcomeReward onClose={() => setWelcomeOpen(false)} />
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
  return <main className="order-entry-page"><div className="entry-header"><div><p className="admin-kicker">SLV / ORDER ENTRY</p><h1>Add items by product ID</h1><p>Select multiple products and quantities, then submit them together to the cart.</p></div><button className="download-pdf" onClick={onCart}>Go to cart</button></div><div className="order-entry-grid"><div><form className="order-entry-form" onSubmit={addItem}><label>Product ID<input type="number" min="1" max={products.length} value={productId} onChange={(event) => setProductId(event.target.value)} placeholder="Example: 1" required /></label><label>Quantity<div className="entry-stepper"><button type="button" onClick={() => setQuantity(Math.max(1, quantity - 1))}>−</button><input type="number" min="1" value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))} /><button type="button" onClick={() => setQuantity(quantity + 1)}>+</button></div></label>{selected && <div className="selected-product"><strong>#{Number(productId)} {selected.name}</strong><span>{selected.category} / {selected.pack} / {money(selected.price)}</span></div>}{message && <p className="entry-message">{message}</p>}<button className="save-product" type="submit">Add item</button></form></div><section className="entry-reference">{selections.length > 0 && <><h2>Selected items</h2>{selections.map((item) => <div className="entry-product selected-entry-product" key={item.product.id}><b>#{products.indexOf(item.product) + 1}</b><span>{item.product.name}<small>Qty {item.quantity} × {money(item.product.price)}</small></span><strong>{money(item.product.price * item.quantity)}</strong><button type="button" onClick={() => setSelections(selections.filter((selectedItem) => selectedItem.product.id !== item.product.id))}>Remove</button></div>)}<div className="selection-total"><span>Estimated total</span><strong>{money(selections.reduce((sum, item) => sum + item.product.price * item.quantity, 0))}</strong></div><button className="save-product" type="button" onClick={() => onSubmit(selections)}>Submit selected items to cart →</button></>}<h2>Product IDs</h2>{products.map((product, index) => <div className="entry-product" key={product.id}><b>#{index + 1}</b><span>{product.name}<small>{product.category}</small></span><strong>{money(product.price)}</strong></div>)}</section></div></main>;
}

function OffersPage({ offers, rewardTiers, rewardTiersError, onBack }: { offers: Offer[]; rewardTiers: RewardTier[]; rewardTiersError: string; onBack: () => void }) {
  return (
    <main className="offers-page">
      <button className="back-link" onClick={onBack}>← Continue shopping</button>
      <p className="admin-kicker">SLV / OFFERS</p>
      <h1>Celebrate more, save more.</h1>
      <p className="offers-intro">Every offer is applied automatically at checkout when your order meets its condition.</p>
      {rewardTiersError && <p className="reward-api-error" role="alert">{rewardTiersError}</p>}
      <div className="offer-cards">
        <article className="offer-card welcome-offer-card">
          <span className="offer-card-mark">₹50</span>
          <div><p className="offer-card-kicker">REGISTER &amp; SAVE</p><h2>Welcome bonus</h2><p>Register before your first purchase to unlock a ₹50 welcome bonus.</p></div>
        </article>
        {offers.filter((offer) => offer.enabled).map((offer) => (
          <article className="offer-card" key={offer.id}>
            <span className="offer-card-mark">-{money(offer.discount)}</span>
            <div><p className="offer-card-kicker">{offer.firstOrderOnly ? "FIRST PURCHASE ONLY" : "REPEAT PURCHASES"}</p><h2>{offer.title}</h2><p>{offer.description}</p><strong>Minimum cart value: {money(offer.threshold)}</strong></div>
          </article>
        ))}
        {rewardTiers.filter((tier) => tier.enabled).map((tier) => {
          const included = getEarnedRewards(rewardTiers, tier.threshold);
          const candleValue = included.reduce((sum, item) => sum + item.candleValue, 0);
          const crackerValue = included.reduce((sum, item) => sum + item.crackerValue, 0);
          const bonusPacks = [...new Set(included.map((item) => item.bonusPack).filter(Boolean))];
          return (
            <article className="offer-card reward-tier-card" key={tier.id}>
              <span className="offer-card-mark">{money(tier.threshold)}+</span>
              <div>
                <p className="offer-card-kicker">STACKED SHOPPING REWARD</p>
                <h2>Spend {money(tier.threshold)}</h2>
                <p>
                  Earn {candleValue > 0 ? `${money(candleValue)} worth of candles` : ""}
                  {candleValue > 0 && crackerValue > 0 ? " + " : ""}
                  {crackerValue > 0 ? `${money(crackerValue)} worth of crackers` : ""}
                  {bonusPacks.length > 0 ? `${candleValue > 0 || crackerValue > 0 ? " + " : ""}${bonusPacks.join(" + ")}` : ""}.
                  Rewards stack with every target reached.
                </p>
                {rewardCopy(tier) && <strong>At this target: +{rewardCopy(tier)}</strong>}
              </div>
            </article>
          );
        })}
      </div>
      <div className="offer-rules"><h2>How the shopping rewards work</h2><p>Reach a spending target to unlock its reward. Rewards from every target you reach are added together.</p><p>Candle and cracker amounts show the value of the gift items; they are not cash discounts.</p></div>
    </main>
  );
}

function RewardProgress({
  subtotal,
  earnedCandleValue,
  earnedCrackerValue,
  earnedBonusPacks,
  nextTier,
}: {
  subtotal: number;
  earnedCandleValue: number;
  earnedCrackerValue: number;
  earnedBonusPacks: string[];
  nextTier?: RewardTier;
}) {
  if (subtotal <= 0 && !nextTier) return null;
  const progress = nextTier ? Math.min(100, (subtotal / nextTier.threshold) * 100) : 100;
  const remaining = nextTier ? Math.max(0, nextTier.threshold - subtotal) : 0;
  const earnedRewards = [
    earnedCandleValue > 0 ? `${money(earnedCandleValue)} worth of candles` : "",
    earnedCrackerValue > 0 ? `${money(earnedCrackerValue)} worth of crackers` : "",
    ...earnedBonusPacks,
  ].filter(Boolean);

  return (
    <section className="reward-progress" aria-live="polite">
      <div className="reward-progress-heading">
        <strong>{nextTier ? `Next reward: ${money(nextTier.threshold)}` : "All shopping rewards unlocked"}</strong>
        {nextTier && <span>Add {money(remaining)} more to reach your next target.</span>}
      </div>
      {nextTier && <div className="reward-progress-track"><span style={{ width: `${progress}%` }} /></div>}
      {nextTier && <p className="reward-next-benefit">Next: {rewardCopy(nextTier)}</p>}
      {earnedRewards.length > 0 && <p className="reward-earned">Unlocked so far: {earnedRewards.join(" + ")}</p>}
    </section>
  );
}

function Cart({
  cart,
  subtotal,
  total,
  offer,
  welcomeBonus,
  rewardTiers,
  rewardTiersError,
  count,
  onChange,
  onBack,
  user,
  onLogin,
  onCheckout,
}: {
  cart: CartItem[];
  subtotal: number;
  total: number;
  offer?: Offer;
  welcomeBonus: number;
  rewardTiers: RewardTier[];
  rewardTiersError: string;
  count: number;
  onChange: (product: Product, delta: number) => void;
  onBack: () => void;
  user: string | null;
  onLogin: () => void;
  onCheckout: () => void;
}) {
  const earned = getEarnedRewards(rewardTiers, subtotal);
  const earnedCandleValue = earned.reduce((sum, tier) => sum + tier.candleValue, 0);
  const earnedCrackerValue = earned.reduce((sum, tier) => sum + tier.crackerValue, 0);
  const earnedBonusPacks = [...new Set(earned.map((tier) => tier.bonusPack).filter(Boolean))];
  const nextTier = rewardTiers
    .filter((tier) => tier.enabled && tier.threshold > subtotal)
    .sort((left, right) => left.threshold - right.threshold)[0];

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
          {rewardTiersError && <p className="reward-api-error" role="alert">{rewardTiersError}</p>}
          <RewardProgress
            subtotal={subtotal}
            earnedCandleValue={earnedCandleValue}
            earnedCrackerValue={earnedCrackerValue}
            earnedBonusPacks={earnedBonusPacks}
            nextTier={nextTier}
          />
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
                  <button type="button" aria-label={`Decrease quantity for ${item.name}`} onClick={() => onChange(item, -1)}>−</button>
                  <span>{item.quantity}</span>
                  <button type="button" aria-label={`Increase quantity for ${item.name}`} onClick={() => onChange(item, 1)}>+</button>
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
              {offer.title} <b>-{money(offer.discount)}</b>
            </p>
          )}
          {welcomeBonus > 0 && <p className="discount">Welcome bonus <b>-{money(welcomeBonus)}</b></p>}
          <hr />
          <h2>
            Total <b>{money(total)}</b>
          </h2>
          <p className="offer-note">
            {offer ? offer.description : "Check Offers for the qualifying purchase amount."}
          </p>
          {earnedCandleValue > 0 && <p className="reward-summary-line">Candle gifts <b>{money(earnedCandleValue)} value</b></p>}
          {earnedCrackerValue > 0 && <p className="reward-summary-line">Cracker gifts <b>{money(earnedCrackerValue)} value</b></p>}
          {earnedBonusPacks.map((pack) => <p className="reward-summary-line" key={pack}>Bonus gift <b>{pack}</b></p>)}
          <button
            disabled={!cart.length}
            onClick={() => user ? onCheckout() : onLogin()}
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
        <h2>Welcome to SLV CRACKERS</h2>
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

function PaymentModal({ total, onClose, onPaid }: { total: number; onClose: () => void; onPaid: () => void }) {
  const upiId = "9000488963@ybl";
  const paymentUri = `upi://pay?pa=${upiId}&pn=SLV%20CRACKERS&am=${total}&cu=INR`;
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=10&data=${encodeURIComponent(paymentUri)}`;
  const copyUpi = async () => {
    await navigator.clipboard?.writeText(upiId);
    alert("UPI number copied.");
  };
  return (
    <div className="modal-backdrop payment-backdrop">
      <section className="payment-box" aria-labelledby="payment-title">
        <button type="button" className="close" onClick={onClose} aria-label="Close payment">×</button>
        <p className="welcome-kicker">SECURE UPI PAYMENT</p>
        <h2 id="payment-title">Pay {money(total)}</h2>
        <p className="payment-intro">Scan the QR code with any UPI app or use the UPI number below to complete your order.</p>
        <div className="qr-frame"><img src={qrCodeUrl} alt={`UPI payment QR code for ${money(total)}`} /></div>
        <div className="upi-row"><div><small>UPI number</small><strong>{upiId}</strong></div><button type="button" onClick={copyUpi}>Copy</button></div>
        <button className="payment-confirm" type="button" onClick={onPaid}>I have completed the payment</button>
        <small className="payment-note">Your order is recorded after you confirm the payment.</small>
      </section>
    </div>
  );
}

function WelcomeReward({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<"welcome" | "details" | "success">("welcome");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setStep("details"), 1800);
    return () => window.clearTimeout(timer);
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    localStorage.setItem("blast-welcome-claimed", JSON.stringify({ name, phone, email }));
    setStep("success");
  };

  return (
    <div className="modal-backdrop welcome-backdrop">
      <section className="welcome-box" aria-labelledby="welcome-title">
        <button type="button" className="close" onClick={onClose} aria-label="Close welcome offer">×</button>
        {step === "welcome" && (
          <div className="welcome-intro">
            <span className="welcome-burst">✦</span>
            <p className="welcome-kicker">A LITTLE CELEBRATION GIFT</p>
            <h2 id="welcome-title">Welcome to SLV CRACKERS!</h2>
            <p>We are so glad you are here. Enjoy a bright start to your celebration with us.</p>
            <strong className="reward-amount">₹50 <small>WELCOME REWARD</small></strong>
            <span className="welcome-loading">Preparing your gift...</span>
          </div>
        )}
        {step === "details" && (
          <form className="welcome-form" onSubmit={submit}>
            <p className="welcome-kicker">YOUR WELCOME GIFT IS READY</p>
            <h2 id="welcome-title">Claim your ₹50 reward</h2>
            <p>Tell us where to send your reward confirmation.</p>
            <label>Your name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Enter your name" required autoFocus /></label>
            <label>Mobile number<input value={phone} onChange={(event) => setPhone(event.target.value)} type="tel" inputMode="numeric" pattern="[0-9]{10}" maxLength={10} placeholder="10-digit mobile number" required /></label>
            <label>Email <span>(optional)</span><input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="you@example.com" /></label>
            <button type="submit">Submit &amp; claim ₹50 →</button>
            <small className="welcome-note">Your details stay private and are only used for this reward.</small>
          </form>
        )}
        {step === "success" && (
          <div className="welcome-intro welcome-success">
            <span className="success-mark">✓</span>
            <p className="welcome-kicker">REWARD CLAIMED</p>
            <h2 id="welcome-title">₹50 is yours, {name}!</h2>
            <p>Thank you for joining SLV Crackers. Your welcome reward has been recorded successfully.</p>
            <button type="button" onClick={onClose}>Start shopping</button>
          </div>
        )}
      </section>
    </div>
  );
}

function AdminLogin({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (email === "admin@slv.in" && password === "Slv@123") onLogin();
    else setError("Incorrect admin email or password.");
  };
  return (
    <main className="admin-login-page">
      <div className="admin-login-card">
        <div className="admin-login-brand">
          <span>✦</span> SLV
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
            placeholder="admin@slv.in"
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
        <p className="demo-hint">Demo access: admin@slv.in / Slv@123</p>
      </div>
      <div className="admin-login-art">
        <span>SLV</span>
        <p>
          Products in.
          <br />
          Celebrations out.
        </p>
      </div>
    </main>
  );
}

function RewardTierManager({
  tiers,
  loadError,
  onSave,
}: {
  tiers: RewardTier[];
  loadError: string;
  onSave: (tiers: RewardTier[]) => void;
}) {
  const [draftTierState, setDraftTierState] = useState({ source: tiers, draft: tiers });
  const draftTiers = draftTierState.source === tiers ? draftTierState.draft : tiers;
  const [uploadToken, setUploadToken] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  const updateDraftTiers = (update: (current: RewardTier[]) => RewardTier[]) => {
    setDraftTierState((current) => ({
      source: tiers,
      draft: update(current.source === tiers ? current.draft : tiers),
    }));
  };

  const updateTier = (id: string, update: Partial<RewardTier>) => {
    updateDraftTiers((current) => current.map((tier) => tier.id === id ? { ...tier, ...update } : tier));
    setStatus("");
  };

  const addTier = () => {
    const threshold = Math.max(0, ...draftTiers.map((tier) => tier.threshold)) + 1000;
    updateDraftTiers((current) => [...current, {
      id: `tier-${Date.now()}`,
      threshold,
      candleValue: 0,
      crackerValue: 0,
      bonusPack: "",
      enabled: true,
    }]);
    setError("");
    setStatus("");
  };

  const saveTiers = async () => {
    const sorted = [...draftTiers].sort((left, right) => left.threshold - right.threshold);
    if (!isRewardTierList(sorted)) {
      setError("Use unique, increasing target amounts and valid non-negative gift values.");
      setStatus("");
      return;
    }
    if (!import.meta.env.DEV && !uploadToken.trim()) {
      setError("Enter the server photo upload token to save public reward offers.");
      setStatus("");
      return;
    }

    setSaving(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/reward-tiers", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(uploadToken.trim() ? { Authorization: `Bearer ${uploadToken.trim()}` } : {}),
        },
        body: JSON.stringify({ tiers: sorted }),
      });
      const result = await response.json() as { tiers?: unknown; error?: string };
      if (!response.ok || !isRewardTierList(result.tiers)) {
        throw new Error(result.error || "Reward offers could not be saved.");
      }
      onSave(result.tiers);
      setStatus("Reward tiers are saved and visible to shoppers.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Reward offers could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-products reward-tier-manager">
      <div className="admin-products-head">
        <h2>Stacked shopping rewards</h2>
        <span>Gift rewards unlock as cart value increases</span>
      </div>
      <p className="offer-admin-note">Each enabled tier adds its gifts to the rewards from all lower targets. Shoppers see progress while adding crackers.</p>
      {loadError && <p className="reward-api-error" role="alert">{loadError}</p>}
      <div className="reward-tier-table">
        <div className="reward-tier-table-head"><span>Enabled</span><span>Cart target (₹)</span><span>Candles (₹ value)</span><span>Crackers (₹ value)</span><span>Bonus pack</span><span>Action</span></div>
        {draftTiers.map((tier) => (
          <div className="reward-tier-editor-row" key={tier.id}>
            <label aria-label={`Enable ${money(tier.threshold)} reward`}><input type="checkbox" checked={tier.enabled} onChange={(event) => updateTier(tier.id, { enabled: event.target.checked })} /></label>
            <label><span className="sr-only">Cart target</span><input type="number" min="1" step="1" value={tier.threshold} onChange={(event) => updateTier(tier.id, { threshold: Number(event.target.value) })} /></label>
            <label><span className="sr-only">Candle gift value</span><input type="number" min="0" step="1" value={tier.candleValue} onChange={(event) => updateTier(tier.id, { candleValue: Number(event.target.value) })} /></label>
            <label><span className="sr-only">Cracker gift value</span><input type="number" min="0" step="1" value={tier.crackerValue} onChange={(event) => updateTier(tier.id, { crackerValue: Number(event.target.value) })} /></label>
            <label><span className="sr-only">Bonus pack</span><input value={tier.bonusPack} onChange={(event) => updateTier(tier.id, { bonusPack: event.target.value })} placeholder="Optional pack" /></label>
            <button type="button" className="catalog-remove-photo" onClick={() => { updateDraftTiers((current) => current.filter((item) => item.id !== tier.id)); setStatus(""); }}>Delete</button>
          </div>
        ))}
      </div>
      <div className="reward-tier-admin-actions">
        <button type="button" className="catalog-folder-button" onClick={addTier} disabled={draftTiers.length >= 30}>Add reward tier</button>
        <label className="reward-token-label">Server photo upload token<input type="password" value={uploadToken} autoComplete="off" onChange={(event) => setUploadToken(event.target.value)} placeholder="Enter the server token" /></label>
        <button type="button" className="save-product" onClick={() => void saveTiers()} disabled={saving}>{saving ? "Saving rewards..." : "Save shopper offers"}</button>
      </div>
      {error && <p className="catalog-maker-error" role="alert">{error}</p>}
      {status && <p className="catalog-maker-status" role="status">{status}</p>}
    </section>
  );
}

function Catalogue({
  products,
  setProducts,
  categories,
  offers,
  setOffers,
  rewardTiers,
  rewardTiersError,
  onSaveRewardTiers,
  onWebsite,
  onPhotoManagement,
  onLogout,
}: {
  products: Product[];
  setProducts: (products: Product[]) => void;
  categories: string[];
  offers: Offer[];
  setOffers: (offers: Offer[]) => void;
  rewardTiers: RewardTier[];
  rewardTiersError: string;
  onSaveRewardTiers: (tiers: RewardTier[]) => void;
  onWebsite: () => void;
  onPhotoManagement: () => void;
  onLogout: () => void;
}) {
  const empty: Product = {
    id: 0,
    name: "",
    category: "Sparklers",
    price: 0,
    pack: "",
    image: seed[0].image,
  };
  const [draft, setDraft] = useState<Product>(empty);
  const [editing, setEditing] = useState<number | null>(null);
  const save = () => {
    if (!draft.name || draft.price <= 0 || !draft.pack)
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
  return (
    <main className="admin-page">
      <div className="admin-top">
        <div>
          <p className="admin-kicker">SLV / SHOP CONTROL</p>
          <h1>Cracker catalogue</h1>
          <p>
            Update details here and they appear on the customer website
            immediately.
          </p>
        </div>
        <div className="admin-actions">
          <button onClick={onWebsite}>View customer site</button>
          <button onClick={onPhotoManagement}>Manage category photos</button>
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
        <div className="admin-products-head"><h2>PDF categories</h2><span>{categories.length} categories</span></div>
        {categories.map((item) => <div className="admin-category-row" key={item}><strong>{item}</strong></div>)}
      </section>
      <RewardTierManager
        tiers={rewardTiers}
        loadError={rewardTiersError}
        onSave={onSaveRewardTiers}
      />
      <section className="admin-products offer-manager">
        <div className="admin-products-head"><h2>Offers &amp; checkout rules</h2><span>Edit the live customer offers</span></div>
        {offers.map((offer) => (
          <div className="offer-editor" key={offer.id}>
            <div className="offer-editor-heading"><strong>{offer.title}</strong><label className="offer-toggle"><input type="checkbox" checked={offer.enabled} onChange={(event) => setOffers(offers.map((item) => item.id === offer.id ? { ...item, enabled: event.target.checked } : item))} /> Enabled</label></div>
            <div className="offer-editor-grid">
              <label>Offer title<input value={offer.title} onChange={(event) => setOffers(offers.map((item) => item.id === offer.id ? { ...item, title: event.target.value } : item))} /></label>
              <label>Minimum cart value<input type="number" min="0" value={offer.threshold} onChange={(event) => setOffers(offers.map((item) => item.id === offer.id ? { ...item, threshold: Number(event.target.value) } : item))} /></label>
              <label>Discount value<input type="number" min="0" value={offer.discount} onChange={(event) => setOffers(offers.map((item) => item.id === offer.id ? { ...item, discount: Number(event.target.value) } : item))} /></label>
              <label className="offer-description">Customer-facing condition<input value={offer.description} onChange={(event) => setOffers(offers.map((item) => item.id === offer.id ? { ...item, description: event.target.value } : item))} /></label>
            </div>
            <p className="offer-admin-note">{offer.firstOrderOnly ? "Runs once, on the customer's first order, after the ₹50 welcome bonus is claimed." : "Runs on orders after the first completed purchase."}</p>
          </div>
        ))}
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
