import { useEffect, useRef, useState, type FormEvent } from "react";
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
  id: "repeat-order" | "welcome";
  title: string;
  description: string;
  threshold: number;
  discount: number;
  enabled: boolean;
};
const parsePrice = (value: string | null) => Number(String(value ?? "0").replace(/[^0-9]/g, "")) || 0;
const seed: Product[] = crackerCatalog.map((item, index) => ({
  id: index + 1,
  name: item.name,
  category: item.category,
  price: parsePrice(item.price),
  pack: "",
  image: productImagePaths[String(index + 1)] ?? "https://images.unsplash.com/photo-1533230399637-4f2a1d9d4f0c?auto=format&fit=crop&w=160&q=80",
}));
const defaultCategories = Array.from(new Set(crackerCatalog.map((item) => item.category)));
const categoryIconByName: Record<string, string> = {
  "Sparklers": "sparkler",
  "Twinkling Stars": "star",
  "Children's Special": "toy",
  "Flower Pots": "flower",
  "Ground Chakkar": "chakkar",
  "Single Shot & Crackers": "sound",
  "Wala Crackers": "garland",
  "Atom Bombs": "bomb",
  "Spinners": "spinner",
  "Crackling": "spark",
  "Rockets": "rocket",
  "Fancy Items": "fancy",
  "Shots": "shots",
  "Family Packs": "gift",
};
const migrateFamilyPack = <T extends Product>(product: T): T => {
  const migrated = product.id === 100 && product.category === "Family Packs" && product.name === "40-Item Pack"
    ? { ...product, name: "45-Item Pack" }
    : product;
  return migrated.pack === "As per product listing" ? { ...migrated, pack: "" } : migrated;
};
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
  { id: "repeat-order", title: "Every next order", description: "Get ₹100 off on future purchases when your cart reaches the qualifying amount.", threshold: 1100, discount: 100, enabled: true },
];
const money = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const getEarnedRewards = (tiers: RewardTier[], subtotal: number) =>
  tiers
    .filter((tier) => tier.enabled && tier.threshold <= subtotal)
    .sort((left, right) => left.threshold - right.threshold);
const getApplicableOffer = (subtotal: number, customer: CustomerIdentity | null, offers: Offer[], orderCount: number) => {
  if (subtotal <= 0) return undefined;
  const offer = customer?.welcomeOfferAvailable
    ? { id: "welcome" as const, title: "Welcome offer", description: "₹50 off your first order.", threshold: 0, discount: 50, enabled: true }
    : offers.find((item) => item.enabled && subtotal >= item.threshold && orderCount > 0);
  return offer ? { ...offer, discount: Math.min(offer.discount, subtotal) } : undefined;
};
const rewardCopy = (tier: RewardTier) => [
  tier.candleValue > 0 ? `₹${tier.candleValue} candle gift` : "",
  tier.crackerValue > 0 ? `₹${tier.crackerValue} cracker gift` : "",
  tier.bonusPack,
].filter(Boolean).join(" + ");
type CustomerRegistration = { name: string; phone: string; email: string; password: string; consented: boolean };
type CustomerIdentity = { id: string; name: string; phone: string; email: string; welcomeOfferAvailable: boolean };
type CustomerRecord = CustomerIdentity & { registeredAt: string; consentedAt: string };
type CustomerOrder = {
  id: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  total: number;
  status: string;
  attemptedAt: string;
  confirmedAt: string | null;
};
type AuthenticationInput = { mode: "register"; customer: CustomerRegistration } | { mode: "login"; identifier: string; password: string };
function isCustomerRecord(value: unknown): value is CustomerRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string"
    && typeof candidate.name === "string"
    && typeof candidate.phone === "string"
    && typeof candidate.email === "string"
    && typeof candidate.registeredAt === "string"
    && typeof candidate.consentedAt === "string";
}
async function readApiResult<T>(response: Response): Promise<T> {
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}
async function authenticateCustomer(input: AuthenticationInput) {
  const response = await fetch(input.mode === "register" ? "/api/auth/register" : "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input.mode === "register" ? input.customer : { identifier: input.identifier, password: input.password }),
  });
  const result = await readApiResult<{ user: CustomerIdentity }>(response);
  return result.user;
}
async function readCustomerCart() {
  const response = await fetch("/api/customer-cart");
  return (await readApiResult<{ cart: CartItem[] }>(response)).cart;
}
async function saveCustomerCart(cart: CartItem[]) {
  const response = await fetch("/api/customer-cart", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cart }),
  });
  await readApiResult<{ saved: boolean }>(response);
}
type View = "customer-auth" | "admin-login" | "shop" | "cart" | "catalogue" | "admin-customers" | "offers" | "order-entry" | "pdf-builder" | "about" | "contact";
const routeForView = (view: View) => ({ "customer-auth": "#/login", "admin-login": "#/admin/login", shop: "#/", cart: "#/cart", catalogue: "#/admin", "admin-customers": "#/admin/customers", offers: "#/offers", "order-entry": "#/order-entry", "pdf-builder": "#/pdf-builder", about: "#/about", contact: "#/contact" })[view];
const viewForRoute = (): View => {
  return ({ "#/": "shop", "#/cart": "cart", "#/catalogue": "catalogue", "#/admin": "catalogue", "#/admin/customers": "admin-customers", "#/admin/login": "admin-login", "#/offers": "offers", "#/login": "customer-auth", "#/order-entry": "order-entry", "#/pdf-builder": "pdf-builder", "#/about": "about", "#/contact": "contact" } as Record<string, View>)[window.location.hash] || "shop";
};
const downloadCartPdf = (
  cart: CartItem[],
  subtotal: number,
  total: number,
  offer?: Offer,
  rewards: string[] = [],
) => {
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const pdfMoney = (amount: number) => `Rs. ${amount.toLocaleString("en-IN")}`;
  const pdfText = (value: string) => value.replace(/₹/g, "Rs. ");
  const margin = 10;
  const colors = {
    emerald: [18, 79, 58],
    deepEmerald: [13, 58, 43],
    gold: [207, 164, 76],
    paleGold: [250, 245, 231],
    lightGold: [229, 214, 178],
    ink: [43, 54, 47],
    muted: [111, 119, 108],
    grid: [222, 224, 214],
    stripe: [248, 249, 245],
    white: [255, 255, 255],
  };
  const columnWidths = [12, 90, 16, 36, 36];
  const columnX = columnWidths.reduce<number[]>((positions, width) => {
    positions.push((positions.at(-1) ?? margin) + width);
    return positions;
  }, [margin]);
  const tableHeaderY = 35;
  const tableHeaderHeight = 8;
  let y = tableHeaderY + tableHeaderHeight;

  const drawPageHeader = () => {
    pdf.setFillColor(...colors.deepEmerald as [number, number, number]);
    pdf.rect(0, 0, pageWidth, 25, "F");
    pdf.setFillColor(...colors.gold as [number, number, number]);
    pdf.rect(0, 24, pageWidth, 1, "F");
    pdf.setTextColor(...colors.white as [number, number, number]);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(18);
    pdf.text("SLV CRACKERS", pageWidth / 2, 12, { align: "center" });
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "normal");
    pdf.text("ORDER SUMMARY", pageWidth / 2, 19, { align: "center" });
    pdf.setTextColor(...colors.muted as [number, number, number]);
    pdf.text(`Prepared ${new Date().toLocaleDateString("en-IN")}`, pageWidth / 2, 31, { align: "center" });
    pdf.setFillColor(...colors.emerald as [number, number, number]);
    pdf.rect(margin, tableHeaderY, pageWidth - margin * 2, tableHeaderHeight, "F");
    pdf.setTextColor(...colors.white as [number, number, number]);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(7);
    ["NO.", "ITEM NAME", "QTY", "UNIT PRICE", "AMOUNT"].forEach((label, index) => {
      const align = index >= 2 ? "right" : "left";
      const x = align === "right" ? columnX[index] + columnWidths[index] - 2 : columnX[index] + 2;
      pdf.text(label, x, tableHeaderY + 5.3, { align });
    });
  };
  const startNewPage = () => {
    pdf.addPage();
    y = tableHeaderY + tableHeaderHeight;
    drawPageHeader();
  };

  drawPageHeader();
  cart.forEach((item, index) => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    const productLines = pdf.splitTextToSize(pdfText(item.name), columnWidths[1] - 5);
    const packLines = item.pack ? pdf.splitTextToSize(pdfText(item.pack), columnWidths[1] - 5) : [];
    const rowHeight = Math.max(9, productLines.length * 4 + packLines.length * 3 + 4);
    if (y + rowHeight > pageHeight - 18) startNewPage();
    const background = index % 2 === 0 ? colors.white : colors.stripe;
    pdf.setDrawColor(...colors.grid as [number, number, number]);
    pdf.setLineWidth(0.15);
    columnWidths.forEach((width, column) => {
      pdf.setFillColor(...background as [number, number, number]);
      pdf.rect(columnX[column], y, width, rowHeight, "FD");
    });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(...colors.muted as [number, number, number]);
    pdf.text(String(index + 1), columnX[0] + 2, y + 5.2);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(...colors.ink as [number, number, number]);
    pdf.text(productLines, columnX[1] + 2, y + 4.5);
    if (packLines.length) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(6.5);
      pdf.setTextColor(...colors.muted as [number, number, number]);
      pdf.text(packLines, columnX[1] + 2, y + 4.5 + productLines.length * 4);
    }
    pdf.setTextColor(...colors.ink as [number, number, number]);
    pdf.setFontSize(7.5);
    pdf.text(String(item.quantity), columnX[2] + columnWidths[2] - 2, y + 5.2, { align: "right" });
    pdf.text(pdfMoney(item.price), columnX[3] + columnWidths[3] - 2, y + 5.2, { align: "right" });
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...colors.emerald as [number, number, number]);
    pdf.text(pdfMoney(item.price * item.quantity), columnX[4] + columnWidths[4] - 2, y + 5.2, { align: "right" });
    y += rowHeight;
  });

  const summaryLines = [
    { label: "Subtotal", value: pdfMoney(subtotal) },
    ...(offer ? [{ label: offer.title, value: `-${pdfMoney(offer.discount)}` }] : []),
  ];
  const rewardText = rewards.map((reward) => pdf.splitTextToSize(`- ${pdfText(reward)}`, pageWidth - margin * 2 - 4));
  const rewardHeight = rewards.length ? 5 + rewardText.reduce((height, lines) => height + lines.length * 4.5, 0) : 0;
  const summaryHeight = 7 + 6 + summaryLines.length * 7 + 16 + rewardHeight;
  if (y + summaryHeight > pageHeight - 18) startNewPage();
  y += 7;
  pdf.setDrawColor(...colors.gold as [number, number, number]);
  pdf.setLineWidth(0.45);
  pdf.line(pageWidth - margin - 84, y, pageWidth - margin, y);
  y += 6;
  const summaryX = pageWidth - margin - 84;
  summaryLines.forEach((line) => {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(...colors.muted as [number, number, number]);
    pdf.text(pdfText(line.label), summaryX, y);
    pdf.setTextColor(...colors.ink as [number, number, number]);
    pdf.text(line.value, pageWidth - margin, y, { align: "right" });
    y += 7;
  });
  pdf.setFillColor(...colors.paleGold as [number, number, number]);
  pdf.setDrawColor(...colors.lightGold as [number, number, number]);
  pdf.roundedRect(summaryX - 2, y - 2, 86, 11, 1.5, 1.5, "FD");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(...colors.deepEmerald as [number, number, number]);
  pdf.text("TOTAL", summaryX, y + 5);
  pdf.text(pdfMoney(total), pageWidth - margin - 2, y + 5, { align: "right" });
  y += 16;
  if (rewards.length) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.setTextColor(...colors.deepEmerald as [number, number, number]);
    pdf.text("SHOPPING REWARDS", margin, y);
    y += 5;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(...colors.muted as [number, number, number]);
    rewardText.forEach((lines) => {
      pdf.text(lines, margin + 2, y);
      y += lines.length * 4.5;
    });
  }
  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(...colors.gold as [number, number, number]);
    pdf.line(margin, pageHeight - 8, pageWidth - margin, pageHeight - 8);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6);
    pdf.setTextColor(...colors.muted as [number, number, number]);
    pdf.text(`SLV CRACKERS  |  PAGE ${page} OF ${pageCount}`, pageWidth - margin, pageHeight - 4, { align: "right" });
  }
  pdf.save("SLV_Crackers_Order_Summary.pdf");
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

function CategoryIcon({ category }: { category: string }) {
  const icon = categoryIconByName[category] || "spark";
  return (
    <svg className="category-icon" viewBox="0 0 20 20" aria-hidden="true">
      {icon === "sparkler" && <>
        <path d="M6 17 12 8" />
        <path d="m12 6 .7-3 .8 2.1 2.1-1.2-1.3 2.2 2.1.8-3 .5" />
        <path d="m10 9-2-1m1 3-2-.3m4-3 .3-2" />
      </>}
      {icon === "star" && <>
        <path d="m10 2 2 5.5 5.8.3-4.5 3.7 1.5 5.6-4.8-3-4.8 3 1.5-5.6-4.5-3.7 5.8-.3z" />
        <path d="M10 0v1M2 4l1 1m14-1-1 1" />
      </>}
      {icon === "toy" && <>
        <path d="M5 8V5l2 1 3-2 3 2 2-1v3" />
        <path d="M4 8h12l1 7H3zM7 11h.1m5.8 0h.1M8 13h4" />
      </>}
      {icon === "flower" && <>
        <path d="M10 9c-4-1-4-5-1.5-5.5C10 3.2 10 6 10 9Zm1 0c1-4 5-4 5.5-1.5C16.8 9 14 9 11 9Zm0 1c4 1 4 5 1.5 5.5C11 15.8 11 13 11 10Zm-1 0c-1 4-5 4-5.5 1.5C4.2 10 7 10 10 10Z" />
        <circle cx="10.5" cy="9.5" r="1.5" />
        <path d="M10 12v5m0-2-3 2m3-3 3 2" />
      </>}
      {icon === "chakkar" && <>
        <circle cx="10" cy="10" r="5.5" />
        <circle cx="10" cy="10" r="2" />
        <path d="M10 1v3m0 12v3M1 10h3m12 0h3M3.6 3.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1" />
      </>}
      {icon === "sound" && <>
        <path d="M3 8v4h3l4 3V5L6 8zM13 7a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10" />
      </>}
      {icon === "garland" && <>
        <path d="M3 6c2.5 0 2.5 8 5 8s2.5-8 5-8 2.5 8 5 8" />
        <path d="m5 5 1-2m5 4 1-3m4 8 2-1M7 15l-1 2m8-3 1 3" />
      </>}
      {icon === "bomb" && <>
        <path d="M6 7c0-2 2-3 4-3s4 1 4 3l2 2v6H4V9zM9 4l1-2 2 1 2-1" />
        <path d="M7 10h.1m5.8 0h.1m-5 3h4" />
      </>}
      {icon === "spinner" && <>
        <path d="M3 7a7 7 0 0 1 12-2l2 2m0-4v4h-4M17 13a7 7 0 0 1-12 2l-2-2m0 4v-4h4" />
      </>}
      {icon === "spark" && <>
        <path d="m10 2 1.4 5.1L16 5l-2.1 4.6L19 11l-5.1 1.4L16 17l-4.6-2.1L10 20l-1.4-5.1L4 17l2.1-4.6L1 11l5.1-1.4L4 5l4.6 2.1z" />
      </>}
      {icon === "rocket" && <>
        <path d="M11 12c3-2 5-5 5-9-4 0-7 2-9 5l-3 1-1 3 4-1 3 3-1 4 3-1z" />
        <circle cx="12.5" cy="7.5" r="1.2" />
        <path d="m5 14-2 2m4 1-2 1" />
      </>}
      {icon === "fancy" && <>
        <path d="m10 2 1.7 5.2L17 5l-2.2 5 5.2 2-5.2 1.7L17 19l-5-2.2-2 5.2-1.7-5.2L3 19l2.2-5L0 12l5.2-1.7L3 5l5 2.2z" transform="translate(1 -1) scale(.9)" />
        <circle cx="10" cy="10" r="1.5" />
      </>}
      {icon === "shots" && <>
        <circle cx="10" cy="10" r="7" />
        <circle cx="10" cy="10" r="4" />
        <circle cx="10" cy="10" r="1" />
        <path d="M10 1v2m9 7h-2M10 19v-2M1 10h2" />
      </>}
      {icon === "gift" && <>
        <path d="M3 9h14v9H3zM2 6h16v3H2zM10 6v12" />
        <path d="M10 6H7C4 6 5 2 7 3c2 0 3 3 3 3Zm0 0h3c3 0 2-4 0-3-2 0-3 3-3 3Z" />
      </>}
    </svg>
  );
}

function App() {
  const [products, setProducts] = useState<Product[]>(getInitialProducts);
  const [productStorageError, setProductStorageError] = useState("");
  const [cart, setCart] = useState<CartItem[]>(() =>
    readStorage<CartItem[]>("blast-cart-guest", readStorage<CartItem[]>("blast-cart", [])).map(migrateFamilyPack),
  );
  const categories = defaultCategories;
  const [offers, setOffers] = useState<Offer[]>(() => readStorage<Array<Offer & { id: string }>>("blast-offers", defaultOffers).filter((offer) => offer.id === "repeat-order"));
  const [rewardTiers, setRewardTiers] = useState<RewardTier[]>(initialRewardTiers);
  const [rewardTiersError, setRewardTiersError] = useState("");
  const [orderCount, setOrderCount] = useState(() => readStorage<number>("blast-order-count", 0));
  const [category, setCategory] = useState(() => {
    return defaultCategories.includes("Sparklers") ? "Sparklers" : defaultCategories[0] || "";
  });
  const [view, setView] = useState<View>(() => viewForRoute());
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [pendingOrderId, setPendingOrderId] = useState("");
  const [customerDetailsOpen, setCustomerDetailsOpen] = useState(false);
  const [pendingPdfDownload, setPendingPdfDownload] = useState(false);
  const [authReturnTo, setAuthReturnTo] = useState<View>("shop");
  const [user, setUser] = useState<CustomerIdentity | null>(null);
  const [adminAuthenticated, setAdminAuthenticated] = useState(false);
  const [authStateReady, setAuthStateReady] = useState(false);
  const [cartReady, setCartReady] = useState(false);
  const [cartError, setCartError] = useState("");
  const cartSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const queueCartSave = (nextCart: CartItem[]) => {
    const save = cartSaveQueue.current.then(() => saveCustomerCart(nextCart));
    cartSaveQueue.current = save.catch(() => undefined);
    return save;
  };
  useEffect(() => {
    try {
      localStorage.setItem("blast-products", JSON.stringify(products));
    } catch {
      setProductStorageError("This browser could not save the product photo. Free up browser storage and try again.");
    }
  }, [products]);
  useEffect(() => {
    let cancelled = false;
    const loadSessions = async () => {
      try {
        const [customerResponse, adminResponse] = await Promise.all([
          fetch("/api/auth/session"),
          fetch("/api/admin/session"),
        ]);
        const customerSession = await readApiResult<{ user: CustomerIdentity | null }>(customerResponse);
        const adminSession = await readApiResult<{ authenticated: boolean }>(adminResponse);
        if (cancelled) return;
        setUser(customerSession.user);
        setAdminAuthenticated(adminSession.authenticated);
        if (customerSession.user) {
          try {
            const savedCart = await readCustomerCart();
            if (cancelled) return;
            const guestCart = readStorage<CartItem[]>("blast-cart-guest", readStorage<CartItem[]>("blast-cart", []));
            const restoredCart = savedCart.length ? savedCart : guestCart;
            if (!savedCart.length && guestCart.length) await queueCartSave(guestCart);
            localStorage.removeItem("blast-cart");
            localStorage.removeItem("blast-cart-guest");
            setCart(restoredCart.map(migrateFamilyPack));
          } catch (cause) {
            if (cancelled) return;
            await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
            setUser(null);
            setCart(readStorage<CartItem[]>("blast-cart-guest", readStorage<CartItem[]>("blast-cart", [])).map(migrateFamilyPack));
            setCartError(cause instanceof Error ? `Your saved account cart could not be restored. Please sign in again. ${cause.message}` : "Your saved account cart could not be restored. Please sign in again.");
          }
        }
      } catch (cause) {
        if (!cancelled) {
          setCartError(cause instanceof Error ? cause.message : "Your saved session could not be loaded.");
          setUser(null);
          setCart(readStorage<CartItem[]>("blast-cart-guest", readStorage<CartItem[]>("blast-cart", [])).map(migrateFamilyPack));
        }
      } finally {
        if (!cancelled) {
          setAuthStateReady(true);
          setCartReady(true);
        }
      }
    };
    void loadSessions();
    return () => { cancelled = true; };
  }, []);
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
    if (!cartReady) return;
    if (!user) {
      localStorage.setItem("blast-cart-guest", JSON.stringify(cart));
      return;
    }
    const timer = window.setTimeout(() => {
      void queueCartSave(cart).then(() => setCartError("")).catch((cause: unknown) => {
        setCartError(cause instanceof Error ? cause.message : "Your cart could not be saved to your account.");
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [cart, user, cartReady]);
  const subtotal = cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  const activeOffer = getApplicableOffer(subtotal, user, offers, orderCount);
  const total = Math.max(0, subtotal - (activeOffer?.discount || 0));
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
  const scrollToCategory = (nextCategory: string) => {
    setCategory(nextCategory);
    if (view !== "shop") {
      navigate("shop", nextCategory);
      window.setTimeout(() => {
        document.getElementById(`category-${categories.indexOf(nextCategory)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
      return;
    }
    document.getElementById(`category-${categories.indexOf(nextCategory)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  useEffect(() => {
    const syncRoute = () => setView(viewForRoute());
    window.addEventListener("popstate", syncRoute);
    window.addEventListener("hashchange", syncRoute);
    return () => { window.removeEventListener("popstate", syncRoute); window.removeEventListener("hashchange", syncRoute); };
  }, []);
  useEffect(() => {
    if (view !== "shop") return;
    const sections = document.querySelectorAll<HTMLElement>(".category-section");
    if (!sections.length) return;
    const observer = new IntersectionObserver((entries) => {
      const visibleSections = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio);
      const nextCategory = visibleSections[0]?.target.getAttribute("data-category");
      if (nextCategory) setCategory(nextCategory);
    }, { rootMargin: "-115px 0px -60% 0px", threshold: [0, 0.1, 0.35, 0.6] });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [view]);
  useEffect(() => {
    if (!authStateReady) return;
    const isAdminRoute = view === "catalogue" || view === "admin-customers" || view === "order-entry" || view === "pdf-builder";
    if (isAdminRoute && !adminAuthenticated) {
      window.history.replaceState({}, "", routeForView("admin-login"));
    } else if (view === "admin-login" && adminAuthenticated) {
      window.history.replaceState({}, "", routeForView("catalogue"));
    }
  }, [view, adminAuthenticated, authStateReady]);
  const isAdminView = view === "catalogue" || view === "admin-customers" || view === "order-entry" || view === "pdf-builder";
  const renderedView: View = !authStateReady && isAdminView
    ? "admin-login"
    : isAdminView && !adminAuthenticated
      ? "admin-login"
      : view === "admin-login" && adminAuthenticated
        ? "catalogue"
        : view;
  const openAdmin = () => {
    navigate(adminAuthenticated ? "catalogue" : "admin-login");
  };
  const startPayment = async () => {
    if (!user || cart.length === 0) return;
    setPaymentError("");
    try {
      const response = await fetch("/api/customer-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cart, discount: activeOffer?.discount || 0 }),
      });
      const result = await readApiResult<{ orderId: string }>(response);
      setPendingOrderId(result.orderId);
    } catch (cause) {
      setCartError(cause instanceof Error ? cause.message : "Your order could not be recorded.");
      return;
    }
    setPaymentOpen(true);
  };
  const requestPaymentLogin = () => {
    setAuthReturnTo("cart");
    setPendingPdfDownload(false);
    setCustomerDetailsOpen(true);
  };
  const openCart = (promptForDetails = false) => {
    navigate("cart");
    if (authStateReady && !user && (cart.length > 0 || promptForDetails)) {
      setAuthReturnTo("cart");
      setPendingPdfDownload(false);
      setCustomerDetailsOpen(true);
    }
  };
  const downloadPdfAfterAuth = () => {
    if (!user) {
      setAuthReturnTo("cart");
      setPendingPdfDownload(true);
      setCustomerDetailsOpen(true);
      return;
    }
    const rewardTiersEarned = getEarnedRewards(rewardTiers, subtotal);
    const rewards = [
      rewardTiersEarned.reduce((sum, tier) => sum + tier.candleValue, 0) > 0
        ? `${money(rewardTiersEarned.reduce((sum, tier) => sum + tier.candleValue, 0))} worth of candles`
        : "",
      rewardTiersEarned.reduce((sum, tier) => sum + tier.crackerValue, 0) > 0
        ? `${money(rewardTiersEarned.reduce((sum, tier) => sum + tier.crackerValue, 0))} worth of crackers`
        : "",
      ...new Set(rewardTiersEarned.map((tier) => tier.bonusPack).filter(Boolean)),
    ].filter(Boolean);
    downloadCartPdf(cart, subtotal, total, activeOffer, rewards);
  };
  const authenticate = async (input: AuthenticationInput) => {
    const identity = await authenticateCustomer(input);
    const savedCart = await readCustomerCart();
    const guestCart = readStorage<CartItem[]>("blast-cart-guest", readStorage<CartItem[]>("blast-cart", []));
    const restoredCart = savedCart.length ? savedCart : guestCart;
    if (!savedCart.length && guestCart.length) await queueCartSave(guestCart);
    localStorage.removeItem("blast-cart");
    localStorage.removeItem("blast-cart-guest");
    setCart(restoredCart.map(migrateFamilyPack));
    setUser(identity);
    setCartError("");
    setCartReady(true);
    setCustomerDetailsOpen(false);
    navigate(authReturnTo);
    if (pendingPdfDownload) {
      const cartSubtotal = restoredCart.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const customerOffer = getApplicableOffer(cartSubtotal, identity, offers, orderCount);
      const earned = getEarnedRewards(rewardTiers, cartSubtotal);
      const rewards = [
        earned.reduce((sum, tier) => sum + tier.candleValue, 0) > 0
          ? `${money(earned.reduce((sum, tier) => sum + tier.candleValue, 0))} worth of candles`
          : "",
        earned.reduce((sum, tier) => sum + tier.crackerValue, 0) > 0
          ? `${money(earned.reduce((sum, tier) => sum + tier.crackerValue, 0))} worth of crackers`
          : "",
        ...new Set(earned.map((tier) => tier.bonusPack).filter(Boolean)),
      ].filter(Boolean);
      downloadCartPdf(restoredCart, cartSubtotal, Math.max(0, cartSubtotal - (customerOffer?.discount || 0)), customerOffer, rewards);
      setPendingPdfDownload(false);
    }
  };
  const signOutCustomer = async () => {
    try {
      await queueCartSave(cart);
      await readApiResult<{ signedOut: boolean }>(await fetch("/api/auth/logout", { method: "POST" }));
      setUser(null);
      setCart([]);
      setPaymentOpen(false);
      setCartError("");
      navigate("customer-auth");
    } catch (cause) {
      setCartError(cause instanceof Error ? cause.message : "Sign out could not be completed.");
    }
  };
  const signOutAdmin = async () => {
    try {
      await readApiResult<{ signedOut: boolean }>(await fetch("/api/admin/logout", { method: "POST" }));
      setAdminAuthenticated(false);
      navigate("admin-login");
    } catch (cause) {
      setCartError(cause instanceof Error ? cause.message : "Admin sign out could not be completed.");
    }
  };
  const completePurchase = async () => {
    if (!pendingOrderId) {
      throw new Error("No pending order was found. Please restart checkout.");
    }
    const confirmResponse = await fetch(`/api/customer-orders/${pendingOrderId}/confirm`, { method: "POST" });
    await readApiResult<{ confirmed: boolean }>(confirmResponse);
    if (activeOffer?.id === "welcome") {
      const response = await fetch("/api/customer-welcome-offer/redeem", { method: "POST" });
      await readApiResult<{ available: boolean }>(response);
      setUser((current) => current ? { ...current, welcomeOfferAvailable: false } : current);
    }
    setPaymentOpen(false);
    setPendingOrderId("");
    setOrderCount((count) => count + 1);
    setCart([]);
    alert("Payment successful. Your order has been recorded.");
    navigate("shop");
  };
  return (
    <div className="site-shell">
      {renderedView !== "admin-login" && (
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
              className={renderedView === "shop" ? "nav-active" : ""}
              onClick={() => setShopView()}
            >
              Home
            </button>
            <button
              className={renderedView === "contact" ? "nav-active" : ""}
              onClick={() => navigate("contact")}
            >
              Quick Enquiry
            </button>
            <button onClick={() => setShopView("Sparklers")}>
              Crackers
            </button>
            <button className={renderedView === "offers" ? "nav-active" : ""} onClick={() => navigate("offers")}>Offers</button>
            <button className={renderedView === "about" ? "nav-active" : ""} onClick={() => navigate("about")}>About</button>
            <button className={renderedView === "contact" ? "nav-active" : ""} onClick={() => navigate("contact")}>Contact</button>
          </nav>
          <div className="header-tools">
            {user
              ? <button className="customer-signout" type="button" onClick={() => void signOutCustomer()}>Sign out</button>
              : <button className="customer-signout" type="button" onClick={() => { setAuthReturnTo("shop"); navigate("customer-auth"); }}>Sign in</button>}
            <button
              className="header-cart"
              aria-label="Open cart"
              onClick={() => openCart()}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M3 4h2l2.2 10.1a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 1.9-1.4L21 8H6" />
                <circle cx="10" cy="20" r="1.3" />
                <circle cx="18" cy="20" r="1.3" />
              </svg>
              <b>{count}</b>
            </button>
          </div>
        </header>
      )}
      {cartError && <p className="cart-sync-error" role="alert">{cartError}</p>}
      {renderedView === "admin-login" && (
        <AdminLogin
          onBack={() => navigate("shop")}
          onLogin={async (email, password) => {
            const response = await fetch("/api/admin/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email, password }),
            });
            await readApiResult<{ authenticated: boolean }>(response);
            setAdminAuthenticated(true);
            navigate("catalogue");
          }}
        />
      )}
      {renderedView === "customer-auth" && <Auth onAuth={authenticate} onBack={() => navigate(authReturnTo)} />}
      {renderedView === "shop" && (
        <main className="quick-order">
          <aside className="category-panel">
            <h3>CATEGORIES</h3>
            <select value={category} onChange={(event) => scrollToCategory(event.target.value)} aria-label="Choose category">
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            {categories.map((item) => (
              <button
                className={category === item ? "category-active" : ""}
                key={item}
                onClick={() => scrollToCategory(item)}
              >
                <CategoryIcon category={item} />
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
              <button className="mobile-cart" onClick={() => openCart()}>
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
            {categories.map((categoryName, categoryIndex) => (
              <section
                className="category-section"
                id={`category-${categoryIndex}`}
                data-category={categoryName}
                key={categoryName}
              >
                <div className="table-wrap">
                  <div className="table-title">
                    <CategoryIcon category={categoryName} />
                    <strong>{categoryName}</strong>
                  </div>
                  <div className="table-head">
                    <span>No.</span>
                    <span>Product Name</span>
                    <span>Price</span>
                    <span>Quantity</span>
                    <span>Total</span>
                  </div>
                  {products.filter((product) => product.category === categoryName).map((product) => {
                    const quantity = cart.find((item) => item.id === product.id)?.quantity || 0;
                    return (
                      <div className="product-row" key={product.id}>
                        <span>#{product.id}</span>
                        <div className="product-name">
                          <div className="product-photo" style={{ backgroundImage: `url(${product.image})` }} />
                          <div className="product-details">
                            <strong>{product.name}</strong>
                            {product.pack && <small>{product.pack}</small>}
                          </div>
                        </div>
                        <strong className="best-price">{money(product.price)}</strong>
                        <div className="stepper">
                          <button type="button" aria-label={`Decrease quantity for ${product.name}`} onClick={() => changeQuantity(product, -1)}>−</button>
                          <input
                            aria-label={`Quantity for ${product.name}`}
                            type="number"
                            min="0"
                            value={quantity || ""}
                            onChange={(event) => changeQuantity(product, Number(event.target.value || 0) - quantity)}
                          />
                          <button type="button" aria-label={`Increase quantity for ${product.name}`} onClick={() => changeQuantity(product, 1)}>+</button>
                        </div>
                        <strong>{money(product.price * quantity)}</strong>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </section>
        </main>
      )}
      {renderedView === "cart" && (
        <Cart
          cart={cart}
          subtotal={subtotal}
          total={total}
          offer={activeOffer}
          rewardTiers={rewardTiers}
          rewardTiersError={rewardTiersError}
          count={count}
          onChange={changeQuantity}
          onBack={() => setShopView()}
          user={user !== null}
          onLogin={requestPaymentLogin}
          onDownloadPdf={downloadPdfAfterAuth}
          onCheckout={startPayment}
        />
      )}
      {renderedView === "offers" && <OffersPage offers={offers} rewardTiers={rewardTiers} rewardTiersError={rewardTiersError} onBack={() => setShopView()} />}
      {renderedView === "order-entry" && (
        <OrderEntry products={products} onSubmit={(selections) => { submitOrderSelections(selections); openCart(true); }} onCart={() => openCart()} />
      )}
      {renderedView === "pdf-builder" && (
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
      {renderedView === "catalogue" && (
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
          onOrderEntry={() => navigate("order-entry")}
          onPhotoManagement={() => navigate("pdf-builder")}
          onCustomers={() => navigate("admin-customers")}
          onLogout={() => void signOutAdmin()}
        />
      )}
      {renderedView === "admin-customers" && <AdminCustomersPage onBack={() => navigate("catalogue")} />}
      {renderedView === "about" && <InfoPage kind="about" onContact={() => navigate("contact")} />}
      {renderedView === "contact" && <InfoPage kind="contact" onContact={() => navigate("contact")} />}
      {renderedView !== "admin-login" && renderedView !== "pdf-builder" && (
        <div className="floating-actions">
          <a
            className="whatsapp"
            aria-label="Chat with SLV Crackers on WhatsApp"
            href="https://wa.me/919000488963?text=Hello%20SLV%20Crackers%2C%20I%20would%20like%20to%20know%20more."
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M20.5 11.8a8.4 8.4 0 0 1-12.4 7.4L3 20.5l1.3-4.9a8.4 8.4 0 1 1 16.2-3.8Z" />
              <path d="M8.5 8.1c.2-.4.4-.4.7-.4h.5c.2 0 .4.1.5.4l.7 1.7c.1.3.1.5-.1.7l-.5.6c-.2.2-.2.4-.1.6.5.9 1.2 1.6 2.1 2.1.2.1.4.1.6-.1l.7-.8c.2-.2.4-.3.7-.2l1.6.8c.3.1.4.3.4.5 0 .5-.3 1.3-.8 1.7-.5.5-1.2.7-1.9.6-1.1-.2-2.4-.8-3.7-1.9-1.1-1-2-2.3-2.3-3.4-.3-1.1 0-2.2.9-2.9Z" />
            </svg>
          </a>
          <button
            className="floating-cart"
            onClick={() => openCart()}
            aria-label="Open cart"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M3 4h2l2.2 10.1a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 1.9-1.4L21 8H6" />
              <circle cx="10" cy="20" r="1.3" />
              <circle cx="18" cy="20" r="1.3" />
            </svg>
            <b>{count}</b>
          </button>
        </div>
      )}
      <footer>
        <span>SLV CRACKERS</span>
        <span>Safe products. Bright celebrations.</span>
        {renderedView !== "admin-login" && (
          <button onClick={openAdmin}>Shop management</button>
        )}
      </footer>
      {paymentOpen && <PaymentModal total={total} error={paymentError} onClose={() => setPaymentOpen(false)} onPaid={() => {
        void completePurchase().catch((cause: unknown) => {
          setPaymentError(cause instanceof Error ? cause.message : "Your order could not be recorded.");
        });
      }} />}
      {customerDetailsOpen && (
        <Auth
          modal
          initialMode="register"
          onAuth={authenticate}
          onBack={() => setCustomerDetailsOpen(false)}
          onCancel={() => { setCustomerDetailsOpen(false); setPendingPdfDownload(false); }}
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
  return <main className="order-entry-page"><div className="entry-header"><div><p className="admin-kicker">SLV / ORDER ENTRY</p><h1>Add items by product ID</h1><p>Select multiple products and quantities, then submit them together to the cart.</p></div><button className="download-pdf" onClick={onCart}>Go to cart</button></div><div className="order-entry-grid"><div><form className="order-entry-form" onSubmit={addItem}><label>Product ID<input type="number" min="1" max={products.length} value={productId} onChange={(event) => setProductId(event.target.value)} placeholder="Example: 1" required /></label><label>Quantity<div className="entry-stepper"><button type="button" onClick={() => setQuantity(Math.max(1, quantity - 1))}>−</button><input type="number" min="1" value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))} /><button type="button" onClick={() => setQuantity(quantity + 1)}>+</button></div></label>{selected && <div className="selected-product"><strong>#{Number(productId)} {selected.name}</strong><span>{selected.category} / {selected.pack} / {money(selected.price)}</span></div>}{message && <p className="entry-message">{message}</p>}<button className="save-product" type="submit">Add item</button></form></div><section className="entry-reference">{selections.length > 0 && <><h2>Selected items</h2>{selections.map((item) => <div className="entry-product selected-entry-product" key={item.product.id}><b>#{products.indexOf(item.product) + 1}</b><span>{item.product.name}<small>Qty {item.quantity} × {money(item.product.price)}</small></span><strong>{money(item.product.price * item.quantity)}</strong><button type="button" onClick={() => setSelections(selections.filter((selectedItem) => selectedItem.product.id !== item.product.id))}>Remove</button></div>)}<div className="selection-total"><span>Estimated total</span><strong>{money(selections.reduce((sum, item) => sum + item.product.price * item.quantity, 0))}</strong></div><button className="save-product" type="button" onClick={() => onSubmit(selections)}>Submit selected items to cart →</button></>}<h2>Product IDs</h2>{products.map((product, index) => <div className="entry-product" key={product.id}><b>#{index + 1}</b><span>{product.name}<small>{product.category}</small></span><strong>{money(product.price)}</strong></div>)}</section></div></main>;
}

function OffersPage({ offers, rewardTiers, rewardTiersError, onBack }: { offers: Offer[]; rewardTiers: RewardTier[]; rewardTiersError: string; onBack: () => void }) {
  return (
    <main className="offers-page">
      <button className="back-link" onClick={onBack}>← Continue shopping</button>
      <p className="admin-kicker">SLV / OFFERS</p>
      <h1>Celebrate more, save more.</h1>
      <p className="offers-intro">Shopping rewards and eligible repeat-order discounts are applied when your cart meets the conditions.</p>
      {rewardTiersError && <p className="reward-api-error" role="alert">{rewardTiersError}</p>}
      <div className="offer-cards">
        {offers.filter((offer) => offer.enabled).map((offer) => (
          <article className="offer-card" key={offer.id}>
            <span className="offer-card-mark">-{money(offer.discount)}</span>
            <div><p className="offer-card-kicker">REPEAT PURCHASES</p><h2>{offer.title}</h2><p>{offer.description}</p><strong>Minimum cart value: {money(offer.threshold)}</strong></div>
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
  rewardTiers,
  rewardTiersError,
  count,
  onChange,
  onBack,
  user,
  onLogin,
  onDownloadPdf,
  onCheckout,
}: {
  cart: CartItem[];
  subtotal: number;
  total: number;
  offer?: Offer;
  rewardTiers: RewardTier[];
  rewardTiersError: string;
  count: number;
  onChange: (product: Product, delta: number) => void;
  onBack: () => void;
  user: boolean;
  onLogin: () => void;
  onDownloadPdf: () => void;
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
          onClick={onDownloadPdf}
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
                  <small>{money(item.price)}{item.pack ? ` / ${item.pack}` : ""}</small>
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
  onBack,
  onAuth,
  modal = false,
  initialMode = "login",
  onCancel,
}: {
  onBack: () => void;
  onAuth: (input: AuthenticationInput) => Promise<void>;
  modal?: boolean;
  initialMode?: "login" | "register";
  onCancel?: () => void;
}) {
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mode === "register" && !consented) {
      setError("Please agree to contact follow-up before creating an account.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onAuth(mode === "register"
        ? { mode, customer: { name, phone, email, password, consented } }
        : { mode, identifier, password });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in could not be completed.");
    } finally {
      setSaving(false);
    }
  };
  const form = (
      <form className={`account-card${modal ? " account-modal-card" : ""}`} onSubmit={(event) => void submit(event)}>
        <p className="admin-kicker">SLV CUSTOMER ACCOUNT</p>
        <h1>{mode === "login" ? "Sign in" : "Create your account"}</h1>
        <p>{mode === "login" ? "Sign in to continue checkout and restore your saved cart." : "Register once to save your cart and let us follow up on your enquiry."}</p>
        {mode === "register" && <>
          <label>Your name<input required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label>
          <label>Mobile number<input required type="tel" inputMode="numeric" pattern="[0-9]{10}" maxLength={10} value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" placeholder="10-digit mobile number" /></label>
        </>}
        {mode === "register"
          ? <label>Email address<input required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
          : <label>Email or mobile number<input required type="text" maxLength={254} value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" placeholder="Email or 10-digit mobile number" /></label>}
        <label>Password<input required type="password" minLength={mode === "register" ? 10 : undefined} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} /></label>
        {mode === "register" && <label className="contact-consent"><input type="checkbox" required checked={consented} onChange={(event) => setConsented(event.target.checked)} />I agree that SLV Crackers may store my contact details and contact me about my enquiry or order.</label>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="account-submit" type="submit" disabled={saving}>{saving ? "Please wait..." : mode === "login" ? "Sign in →" : "Create account →"}</button>
        {mode === "login" && <a
          className="account-switch"
          href={`https://wa.me/919000488963?text=${encodeURIComponent(`Hello SLV Crackers, I forgot my account password. My registered email/mobile is ${identifier || "[enter your registered email or mobile number]"}. Please help me reset it.`)}`}
          target="_blank"
          rel="noopener noreferrer"
        >Forgot password? Request an admin reset on WhatsApp</a>}
        <button className="account-switch" type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
          {mode === "login" ? "New customer? Create an account" : "Already registered? Sign in"}
        </button>
      </form>
  );
  if (modal) {
    return (
      <div className="modal-backdrop customer-details-backdrop">
        <section className="customer-details-dialog" role="dialog" aria-modal="true" aria-label="Customer details and welcome offer">
          {onCancel && <button type="button" className="close" onClick={onCancel} aria-label="Close customer details">×</button>}
          <div className="customer-welcome-offer">
            <strong>Welcome! Get ₹50 off your first order.</strong>
            <span>Create your account once. Your details and offer eligibility are saved for your next sign-in.</span>
          </div>
          {form}
        </section>
      </div>
    );
  }
  return (
    <main className="account-page">
      <button type="button" className="back-link" onClick={onBack}>← Back to shopping</button>
      {form}
    </main>
  );
}

function PaymentModal({ total, error, onClose, onPaid }: { total: number; error: string; onClose: () => void; onPaid: () => void }) {
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
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="payment-confirm" type="button" onClick={onPaid}>I have completed the payment</button>
        <small className="payment-note">Your order is recorded after you confirm the payment.</small>
      </section>
    </div>
  );
}

function AdminLogin({ onBack, onLogin }: { onBack: () => void; onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onLogin(email, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Admin sign-in could not be completed.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <main className="admin-login-page">
      <div className="admin-login-card">
        <button type="button" className="back-link" onClick={onBack}>← Back to website</button>
        <div className="admin-login-brand">
          <span>✦</span> SLV
        </div>
        <p className="admin-kicker">STORE ADMINISTRATION</p>
        <h1>Welcome back.</h1>
        <p className="admin-intro">
          Sign in to update your crackers, rates, and customer catalogue.
        </p>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            Admin email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
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
          {!import.meta.env.DEV && <small className="contact-security-note">Admin sign-in requires HTTPS or a local SSH tunnel.</small>}
          <button type="submit" disabled={saving}>{saving ? "Signing in..." : "Sign in to dashboard →"}</button>
        </form>
        <p className="demo-hint">Use the administrator email and password configured privately on the server. Contact your site owner if you do not have them.</p>
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
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/reward-tiers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
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
        <button type="button" className="save-product" onClick={() => void saveTiers()} disabled={saving}>{saving ? "Saving rewards..." : "Save shopper offers"}</button>
      </div>
      {error && <p className="catalog-maker-error" role="alert">{error}</p>}
      {status && <p className="catalog-maker-status" role="status">{status}</p>}
    </section>
  );
}

function AdminCustomersPage({ onBack }: { onBack: () => void }) {
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetStatus, setResetStatus] = useState("");

  const loadRecords = async () => {
    setLoading(true);
    setError("");
    try {
      const [customerResponse, orderResponse] = await Promise.all([fetch("/api/customers"), fetch("/api/orders")]);
      const customerResult = await readApiResult<{ customers?: unknown }>(customerResponse);
      const orderResult = await readApiResult<{ orders?: unknown }>(orderResponse);
      if (!Array.isArray(customerResult.customers) || !customerResult.customers.every(isCustomerRecord)) {
        throw new Error("The server returned invalid customer registration data.");
      }
      if (!Array.isArray(orderResult.orders)) throw new Error("The server returned invalid order history.");
      setCustomers(customerResult.customers);
      setOrders(orderResult.orders as CustomerOrder[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Customer records and orders could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void loadRecords().catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Customer records could not be loaded.");
    });
    return () => { cancelled = true; };
  }, []);

  const resetEditor = () => {
    setEditingId("");
    setName("");
    setPhone("");
    setEmail("");
    setResetPassword("");
    setResetStatus("");
  };
  const editCustomer = (customer: CustomerRecord) => {
    setEditingId(customer.id);
    setName(customer.name);
    setPhone(customer.phone);
    setEmail(customer.email);
    setResetPassword("");
    setResetStatus("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const saveCustomer = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      const response = await fetch("/api/customers", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", ...(editingId ? { "X-Customer-Id": editingId } : {}) },
        body: JSON.stringify({ name, phone, email }),
      });
      await readApiResult<{ customer: CustomerRecord }>(response);
      resetEditor();
      await loadRecords();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Customer details could not be saved.");
    }
  };
  const deleteCustomer = async (customer: CustomerRecord) => {
    if (!window.confirm(`Remove ${customer.name}'s customer record? Their order history will remain in the archive.`)) return;
    setError("");
    try {
      const response = await fetch("/api/customers", { method: "DELETE", headers: { "X-Customer-Id": customer.id } });
      await readApiResult<{ deleted: boolean }>(response);
      await loadRecords();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Customer record could not be removed.");
    }
  };
  const updateCustomerPassword = async (event: FormEvent, customerId: string) => {
    event.preventDefault();
    setError("");
    setResetStatus("");
    try {
      const response = await fetch("/api/customers/password", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Customer-Id": customerId },
        body: JSON.stringify({ password: resetPassword }),
      });
      await readApiResult<{ updated: boolean }>(response);
      setResetPassword("");
      setResetStatus("Password reset. Share the new password with the customer only after verifying their identity.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Customer password could not be reset.");
    }
  };
  const downloadCsv = (filename: string, rows: string[][]) => {
    const csv = rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };
  const exportCustomers = () => downloadCsv("SLV_Customers.csv", [
    ["Name", "Phone", "Email", "Registered"],
    ...customers.map((customer) => [customer.name, customer.phone, customer.email, customer.registeredAt]),
  ]);
  const exportOrders = () => downloadCsv("SLV_Customer_Orders.csv", [
    ["Order ID", "Customer", "Phone", "Email", "Attempted at", "Status", "Subtotal", "Discount", "Total", "Item", "Quantity", "Unit price", "Line total"],
    ...orders.flatMap((order) => order.items.map((item) => [
      order.id, order.customerName, order.customerPhone, order.customerEmail, order.attemptedAt,
      order.status, String(order.subtotal), String(order.discount), String(order.total),
      item.name, String(item.quantity), String(item.price), String(item.price * item.quantity),
    ])),
  ]);

  return (
    <main className="admin-page">
      <button type="button" className="back-link" onClick={onBack}>← Back to admin dashboard</button>
      <div className="admin-top">
        <div><p className="admin-kicker">SLV / CUSTOMER RECORDS</p><h1>Customers &amp; orders</h1><p>Manage contact records and review each customer's repeated order attempts.</p></div>
        <button type="button" className="save-product" onClick={onBack}>Admin dashboard</button>
      </div>
      {error && <p className="catalog-maker-error" role="alert">{error}</p>}
      <section className="admin-products customer-manager">
        <div className="admin-products-head"><h2>{editingId ? "Update customer" : "Add customer"}</h2></div>
        <form className="customer-editor" onSubmit={(event) => void saveCustomer(event)}>
          <label>Name<input required minLength={2} maxLength={100} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>10-digit phone<input required pattern="[0-9]{10}" maxLength={10} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
          <label>Email<input required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <div className="customer-editor-actions">
            <button type="submit" className="save-product">{editingId ? "Save changes" : "Add customer"}</button>
            {editingId && <button type="button" className="catalog-folder-button" onClick={resetEditor}>Cancel edit</button>}
          </div>
        </form>
        {editingId && <section className="customer-password-editor" aria-labelledby="customer-password-heading">
          <div className="admin-products-head"><h3 id="customer-password-heading">Change customer password</h3></div>
          <p className="offer-admin-note">Set a new password for {name}. Verify the customer's identity before sharing it. This will sign them out of existing sessions.</p>
          <form className="customer-password-form" onSubmit={(event) => void updateCustomerPassword(event, editingId)}>
            <label>New password<input required type="password" minLength={10} maxLength={128} autoComplete="new-password" value={resetPassword} onChange={(event) => { setResetPassword(event.target.value); setResetStatus(""); }} /></label>
            <button type="submit" className="save-product">Change password</button>
          </form>
          {resetStatus && <p className="catalog-maker-status" role="status">{resetStatus}</p>}
        </section>}
      </section>
      <section className="admin-products customer-manager">
        <div className="admin-products-head"><h2>Customer registrations</h2><span>{customers.length} customers · {orders.length} order attempts</span></div>
        <p className="offer-admin-note">One customer account is identified by unique email. Each checkout attempt is retained as a separate order; confirmation here records the customer's confirmation, not independently verified payment.</p>
        <p className="offer-admin-note">Select <strong>Edit</strong> on a customer to update their details or change their password. Verify the customer's identity before sharing a new password.</p>
        <div className="customer-export-actions">
          <button type="button" className="catalog-folder-button" onClick={exportCustomers} disabled={!customers.length}>Download customers CSV</button>
          <button type="button" className="catalog-folder-button" onClick={exportOrders} disabled={!orders.length}>Download order details CSV</button>
        </div>
        {loading ? <p className="offer-admin-note" role="status">Loading customer and order records...</p> : customers.length === 0
          ? <p>No customer accounts have registered yet.</p>
          : <div className="customer-list">
            {[...customers].reverse().map((customer) => {
              const customerOrders = orders.filter((order) => order.customerId === customer.id);
              return (
                <details className="customer-record" key={customer.id}>
                  <summary>
                    <span><strong>{customer.name}</strong><small>{customerOrders.length} orders · {money(customerOrders.reduce((sum, order) => sum + order.total, 0))} total attempted</small></span>
                    <span>{customer.phone} · {customer.email}</span>
                  </summary>
                  <div className="customer-record-actions">
                    <a href={`tel:${customer.phone}`}>Call customer</a>
                    <a href={`mailto:${customer.email}`}>Email customer</a>
                    <button type="button" onClick={() => editCustomer(customer)}>Edit</button>
                    <button type="button" className="catalog-remove-photo" onClick={() => void deleteCustomer(customer)}>Remove</button>
                  </div>
                  <div className="customer-orders-list">
                    {customerOrders.length ? customerOrders.map((order) => (
                      <article className="customer-order-card" key={order.id}>
                        <div><strong>{money(order.total)}</strong><span>{new Date(order.attemptedAt).toLocaleString("en-IN")} · {order.status}</span></div>
                        <p>Subtotal {money(order.subtotal)}{order.discount ? ` · Discount -${money(order.discount)}` : ""}</p>
                        <ul>{order.items.map((item) => <li key={`${order.id}-${item.id}`}>{item.name} — {item.quantity} × {money(item.price)} = {money(item.price * item.quantity)}</li>)}</ul>
                      </article>
                    )) : <p className="offer-admin-note">No checkout attempts have been recorded for this customer.</p>}
                  </div>
                </details>
              );
            })}
          </div>}
        {orders.some((order) => !customers.some((customer) => customer.id === order.customerId)) && (
          <section className="archived-orders">
            <h3>Order history for removed customer records</h3>
            {orders.filter((order) => !customers.some((customer) => customer.id === order.customerId)).map((order) => (
              <article className="customer-order-card" key={order.id}>
                <div><strong>{order.customerName} · {money(order.total)}</strong><span>{new Date(order.attemptedAt).toLocaleString("en-IN")} · {order.status}</span></div>
                <p>{order.customerPhone} · {order.customerEmail} · Subtotal {money(order.subtotal)}{order.discount ? ` · Discount -${money(order.discount)}` : ""}</p>
                <ul>{order.items.map((item) => <li key={`${order.id}-${item.id}`}>{item.name} — {item.quantity} × {money(item.price)} = {money(item.price * item.quantity)}</li>)}</ul>
              </article>
            ))}
          </section>
        )}
      </section>
    </main>
  );
}

function InfoPage({ kind, onContact }: { kind: "about" | "contact"; onContact: () => void }) {
  if (kind === "contact") {
    return <main className="info-page"><p className="admin-kicker">SLV / CONTACT</p><h1>We’re here to help.</h1><p>Call us about product availability, your cart, or an order.</p><a className="save-product info-call-link" href="tel:+919000488963">Call +91 90004 88963</a><p className="offer-admin-note">For a written enquiry, add your products to the cart and sign in to save your selection.</p></main>;
  }
  return <main className="info-page"><p className="admin-kicker">SLV / ABOUT</p><h1>Bright celebrations, great prices.</h1><p>SLV Crackers helps you browse products by category, prepare a clear order summary, and keep your selections together in your cart.</p><button className="save-product" type="button" onClick={onContact}>Contact SLV Crackers →</button></main>;
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
  onOrderEntry,
  onPhotoManagement,
  onCustomers,
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
  onOrderEntry: () => void;
  onPhotoManagement: () => void;
  onCustomers: () => void;
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
          <button onClick={onOrderEntry}>Order entry</button>
          <button onClick={onPhotoManagement}>Manage category photos</button>
          <button onClick={onCustomers}>Customer details</button>
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
            <p className="offer-admin-note">Runs on orders after the first completed purchase.</p>
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
