require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const Razorpay = require("razorpay");
const admin = require("firebase-admin");
const { v2: cloudinary } = require("cloudinary");

const app = express();
const ROOT = path.join(__dirname, "..");
const FRONTEND = path.join(ROOT, "frontend");
const DATA_DIR = path.join(__dirname, "data");
const LOCAL_DB = path.join(DATA_DIR, "admin-data.json");
const PORT = Number(process.env.PORT || 3000);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "4mb" }));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit({ windowMs: 60_000, max: 500, standardHeaders: true, legacyHeaders: false }));

const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "shaurya123").trim();
const SHIP = Number(process.env.SHIPPING_CHARGE || 49);
const FREE = Number(process.env.FREE_SHIPPING_THRESHOLD || 499);

let db = null;
let shippingSettings = { shippingCharge: SHIP, freeShippingThreshold: FREE, freeShippingEnabled: true, estimatedDeliveryDays: 5 };
const DEFAULT_CATEGORIES = ["Keychains", "Hair Clips", "Gift Sets", "Accessories", "Custom Gifts"];
const DEFAULT_PRICE_BUCKETS = [
  { id: "under-49", label: "Under ₹49", min: 0, max: 49, active: true, order: 1 },
  { id: "under-69", label: "Under ₹69", min: 0, max: 69, active: true, order: 2 },
  { id: "under-99", label: "Under ₹99", min: 0, max: 99, active: true, order: 3 },
  { id: "under-149", label: "Under ₹149", min: 0, max: 149, active: true, order: 4 }
];

let products = [
  { id: "wc1", sku: "WC-KC-001", tags: ["BEST SELLER", "CUTE PICK"], name: "Blueberry Yarn Keychain", description: "Soft handmade yarn keychain.", category: "Keychains", price: 149, originalPrice: 179, stock: 20, featured: false, trending: true, slider: true, sliderOrder: 1, badge: "BEST SELLER", createdAt: Date.now(), image: "https://placehold.co/700x700/f3e5df/8d5b4c?text=Keychain", images: [] },
  { id: "wc2", sku: "WC-HC-001", tags: ["CUTE PICK"], name: "Pink Flower Hair Clip", description: "Cute handmade flower clip.", category: "Hair Clips", price: 129, stock: 18, featured: false, trending: true, slider: true, sliderOrder: 2, badge: "CUTE PICK", createdAt: Date.now(), image: "https://placehold.co/700x700/f3e5df/8d5b4c?text=Flower+Clip", images: [] },
  { id: "wc3", sku: "WC-GS-001", tags: ["GIFT"], name: "Pastel Gift Set", description: "A sweet handmade mini gift set.", category: "Gift Sets", price: 299, originalPrice: 349, stock: 12, featured: false, trending: true, slider: true, sliderOrder: 3, badge: "GIFT", createdAt: Date.now(), image: "https://placehold.co/700x700/f3e5df/8d5b4c?text=Gift+Set", images: [] }
];
let orders = [];
let priceBuckets = [...DEFAULT_PRICE_BUCKETS];
let categories = [...DEFAULT_CATEGORIES];
const HOME_SECTION_DEFAULTS = {
  handmadeHighlights: [],
  flashSale: [],
  lovedByCustomers: [],
  customerFavourites: [],
  newArrivals: []
};
const sessions = new Map();
const TTL = 7_200_000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 5 } });

function id(prefix) { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`; }
function now() { return Date.now(); }
function readLocal() {
  try { return fs.existsSync(LOCAL_DB) ? JSON.parse(fs.readFileSync(LOCAL_DB, "utf8")) : {}; }
  catch { return {}; }
}
function writeLocal(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = LOCAL_DB + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, LOCAL_DB);
}
const local = readLocal();
products = Array.isArray(local.products) && local.products.length ? local.products : products;
orders = Array.isArray(local.orders) ? local.orders : [];
priceBuckets = Array.isArray(local.priceBuckets) && local.priceBuckets.length ? local.priceBuckets : priceBuckets;
categories = Array.isArray(local.categories) && local.categories.length ? local.categories : categories;
shippingSettings = { ...shippingSettings, ...(local.shipping || {}) };

function persistLocal() {
  writeLocal({
    products, orders, priceBuckets, categories, shipping: shippingSettings,
    customers: local.customers || [], payments: local.payments || [], coupons: local.coupons || [],
    offers: local.offers || [], banners: local.banners || [], reviews: local.reviews || [],
    invoices: local.invoices || [], adminUsers: local.adminUsers || [], settings: local.settings || {},
    updatedAt: now()
  });
}

try {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const creds = raw ? JSON.parse(raw) : (process.env.FIREBASE_PROJECT_ID ? {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n")
  } : null);
  if (creds) { admin.initializeApp({ credential: admin.credential.cert(creds) }); db = admin.firestore(); console.log("✓ Firebase connected"); }
} catch (e) { console.warn("Firebase unavailable:", e.message); }

if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
}

function adminOnly(req, res, next) {
  const token = req.cookies.woolly_admin;
  const expires = token && sessions.get(token);
  if (!expires || expires < now()) return res.status(401).json({ error: "Unauthorized" });
  sessions.set(token, now() + TTL);
  next();
}

async function getProducts() {
  if (!db) return products;
  const snap = await db.collection("products").get();
  if (snap.empty) {
    const batch = db.batch();
    products.forEach(p => batch.set(db.collection("products").doc(p.id), p));
    await batch.commit();
    return products;
  }
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function saveProduct(p) {
  if (db) await db.collection("products").doc(p.id).set(p, { merge: true });
  else { const i = products.findIndex(x => x.id === p.id); i < 0 ? products.push(p) : products[i] = p; persistLocal(); }
}
async function getOrders() {
  if (!db) return [...orders].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const snap = await db.collection("orders").orderBy("createdAt", "desc").limit(500).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function getOrder(orderId) {
  if (!db) return orders.find(o => o.id === orderId) || null;
  const d = await db.collection("orders").doc(orderId).get();
  return d.exists ? { id: d.id, ...d.data() } : null;
}
async function saveOrder(order) {
  if (db) await db.collection("orders").doc(order.id).set(order, { merge: true });
  else {
    const i = orders.findIndex(o => o.id === order.id);
    if (i < 0) orders.push(order); else orders[i] = order;
    persistLocal();
  }
}
async function getSetting(key, fallback) {
  if (!db) return (local.settings && local.settings[key]) || fallback;
  const d = await db.collection("settings").doc(key).get();
  return d.exists ? d.data() : fallback;
}
async function saveSetting(key, value) {
  if (db) await db.collection("settings").doc(key).set(value, { merge: true });
  else { local.settings = local.settings || {}; local.settings[key] = value; persistLocal(); }
  return value;
}

async function getHomeSections() {
  const fallback = { ...HOME_SECTION_DEFAULTS };
  const d = await getSetting("homeSections", fallback);
  return { ...fallback, ...(d || {}) };
}
async function saveHomeSections(data) {
  const ps = await getProducts();
  const clean = {};
  for (const key of Object.keys(HOME_SECTION_DEFAULTS)) {
    const ids = Array.isArray(data?.[key]) ? data[key].slice(0, 8) : [];
    clean[key] = ids.filter(id => ps.some(p => p.id === id && p.active !== false));
  }
  clean.updatedAt = now();
  await saveSetting("homeSections", clean);
  return clean;
}

const USER_PAGE_FILES = {
  home: 'home.html', shop: 'shop.html', product: 'product.html', cart: 'cart.html',
  checkout: 'checkout.html', orders: 'orders.html', 'order-confirmation': 'order-confirmation.html',
  'track-order': 'track-order.html', wishlist: 'wishlist.html', profile: 'profile.html',
  addresses: 'addresses.html', reviews: 'reviews.html', support: 'support.html'
};
const USER_PAGE_DEFAULTS = Object.entries(USER_PAGE_FILES).map(([id, file], i) => ({
  id, file, name: id === 'profile' ? 'Account' : id.replace(/-/g, ' ').replace(/\\b\\w/g, x => x.toUpperCase()),
  navLabel: id === 'profile' ? 'Account' : id.replace(/-/g, ' ').replace(/\\b\\w/g, x => x.toUpperCase()),
  enabled: true, order: i + 1
}));
async function getUserPages() {
  const fallback = { pages: USER_PAGE_DEFAULTS, html: {} };
  if (!db) {
    const x = local.settings?.userPages;
    return x && Array.isArray(x.pages) ? x : fallback;
  }
  return await getSetting('userPages', fallback);
}
async function saveUserPages(data) { return saveSetting('userPages', data); }
function safePageId(v) { return String(v || '').toLowerCase().trim().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60); }
function userPageFile(id) { return USER_PAGE_FILES[id] || `${safePageId(id)}.html`; }
function pageHtmlFromDisk(id) {
  const file = userPageFile(id);
  const full = path.join(FRONTEND, 'customer', 'pages', file);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '<!doctype html><html><head><meta charset="utf-8"><title>WoollyCraft</title></head><body><main class="container page"><h1>New page</h1><p>Edit this page from Admin → User Panel.</p></main><script src="/customer/components/store.js"></script></body></html>';
}
function seedUserPages(data) {
  data.pages = Array.isArray(data.pages) ? data.pages : USER_PAGE_DEFAULTS;
  data.html = data.html || {};
  for (const p of data.pages) if (!data.html[p.id] && USER_PAGE_FILES[p.id]) data.html[p.id] = pageHtmlFromDisk(p.id);
  return data;
}
if (!local.settings) local.settings = {};
local.settings.userPages = seedUserPages(local.settings.userPages || { pages: USER_PAGE_DEFAULTS, html: {} });

async function getCategories() {
  if (!db) return categories;
  const d = await getSetting("categories", { items: DEFAULT_CATEGORIES });
  return Array.isArray(d.items) && d.items.length ? d.items : DEFAULT_CATEGORIES;
}
async function saveCategories(items) {
  categories = items;
  if (db) await saveSetting("categories", { items, updatedAt: now() }); else persistLocal();
  return items;
}
async function getPriceBuckets() {
  if (!db) return priceBuckets;
  const d = await getSetting("priceBuckets", { items: DEFAULT_PRICE_BUCKETS });
  return Array.isArray(d.items) ? d.items : DEFAULT_PRICE_BUCKETS;
}
async function getShippingSettings() {
  const fallback = { shippingCharge: SHIP, freeShippingThreshold: FREE, freeShippingEnabled: true, estimatedDeliveryDays: 5 };
  if (!db) return { ...fallback, ...shippingSettings };
  const d = await getSetting("shipping", fallback);
  return { shippingCharge: Number(d.shippingCharge ?? SHIP), freeShippingThreshold: d.freeShippingThreshold == null ? FREE : Number(d.freeShippingThreshold), freeShippingEnabled: d.freeShippingEnabled !== false, estimatedDeliveryDays: Number(d.estimatedDeliveryDays ?? 5) };
}
async function getSliderIds() {
  if (!db) return products.filter(p => p.slider).sort((a, b) => (a.sliderOrder || 99) - (b.sliderOrder || 99)).slice(0, 5).map(p => p.id);
  const d = await getSetting("homeSlider", { productIds: [] });
  return Array.isArray(d.productIds) ? d.productIds.slice(0, 5) : [];
}
async function getSliderProducts() {
  const ps = await getProducts(), ids = await getSliderIds();
  if (!ids.length) return ps.filter(p => p.slider).sort((a, b) => (a.sliderOrder || 99) - (b.sliderOrder || 99)).slice(0, 5);
  return ids.map(x => ps.find(p => p.id === x)).filter(Boolean).filter(p => p.active !== false).slice(0, 5);
}
async function getCustomerProfile(customerId) {
  if (!customerId) return null;
  if (db) { const d = await db.collection("customers").doc(customerId).get(); return d.exists ? { id: d.id, ...d.data() } : null; }
  return (local.customers || []).find(x => x.id === customerId) || null;
}
async function saveCustomerProfile(customerId, data) {
  const profile = { ...data, id: customerId, updatedAt: now() };
  if (db) await db.collection("customers").doc(customerId).set(profile, { merge: true });
  else { local.customers = local.customers || []; const i = local.customers.findIndex(x => x.id === customerId); i < 0 ? local.customers.push(profile) : local.customers[i] = profile; persistLocal(); }
  return profile;
}
async function saveCustomerFromOrder(customerId, customer) {
  const cid = String(customerId || '').trim();
  if (!cid || !customer || !customer.name || !customer.phone) return null;
  const current = await getCustomerProfile(cid) || {};
  let addresses = Array.isArray(current.addresses) ? current.addresses : [];
  const key = [customer.address, customer.city, customer.state, customer.pincode].map(x => String(x || '').trim().toLowerCase()).join('|');
  if (key !== '|||') {
    const idx = addresses.findIndex(a => [a.address, a.city, a.state, a.pincode].map(x => String(x || '').trim().toLowerCase()).join('|') === key);
    const addr = { label: idx >= 0 ? (addresses[idx].label || 'Home') : 'Home', address: String(customer.address || ''), city: String(customer.city || ''), state: String(customer.state || ''), pincode: String(customer.pincode || ''), isDefault: true, updatedAt: now() };
    addresses = addresses.map(a => ({ ...a, isDefault: false }));
    if (idx >= 0) addresses[idx] = { ...addresses[idx], ...addr }; else addresses.unshift(addr);
  }
  return saveCustomerProfile(cid, { name: String(customer.name).trim(), phone: String(customer.phone).trim(), email: String(customer.email || '').trim(), avatar: current.avatar || '', addresses: addresses.slice(0, 20), preferences: current.preferences || {} });
}

async function getCustomerOrders(customerId) {
  if (!customerId) return [];
  if (db) { const s = await db.collection("orders").where("customerId", "==", customerId).limit(100).get(); return s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); }
  return orders.filter(o => o.customerId === customerId).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

const COLLECTIONS = new Set(["customers", "payments", "coupons", "offers", "banners", "reviews", "invoices", "adminUsers"]);
const localKey = c => ({ adminUsers: "adminUsers" }[c] || c);
async function collectionList(name) {
  if (db) {
    const snap = await db.collection(name).limit(500).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  return Array.isArray(local[localKey(name)]) ? local[localKey(name)] : [];
}
async function collectionSave(name, item) {
  if (db) await db.collection(name).doc(item.id).set(item, { merge: true });
  else { const key = localKey(name); local[key] = Array.isArray(local[key]) ? local[key] : []; const i = local[key].findIndex(x => x.id === item.id); i < 0 ? local[key].push(item) : local[key][i] = item; persistLocal(); }
  return item;
}
async function collectionDelete(name, idValue) {
  if (db) await db.collection(name).doc(idValue).delete();
  else { const key = localKey(name); local[key] = (local[key] || []).filter(x => x.id !== idValue); persistLocal(); }
}

function trustedItems(ps, items) {
  if (!Array.isArray(items) || !items.length) throw Error("Your cart is empty");
  return items.map(i => {
    const key = String(i?.id ?? i?.productId ?? i?.sku ?? i?.productNumber ?? "").trim();
    const p = ps.find(x => String(x.id) === key || String(x.sku || "").toUpperCase() === key.toUpperCase() || String(x.productNumber || "").toUpperCase() === key.toUpperCase());
    if (!p || p.active === false) throw Error("Product not found: " + key);
    const qty = Math.max(1, Math.min(99, parseInt(i.qty) || 1));
    if (Number(p.stock || 0) < qty) throw Error(p.name + " is out of stock");
    return { ...p, qty };
  });
}
async function totals(items) {
  const subtotal = items.reduce((s, p) => s + Number(p.price || 0) * p.qty, 0);
  const cfg = await getShippingSettings();
  const free = cfg.freeShippingEnabled && cfg.freeShippingThreshold != null && subtotal >= cfg.freeShippingThreshold;
  const shipping = free ? 0 : Number(cfg.shippingCharge || 0);
  return { subtotal, shipping, total: subtotal + shipping, shippingSettings: cfg };
}

app.get("/api/health", (_q, r) => r.json({ ok: true, service: "WoollyCraft", firebase: !!db, localPersistence: true }));
app.get("/api/config", async (_q, r) => { try { const s = await getShippingSettings(); r.json({ razorpayKeyId: process.env.RAZORPAY_KEY_ID || "", shipping: s.shippingCharge, freeShipping: s.freeShippingThreshold, freeShippingEnabled: s.freeShippingEnabled, estimatedDeliveryDays: s.estimatedDeliveryDays, codEnabled: (await getSetting("payments", { codEnabled: true })).codEnabled !== false }); } catch (e) { r.status(500).json({ error: e.message }); } });
app.get("/api/products", async (_q, r) => { try { r.json({ products: await getProducts() }); } catch (e) { r.status(500).json({ error: e.message }); } });
app.get("/api/products/:id", async (q, r) => { try { const key = decodeURIComponent(q.params.id), ps = await getProducts(); const p = ps.find(x => String(x.id) === key || String(x.sku || "").toUpperCase() === key.toUpperCase() || String(x.productNumber || "").toUpperCase() === key.toUpperCase()); if (!p || p.active === false) return r.status(404).json({ error: "Product not found" }); r.json({ product: p }); } catch (e) { r.status(500).json({ error: e.message }); } });
app.get("/api/categories", async (_q, r) => r.json({ items: await getCategories() }));
app.get("/api/price-buckets", async (_q, r) => r.json({ items: (await getPriceBuckets()).filter(x => x.active !== false).sort((a, b) => (a.order || 0) - (b.order || 0)) }));
app.get("/api/home-slider", async (_q, r) => r.json({ products: await getSliderProducts() }));

app.get("/api/customer/profile", async (q, r) => r.json({ profile: await getCustomerProfile(String(q.query.customerId || "")) }));
app.put("/api/customer/profile", async (q, r) => { try { const cid = String(q.body?.customerId || "").trim(); if (!cid) return r.status(400).json({ error: "Customer ID required" }); const p = { name: String(q.body?.name || "").trim(), phone: String(q.body?.phone || "").trim(), email: String(q.body?.email || "").trim(), avatar: String(q.body?.avatar || ""), addresses: Array.isArray(q.body?.addresses) ? q.body.addresses.slice(0, 20) : [], preferences: q.body?.preferences || {} }; if (!p.name || !p.phone) return r.status(400).json({ error: "Name and phone are required" }); r.json({ profile: await saveCustomerProfile(cid, p) }); } catch (e) { r.status(400).json({ error: e.message }); } });
app.get("/api/customer/orders", async (q, r) => r.json({ orders: await getCustomerOrders(String(q.query.customerId || "")) }));

app.post("/api/admin/login", (q, r) => { if (!ADMIN_PASSWORD || String(q.body?.password ?? "").trim() !== ADMIN_PASSWORD) return r.status(401).json({ error: "Wrong password" }); const token = crypto.randomBytes(32).toString("hex"); sessions.set(token, now() + TTL); r.setHeader("Set-Cookie", `woolly_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=7200`); r.json({ ok: true }); });
app.post("/api/admin/logout", (q, r) => { if (q.cookies.woolly_admin) sessions.delete(q.cookies.woolly_admin); r.setHeader("Set-Cookie", "woolly_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"); r.json({ ok: true }); });
app.get("/api/admin/me", adminOnly, (_q, r) => r.json({ ok: true }));

app.get("/api/admin/shipping", adminOnly, async (_q, r) => r.json(await getShippingSettings()));
app.put("/api/admin/shipping", adminOnly, async (q, r) => { try { const shippingCharge = Number(q.body.shippingCharge), threshold = q.body.freeShippingThreshold === "" || q.body.freeShippingThreshold == null ? null : Number(q.body.freeShippingThreshold), days = Number(q.body.estimatedDeliveryDays); if (!Number.isFinite(shippingCharge) || shippingCharge < 0) throw Error("Shipping charge must be 0 or more"); if (threshold !== null && (!Number.isFinite(threshold) || threshold < 0)) throw Error("Free-shipping threshold must be 0 or more"); if (!Number.isFinite(days) || days < 1 || days > 60) throw Error("Estimated delivery must be between 1 and 60 days"); shippingSettings = { shippingCharge, freeShippingThreshold: threshold, freeShippingEnabled: q.body.freeShippingEnabled !== false, estimatedDeliveryDays: days, updatedAt: now() }; await saveSetting("shipping", shippingSettings); r.json(shippingSettings); } catch (e) { r.status(400).json({ error: e.message }); } });

app.get("/api/admin/orders", adminOnly, async (_q, r) => r.json({ orders: await getOrders() }));
app.put("/api/admin/orders/:id", adminOnly, async (q, r) => { try { const o = await getOrder(q.params.id); if (!o) return r.status(404).json({ error: "Order not found" }); const old = o.status || "new", next = q.body.status || old; o.status = next; if (q.body.awb !== undefined) o.awb = String(q.body.awb || "").trim(); if (q.body.courier !== undefined) o.courier = String(q.body.courier || "").trim(); if (q.body.estimatedDelivery !== undefined) o.estimatedDelivery = String(q.body.estimatedDelivery || "").trim(); if (q.body.note) { o.adminNotes = Array.isArray(o.adminNotes) ? o.adminNotes : []; o.adminNotes.push({ text: String(q.body.note), author: "Admin", createdAt: now() }); } o.statusHistory = Array.isArray(o.statusHistory) ? o.statusHistory : []; if (old !== next) o.statusHistory.push({ status: next, createdAt: now() }); o.updatedAt = now(); await saveOrder(o); r.json({ order: o }); } catch (e) { r.status(400).json({ error: e.message }); } });

app.get("/api/admin/home-slider", adminOnly, async (_q, r) => r.json({ products: await getSliderProducts(), productIds: await getSliderIds() }));
app.put("/api/admin/home-slider", adminOnly, async (q, r) => { try { const ids = Array.isArray(q.body.productIds) ? q.body.productIds.slice(0, 5) : [], ps = await getProducts(), valid = ids.filter(x => ps.some(p => p.id === x && p.active !== false)); await saveSetting("homeSlider", { productIds: valid, updatedAt: now() }); if (!db) { products = products.map(p => ({ ...p, slider: valid.includes(p.id), sliderOrder: valid.indexOf(p.id) + 1 || 0 })); persistLocal(); } r.json({ ok: true, productIds: valid, products: await getSliderProducts() }); } catch (e) { r.status(400).json({ error: e.message }); } });

app.get("/api/admin/price-buckets", adminOnly, async (_q, r) => r.json({ items: (await getPriceBuckets()).sort((a, b) => (a.order || 0) - (b.order || 0)) }));
app.post("/api/admin/price-buckets", adminOnly, async (q, r) => { try { const items = await getPriceBuckets(), label = String(q.body.label || "").trim(), min = q.body.min === "" || q.body.min == null ? 0 : Number(q.body.min), max = q.body.max === "" || q.body.max == null ? null : Number(q.body.max); if (!label || !Number.isFinite(min) || min < 0 || (max !== null && (!Number.isFinite(max) || max < min))) throw Error("Invalid price range"); const item = { id: id("budget"), label, min, max, active: q.body.active !== false, order: items.length + 1 }; items.push(item); await saveSetting("priceBuckets", { items, updatedAt: now() }); if (!db) { priceBuckets = items; persistLocal(); } r.json({ item }); } catch (e) { r.status(400).json({ error: e.message }); } });
app.put("/api/admin/price-buckets/:id", adminOnly, async (q, r) => { try { let items = await getPriceBuckets(), old = items.find(x => x.id === q.params.id); if (!old) return r.status(404).json({ error: "Price option not found" }); const item = { ...old, label: String(q.body.label ?? old.label).trim(), min: q.body.min === undefined ? old.min : Number(q.body.min), max: q.body.max === undefined ? old.max : (q.body.max === "" ? null : Number(q.body.max)), active: q.body.active === undefined ? old.active : !!q.body.active }; if (!item.label || !Number.isFinite(item.min) || item.min < 0 || (item.max !== null && (!Number.isFinite(item.max) || item.max < item.min))) throw Error("Invalid price range"); items = items.map(x => x.id === old.id ? item : x); await saveSetting("priceBuckets", { items, updatedAt: now() }); if (!db) { priceBuckets = items; persistLocal(); } r.json({ item }); } catch (e) { r.status(400).json({ error: e.message }); } });
app.delete("/api/admin/price-buckets/:id", adminOnly, async (q, r) => { let items = (await getPriceBuckets()).filter(x => x.id !== q.params.id); await saveSetting("priceBuckets", { items, updatedAt: now() }); if (!db) { priceBuckets = items; persistLocal(); } r.json({ ok: true }); });

app.get("/api/admin/categories", adminOnly, async (_q, r) => r.json({ items: await getCategories() }));
app.post("/api/admin/categories", adminOnly, async (q, r) => { const name = String(q.body.name || "").trim(); if (!name) return r.status(400).json({ error: "Category name required" }); const items = await getCategories(); if (items.some(x => x.toLowerCase() === name.toLowerCase())) return r.status(409).json({ error: "Category already exists" }); items.push(name); await saveCategories(items); r.json({ item: name }); });
app.put("/api/admin/categories/:name", adminOnly, async (q, r) => { const old = decodeURIComponent(q.params.name), name = String(q.body.name || "").trim(); if (!name) return r.status(400).json({ error: "Category name required" }); let items = await getCategories(); if (items.some(x => x.toLowerCase() === name.toLowerCase() && x !== old)) return r.status(409).json({ error: "Category already exists" }); items = items.map(x => x === old ? name : x); await saveCategories(items); if (db) { const snap = await db.collection("products").where("category", "==", old).get(); const batch = db.batch(); snap.docs.forEach(d => batch.update(d.ref, { category: name })); await batch.commit(); } else { products = products.map(x => x.category === old ? { ...x, category: name } : x); persistLocal(); } r.json({ item: name }); });
app.delete("/api/admin/categories/:name", adminOnly, async (q, r) => { const name = decodeURIComponent(q.params.name), items = (await getCategories()).filter(x => x !== name); await saveCategories(items); r.json({ ok: true }); });

app.post("/api/admin/upload-images", adminOnly, upload.array("images", 5), async (q, r) => { try { if (!q.files?.length) return r.status(400).json({ error: "Select up to 5 images" }); if (!process.env.CLOUDINARY_CLOUD_NAME) return r.status(503).json({ error: "Cloudinary is not configured" }); const images = await Promise.all(q.files.slice(0, 5).map(file => new Promise((ok, no) => { const stream = cloudinary.uploader.upload_stream({ folder: "woollycraft/products", resource_type: "image" }, (e, x) => e ? no(e) : ok({ url: x.secure_url, publicId: x.public_id })); stream.end(file.buffer); }))); r.json({ images }); } catch (e) { r.status(400).json({ error: e.message }); } });

app.post("/api/admin/products", adminOnly, async (q, r) => { try { let sku = String(q.body.sku || "").trim().toUpperCase(), ps = await getProducts(); if (!sku) sku = "WC-" + crypto.randomBytes(4).toString("hex").toUpperCase(); if (ps.some(x => String(x.sku || "").toUpperCase() === sku)) return r.status(409).json({ error: "Product number / SKU must be unique" }); const p = { id: id("wc"), sku, name: String(q.body.name || "").trim(), description: String(q.body.description || ""), category: String(q.body.category || "Other"), price: Number(q.body.price), originalPrice: q.body.originalPrice === "" || q.body.originalPrice == null ? null : Number(q.body.originalPrice), stock: Number(q.body.stock || 0), image: String(q.body.image || ""), images: Array.isArray(q.body.images) ? q.body.images.slice(0, 5) : [], featured: !!q.body.featured, trending: !!q.body.trending, tags: Array.isArray(q.body.tags) ? q.body.tags.slice(0, 5) : [], badge: String(q.body.badge || "HANDMADE"), active: q.body.active !== false, createdAt: now() }; if (!p.name || !Number.isFinite(p.price)) return r.status(400).json({ error: "Valid name and price required" }); await saveProduct(p); r.json({ product: p }); } catch (e) { r.status(400).json({ error: e.message }); } });
app.put("/api/admin/products/:id", adminOnly, async (q, r) => { try { const ps = await getProducts(), old = ps.find(x => x.id === q.params.id); if (!old) return r.status(404).json({ error: "Product not found" }); let sku = String(q.body.sku ?? old.sku ?? "").trim().toUpperCase(); if (!sku) sku = old.sku || ("WC-" + crypto.randomBytes(4).toString("hex").toUpperCase()); if (ps.some(x => x.id !== old.id && String(x.sku || "").toUpperCase() === sku)) return r.status(409).json({ error: "Product number / SKU must be unique" }); const p = { ...old, ...q.body, id: old.id, sku, images: Array.isArray(q.body.images) ? q.body.images.slice(0, 5) : (old.images || []), tags: Array.isArray(q.body.tags) ? q.body.tags.slice(0, 5) : (old.tags || []), price: Number(q.body.price ?? old.price), stock: Number(q.body.stock ?? old.stock), active: q.body.active === undefined ? old.active !== false : q.body.active !== false }; p.image = p.images[0] || p.image || ""; await saveProduct(p); r.json({ product: p }); } catch (e) { r.status(400).json({ error: e.message }); } });
app.delete("/api/admin/products/:id", adminOnly, async (q, r) => { if (db) await db.collection("products").doc(q.params.id).delete(); else { products = products.filter(x => x.id !== q.params.id); persistLocal(); } r.json({ ok: true }); });

// Temporary COD + Razorpay
app.post("/api/payments/cod", async (q, r) => { try { const items = trustedItems(await getProducts(), q.body.items), t = await totals(items); const customer = q.body.customer || {}; const o = { id: id("order"), customer, customerId: String(q.body.customerId || ""), items: items.map(p => ({ id: p.id, sku: p.sku, name: p.name, price: p.price, qty: p.qty, image: p.image })), ...t, paymentMethod: "cod", paymentStatus: "pending", status: "confirmed", statusHistory: [{ status: "confirmed", createdAt: now() }], createdAt: now() }; await saveOrder(o); if (q.body.customerId && customer.name && customer.phone) await saveCustomerFromOrder(String(q.body.customerId), customer); r.json({ orderId: o.id }); } catch (e) { r.status(400).json({ error: e.message }); } });
app.post("/api/payments/create-order", async (q, r) => { try { if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) throw Error("Razorpay is not configured"); const items = trustedItems(await getProducts(), q.body.items), t = await totals(items), rz = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET }); const o = await rz.orders.create({ amount: Math.round(t.total * 100), currency: "INR", receipt: id("receipt") }); r.json({ razorpayOrderId: o.id, amount: o.amount, currency: o.currency }); } catch (e) { r.status(400).json({ error: e.message }); } });
app.post("/api/payments/verify", async (q, r) => { try { const { razorpay_order_id, razorpay_payment_id, razorpay_signature, customer, customerId, items } = q.body; const expected = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(razorpay_order_id + "|" + razorpay_payment_id).digest("hex"); if (expected !== razorpay_signature) return r.status(400).json({ error: "Payment verification failed" }); const a = trustedItems(await getProducts(), items), t = await totals(a), o = { id: id("order"), customer, items: a.map(p => ({ id: p.id, sku: p.sku, name: p.name, price: p.price, qty: p.qty, image: p.image })), ...t, customerId: String(customerId || ""), paymentMethod: "razorpay", paymentStatus: "paid", razorpayOrderId: razorpay_order_id, razorpayPaymentId: razorpay_payment_id, status: "confirmed", statusHistory: [{ status: "confirmed", createdAt: now() }], createdAt: now() }; await saveOrder(o); if (customerId && customer) await saveCustomerFromOrder(String(customerId), customer); r.json({ orderId: o.id }); } catch (e) { r.status(400).json({ error: e.message }); } });
app.get("/api/track/:awb", async (q, r) => { try { const awb = String(q.params.awb || "").trim(); if (!awb) return r.status(400).json({ error: "AWB required" }); const base = process.env.DELHIVERY_TRACKING_URL; if (!base) return r.status(503).json({ error: "Delhivery One tracking API is not configured" }); const url = new URL(base); url.searchParams.set("waybill", awb); const headers = { Accept: "application/json" }; if (process.env.DELHIVERY_API_TOKEN) headers.Authorization = `Token ${process.env.DELHIVERY_API_TOKEN}`; const x = await fetch(url, { headers }); const data = await x.json().catch(() => ({})); if (!x.ok) return r.status(x.status).json({ error: data.error || "Delhivery tracking failed" }); r.json({ awb, data }); } catch (e) { r.status(502).json({ error: e.message }); } });
app.get("/api/orders/:id", async (q, r) => { const o = await getOrder(q.params.id); o ? r.json({ order: o }) : r.status(404).json({ error: "Order not found" }); });

app.get("/api/home-sections", async (_q, r) => {
  try {
    const cfg = await getHomeSections();
    const ps = await getProducts();
    const out = {};
    for (const [key, ids] of Object.entries(cfg)) if (key !== "updatedAt") out[key] = ids.map(id => ps.find(p => p.id === id)).filter(Boolean);
    r.json({ config: cfg, products: out });
  } catch (e) { r.status(500).json({ error: e.message }); }
});
app.get("/api/admin/home-sections", adminOnly, async (_q, r) => {
  try { r.json({ config: await getHomeSections(), products: await getProducts() }); }
  catch (e) { r.status(500).json({ error: e.message }); }
});
app.put("/api/admin/home-sections", adminOnly, async (q, r) => {
  try { r.json({ config: await saveHomeSections(q.body || {}) }); }
  catch (e) { r.status(400).json({ error: e.message }); }
});

// User Panel page editor: page-by-page, linewise full-page editing.
app.get('/api/admin/user-pages', adminOnly, async (_q, r) => { try { const d = seedUserPages(await getUserPages()); r.json({ pages: d.pages }); } catch (e) { r.status(500).json({ error: e.message }); } });
app.get('/api/admin/user-pages/:id', adminOnly, async (q, r) => { try { const d = seedUserPages(await getUserPages()), p = d.pages.find(x => x.id === q.params.id); if (!p) return r.status(404).json({ error: 'User page not found' }); r.json({ page: p, html: d.html[p.id] || pageHtmlFromDisk(p.id) }); } catch (e) { r.status(500).json({ error: e.message }); } });
app.post('/api/admin/user-pages', adminOnly, async (q, r) => { try { const d = seedUserPages(await getUserPages()), pid = safePageId(q.body.id || q.body.name); if (!pid) throw Error('Page ID is required'); if (d.pages.some(x => x.id === pid)) throw Error('A page with this ID already exists'); const p = { id: pid, file: `${pid}.html`, name: String(q.body.name || pid), navLabel: String(q.body.navLabel || q.body.name || pid), enabled: q.body.enabled !== false, order: d.pages.length + 1 }; d.pages.push(p); d.html[pid] = String(q.body.html || pageHtmlFromDisk(pid)); await saveUserPages(d); r.json({ page: p }); } catch (e) { r.status(400).json({ error: e.message }); } });
app.put('/api/admin/user-pages/:id', adminOnly, async (q, r) => { try { const d = seedUserPages(await getUserPages()), p = d.pages.find(x => x.id === q.params.id); if (!p) return r.status(404).json({ error: 'User page not found' }); Object.assign(p, { name: q.body.name === undefined ? p.name : String(q.body.name), navLabel: q.body.navLabel === undefined ? p.navLabel : String(q.body.navLabel), enabled: q.body.enabled === undefined ? p.enabled !== false : q.body.enabled !== false, order: q.body.order === undefined ? p.order : Number(q.body.order) || p.order }); if (q.body.html !== undefined) d.html[p.id] = String(q.body.html); await saveUserPages(d); r.json({ page: p }); } catch (e) { r.status(400).json({ error: e.message }); } });
app.delete('/api/admin/user-pages/:id', adminOnly, async (q, r) => { try { const d = seedUserPages(await getUserPages()), i = d.pages.findIndex(x => x.id === q.params.id); if (i < 0) return r.status(404).json({ error: 'User page not found' }); if (d.pages.length <= 1) throw Error('At least one user page must remain'); d.pages.splice(i, 1); delete d.html[q.params.id]; await saveUserPages(d); r.json({ ok: true }); } catch (e) { r.status(400).json({ error: e.message }); } });
app.get('/api/user-pages', async (_q, r) => { try { const d = seedUserPages(await getUserPages()); r.json({ pages: d.pages.filter(x => x.enabled !== false).sort((a,b)=>(a.order||0)-(b.order||0)) }); } catch (e) { r.status(500).json({ error: e.message }); } });

// Generic admin collections make every management section real instead of placeholders.
app.get("/api/admin/:collection", adminOnly, async (q, r) => { const name = q.params.collection; if (!COLLECTIONS.has(name)) return r.status(404).json({ error: "Admin collection not found" }); try { r.json({ items: await collectionList(name) }); } catch (e) { r.status(500).json({ error: e.message }); } });
app.post("/api/admin/:collection", adminOnly, async (q, r) => { const name = q.params.collection; if (!COLLECTIONS.has(name)) return r.status(404).json({ error: "Admin collection not found" }); try { const item = { ...q.body, id: q.body.id || id(name.slice(0, 4)), createdAt: q.body.createdAt || now(), updatedAt: now() }; await collectionSave(name, item); r.json({ item }); } catch (e) { r.status(400).json({ error: e.message }); } });
app.put("/api/admin/:collection/:id", adminOnly, async (q, r) => { const name = q.params.collection; if (!COLLECTIONS.has(name)) return r.status(404).json({ error: "Admin collection not found" }); try { const current = (await collectionList(name)).find(x => x.id === q.params.id) || { id: q.params.id, createdAt: now() }; const item = { ...current, ...q.body, id: q.params.id, updatedAt: now() }; await collectionSave(name, item); r.json({ item }); } catch (e) { r.status(400).json({ error: e.message }); } });
app.delete("/api/admin/:collection/:id", adminOnly, async (q, r) => { const name = q.params.collection; if (!COLLECTIONS.has(name)) return r.status(404).json({ error: "Admin collection not found" }); await collectionDelete(name, q.params.id); r.json({ ok: true }); });

app.get("/api/admin/analytics", adminOnly, async (_q, r) => {
  const os = await getOrders(), ps = await getProducts();
  const revenue = os.reduce((s, o) => s + Number(o.total ?? o.amount ?? 0), 0);
  const byStatus = {}; os.forEach(o => { byStatus[o.status || "new"] = (byStatus[o.status || "new"] || 0) + 1; });
  const productMap = {}; os.forEach(o => (o.items || []).forEach(i => { productMap[i.id] = productMap[i.id] || { id: i.id, name: i.name, units: 0, revenue: 0 }; productMap[i.id].units += Number(i.qty || 0); productMap[i.id].revenue += Number(i.price || 0) * Number(i.qty || 0); }));
  r.json({ totalOrders: os.length, revenue, averageOrder: os.length ? revenue / os.length : 0, customers: (await collectionList("customers")).length, products: ps.length, byStatus, topProducts: Object.values(productMap).sort((a, b) => b.units - a.units).slice(0, 10) });
});
app.get("/api/admin/inventory", adminOnly, async (_q, r) => { const ps = await getProducts(); r.json({ items: ps.map(p => ({ id: p.id, sku: p.sku, name: p.name, category: p.category, stock: Number(p.stock || 0), price: Number(p.price || 0), active: p.active !== false })) }); });
app.put("/api/admin/inventory/:id", adminOnly, async (q, r) => { const ps = await getProducts(), p = ps.find(x => x.id === q.params.id); if (!p) return r.status(404).json({ error: "Product not found" }); const stock = Number(q.body.stock); if (!Number.isFinite(stock) || stock < 0) return r.status(400).json({ error: "Invalid stock" }); p.stock = Math.floor(stock); await saveProduct(p); r.json({ item: p }); });

app.get("/api/admin/settings", adminOnly, async (_q, r) => r.json({ store: await getSetting("store", { name: "WoollyCraft", email: "", phone: "", address: "" }), payments: await getSetting("payments", { razorpayEnabled: true, codEnabled: true }), shipping: await getShippingSettings() }));
app.put("/api/admin/settings", adminOnly, async (q, r) => { try { const store = q.body.store || {}, payments = q.body.payments || {}; await saveSetting("store", { name: String(store.name || "WoollyCraft"), email: String(store.email || ""), phone: String(store.phone || ""), address: String(store.address || ""), social: store.social || {}, updatedAt: now() }); await saveSetting("payments", { razorpayEnabled: payments.razorpayEnabled !== false, codEnabled: payments.codEnabled !== false, updatedAt: now() }); r.json({ ok: true }); } catch (e) { r.status(400).json({ error: e.message }); } });

app.get('/customer/pages/:page.html', async (q, r, next) => {
  try {
    const id = safePageId(q.params.page), d = seedUserPages(await getUserPages()), p = d.pages.find(x => x.id === id);
    if (!p || p.enabled === false) return r.status(404).send('Page not available');
    r.type('html').send(d.html[id] || pageHtmlFromDisk(id));
  } catch (e) { next(e); }
});
app.use(express.static(FRONTEND));
app.get("/", (_q, r) => r.sendFile(path.join(FRONTEND, "customer/pages/home.html")));
app.get("/admin/", (_q, r) => r.sendFile(path.join(FRONTEND, "admin/pages/admin.html")));
app.use((q, r) => q.path.startsWith("/api/") ? r.status(404).json({ error: "API route not found" }) : r.status(404).send("Page not found"));

persistLocal();
app.listen(PORT, () => console.log(`WoollyCraft running at http://localhost:${PORT}`));
