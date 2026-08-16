require('dotenv').config();

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const Razorpay = require('razorpay');
const admin = require('firebase-admin');
const { v2: cloudinary } = require('cloudinary');
const fs = require('fs');

const app = express();
app.set('trust proxy', 1); // Required behind Render's reverse proxy
app.disable('x-powered-by');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';

function initFirebase() {
  if (admin.apps.length) return;
  let serviceAccount;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
    serviceAccount = JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8'));
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } else {
    throw new Error('Firebase credentials missing. Set FIREBASE_SERVICE_ACCOUNT_B64.');
  }
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

try { initFirebase(); } catch (e) { console.error('Firebase initialization failed:', e.message); process.exit(1); }

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || ''
});

const razorpay = RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET
  ? new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET })
  : null;

if (!ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD is missing.');
if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) console.warn('Razorpay keys are missing.');
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) console.warn('Cloudinary credentials are missing; image uploads will be disabled.');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.mimetype)) return cb(new Error('Only JPG, PNG, WEBP and GIF images are allowed.'));
    cb(null, true);
  }
});

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '150kb' }));
app.use(express.urlencoded({ extended: true, limit: '150kb' }));
app.use(cookieParser());

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
app.use('/api/', apiLimiter);

const sessions = new Map();
const SESSION_TTL = 2 * 60 * 60 * 1000;

function sessionToken() { return crypto.randomBytes(32).toString('hex'); }
function requireAdmin(req, res, next) {
  const token = req.cookies.woolly_admin;
  const expiry = token && sessions.get(token);
  if (!expiry || expiry < Date.now()) {
    if (token) sessions.delete(token);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  sessions.set(token, Date.now() + SESSION_TTL);
  next();
}
function newId(prefix) { return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`; }
function clean(v, max=500) { return typeof v === 'string' ? v.trim().slice(0,max) : ''; }
function priceOk(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 1000000; }
function dateKey(ms) { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function customerKey(phone) { return clean(phone,30).replace(/\D/g,'').slice(-10); }

async function getProducts() {
  const snap = await db.collection('products').orderBy('createdAt','desc').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function getOrders() {
  const snap = await db.collection('orders').orderBy('createdAt','desc').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function ensureSeedData() {
  const productSnap = await db.collection('products').limit(1).get();
  if (!productSnap.empty) return;
  const localProducts = path.join(__dirname, 'data', 'products.json');
  if (!fs.existsSync(localProducts)) return;
  let products = [];
  try { products = JSON.parse(fs.readFileSync(localProducts,'utf8')); } catch { return; }
  if (!Array.isArray(products) || !products.length) return;
  const batch = db.batch();
  for (const p of products) {
    const ref = db.collection('products').doc(String(p.id || newId('p')));
    batch.set(ref, {
      name: clean(p.name,120), description: clean(p.description,700), category: clean(p.category,80) || 'Other',
      price: Number(p.price) || 0, image: clean(p.image,1500), active: p.active !== false, trending: Boolean(p.trending), createdAt: Number(p.createdAt) || Date.now()
    });
  }
  await batch.commit();
  console.log(`Migrated ${products.length} local products to Firestore.`);
}

// Public config
app.get('/api/config', (_req,res) => res.json({ razorpayKeyId: RAZORPAY_KEY_ID }));

// Public products
app.get('/api/products', async (_req,res) => {
  try { res.json(await getProducts()); }
  catch (e) { console.error(e); res.status(500).json({error:'Could not load products'}); }
});

// Public trending configuration
app.get('/api/trending', async (_req,res) => {
  try {
    const doc = await db.collection('settings').doc('store').get();
    const ids = doc.exists && Array.isArray(doc.data().trendingProductIds) ? doc.data().trendingProductIds : [];
    const products = await getProducts();
    const map = new Map(products.map(p => [p.id,p]));
    res.json(ids.map(id => map.get(id)).filter(Boolean).slice(0,5));
  } catch (e) { res.status(500).json({error:'Could not load trending products'}); }
});

// Admin login
app.post('/api/admin/login', loginLimiter, (req,res) => {
  if (!ADMIN_PASSWORD || req.body?.password !== ADMIN_PASSWORD) return res.status(401).json({error:'Wrong password'});
  const token = sessionToken();
  sessions.set(token, Date.now() + SESSION_TTL);
  res.setHeader('Set-Cookie', `woolly_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL/1000}`);
  res.json({ok:true});
});
app.post('/api/admin/logout', (req,res) => {
  if (req.cookies.woolly_admin) sessions.delete(req.cookies.woolly_admin);
  res.setHeader('Set-Cookie','woolly_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ok:true});
});
app.get('/api/admin/me', requireAdmin, (_req,res)=>res.json({ok:true}));

// Admin image upload -> Cloudinary
app.post('/api/admin/upload-image', requireAdmin, (req,res) => {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) return res.status(503).json({error:'Image hosting is not configured.'});
  upload.single('image')(req,res, async err => {
    if (err) return res.status(400).json({error:err.message});
    if (!req.file) return res.status(400).json({error:'Please select an image.'});
    try {
      const result = await new Promise((resolve,reject) => {
        const stream = cloudinary.uploader.upload_stream({ folder:'woollycraft/products', resource_type:'image', overwrite:false }, (error, result) => error ? reject(error) : resolve(result));
        stream.end(req.file.buffer);
      });
      res.json({ok:true, image:result.secure_url, publicId:result.public_id});
    } catch (e) { console.error('Cloudinary upload:',e); res.status(500).json({error:'Image upload failed'}); }
  });
});

// Products CRUD
app.post('/api/admin/products', requireAdmin, async (req,res) => {
  try {
    const {name,description,category,image,price,active,trending} = req.body || {};
    if (!clean(name,120) || !priceOk(price)) return res.status(400).json({error:'Valid name and price are required.'});
    const ref = db.collection('products').doc(newId('p'));
    const product = {name:clean(name,120),description:clean(description,700),category:clean(category,80)||'Other',image:clean(image,1500),price:Number(price),active:active!==false,trending:Boolean(trending),createdAt:Date.now()};
    await ref.set(product); res.json({id:ref.id,...product});
  } catch(e){console.error(e);res.status(500).json({error:'Could not save product'});}
});
app.put('/api/admin/products/:id', requireAdmin, async (req,res) => {
  try {
    const ref = db.collection('products').doc(req.params.id); const old = await ref.get();
    if (!old.exists) return res.status(404).json({error:'Product not found'});
    const current = old.data(); const b=req.body||{};
    const patch={...current};
    if (b.name!==undefined) patch.name=clean(b.name,120);
    if (b.description!==undefined) patch.description=clean(b.description,700);
    if (b.category!==undefined) patch.category=clean(b.category,80)||'Other';
    if (b.image!==undefined) patch.image=clean(b.image,1500);
    if (b.price!==undefined) { if(!priceOk(b.price)) return res.status(400).json({error:'Invalid price'}); patch.price=Number(b.price); }
    if (b.active!==undefined) patch.active=Boolean(b.active);
    if (b.trending!==undefined) patch.trending=Boolean(b.trending);
    await ref.set(patch); res.json({id:ref.id,...patch});
  } catch(e){console.error(e);res.status(500).json({error:'Could not update product'});}
});
app.delete('/api/admin/products/:id', requireAdmin, async (req,res)=>{
  try { await db.collection('products').doc(req.params.id).delete(); res.json({ok:true}); }
  catch(e){res.status(500).json({error:'Could not delete product'});}
});

// Trending slider selection (max 5)
app.put('/api/admin/trending', requireAdmin, async (req,res)=>{
  const ids = Array.isArray(req.body?.productIds) ? req.body.productIds.map(String).slice(0,5) : [];
  await db.collection('settings').doc('store').set({trendingProductIds:ids,updatedAt:Date.now()},{merge:true});
  res.json({ok:true,productIds:ids});
});

// Admin orders
app.get('/api/admin/orders', requireAdmin, async (_req,res)=>{ try { res.json(await getOrders()); } catch(e){res.status(500).json({error:'Could not load orders'});} });
app.put('/api/admin/orders/:id', requireAdmin, async (req,res)=>{
  const allowed=['confirmed','preparing','shipped','delivered','cancelled']; const status=clean(req.body?.status,30);
  if(!allowed.includes(status)) return res.status(400).json({error:'Invalid status'});
  try { const ref=db.collection('orders').doc(req.params.id); await ref.update({status,updatedAt:Date.now()}); const d=await ref.get(); res.json({id:d.id,...d.data()}); }
  catch(e){res.status(404).json({error:'Order not found'});}
});

// Admin statistics
app.get('/api/admin/stats', requireAdmin, async (_req,res)=>{
  try {
    const orders=await getOrders(); const now=new Date(); const today=dateKey(Date.now()); const yesterday=dateKey(Date.now()-86400000);
    const paid=orders.filter(o=>o.paymentMethod==='razorpay' && o.status!=='cancelled');
    const revenue=paid.reduce((s,o)=>s+Number(o.amount||0),0);
    const todayOrders=orders.filter(o=>dateKey(Number(o.createdAt))===today);
    const yesterdayOrders=orders.filter(o=>dateKey(Number(o.createdAt))===yesterday);
    const todayRevenue=todayOrders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+Number(o.amount||0),0);
    const yesterdayRevenue=yesterdayOrders.filter(o=>o.status!=='cancelled').reduce((s,o)=>s+Number(o.amount||0),0);
    const pending=orders.filter(o=>['confirmed','preparing','shipped'].includes(o.status));
    const top={}; orders.filter(o=>o.status!=='cancelled').forEach(o=>(o.items||[]).forEach(i=>{top[i.name]=(top[i.name]||0)+Number(i.qty||0);}));
    const topProducts=Object.entries(top).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([name,qty])=>({name,qty}));
    const sales7=[]; for(let i=6;i>=0;i--){const k=dateKey(Date.now()-i*86400000); const day=orders.filter(o=>dateKey(Number(o.createdAt))===k&&o.status!=='cancelled'); sales7.push({date:k,orders:day.length,revenue:day.reduce((s,o)=>s+Number(o.amount||0),0)});}
    res.json({totalOrders:orders.length,todayOrders:todayOrders.length,yesterdayOrders:yesterdayOrders.length,totalRevenue:revenue,todayRevenue,yesterdayRevenue,avgOrder:paid.length?revenue/paid.length:0,pendingOrders:pending.length,pendingValue:pending.reduce((s,o)=>s+Number(o.amount||0),0),topProducts,sales7});
  } catch(e){console.error(e);res.status(500).json({error:'Could not calculate statistics'});}
});

// Secure price calculation from Firestore
async function buildCart(items){
  if(!Array.isArray(items)||!items.length||items.length>50) throw new Error('Invalid cart.');
  const products=await getProducts(); const map=new Map(products.map(p=>[p.id,p])); let total=0; const lineItems=[];
  for(const item of items){const p=map.get(String(item.id)); if(!p||p.active===false) throw new Error('A product is unavailable.'); const qty=Math.max(1,Math.min(20,parseInt(item.qty,10)||1)); total+=Number(p.price)*qty; lineItems.push({id:p.id,name:p.name,price:Number(p.price),qty,image:p.image||''});}
  return {total,lineItems};
}

// Razorpay create order — online only
app.post('/api/create-razorpay-order', async (req,res)=>{
  try {
    if(!razorpay) return res.status(503).json({error:'Online payment is not configured.'});
    const {total}=await buildCart(req.body?.items); const amount=Math.round(total*100); if(amount<100)return res.status(400).json({error:'Minimum payment is ₹1.'});
    const order=await razorpay.orders.create({amount,currency:'INR',receipt:newId('receipt')});
    res.json({razorpayOrderId:order.id,amount:order.amount,currency:order.currency});
  } catch(e){console.error(e);res.status(400).json({error:e.message||'Could not create payment order'});}
});

// Verify and save paid order
app.post('/api/verify-razorpay-payment', async (req,res)=>{
  try {
    if(!RAZORPAY_KEY_SECRET) return res.status(503).json({error:'Payment verification is not configured.'});
    const {razorpay_order_id,razorpay_payment_id,razorpay_signature,customer,items}=req.body||{};
    if(!razorpay_order_id||!razorpay_payment_id||!razorpay_signature) return res.status(400).json({error:'Invalid payment response.'});
    const expected=crypto.createHmac('sha256',RAZORPAY_KEY_SECRET).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
    if(expected.length!==razorpay_signature.length || !crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(razorpay_signature))) return res.status(400).json({error:'Payment verification failed.'});
    const {total,lineItems}=await buildCart(items);
    const phone=customerKey(customer?.phone); const name=clean(customer?.name,100); const email=clean(customer?.email,160); const address=clean(customer?.address,700);
    if(!name||phone.length!==10||!address) return res.status(400).json({error:'Complete customer details are required.'});
    const duplicate=await db.collection('orders').where('razorpayPaymentId','==',razorpay_payment_id).limit(1).get(); if(!duplicate.empty)return res.status(409).json({error:'Payment already recorded.',orderId:duplicate.docs[0].id});
    const orderId=newId('order');
    const order={orderId,customer:{name,email,phone,address},items:lineItems,amount:total,paymentMethod:'razorpay',razorpayOrderId:razorpay_order_id,razorpayPaymentId:razorpay_payment_id,status:'confirmed',createdAt:Date.now(),updatedAt:Date.now()};
    await db.collection('orders').doc(orderId).set(order);
    await db.collection('customers').doc(phone).set({name,email,phone,address,lastOrderAt:Date.now()},{merge:true});
    res.json({ok:true,orderId});
  } catch(e){console.error('verify:',e);res.status(400).json({error:e.message||'Could not save order'});}
});

// Track order publicly by order ID + phone
app.post('/api/track-order', async (req,res)=>{
  const orderId=clean(req.body?.orderId,100); const phone=customerKey(req.body?.phone);
  if(!orderId||phone.length!==10)return res.status(400).json({error:'Enter a valid Order ID and 10-digit phone number.'});
  try {
    const doc=await db.collection('orders').doc(orderId).get();
    if(!doc.exists || customerKey(doc.data().customer?.phone)!==phone)return res.status(404).json({error:'Order not found.'});
    const o=doc.data();
    res.json({orderId:doc.id,status:o.status,createdAt:o.createdAt,amount:o.amount,items:o.items,customer:{name:o.customer?.name,address:o.customer?.address}});
  } catch(e){res.status(500).json({error:'Could not track order'});}
});

// Saved customer details (phone as lookup key)
app.post('/api/customer', async (req,res)=>{
  const phone=customerKey(req.body?.phone); if(phone.length!==10)return res.status(400).json({error:'Invalid phone'});
  try {const d=await db.collection('customers').doc(phone).get(); res.json(d.exists?d.data():null);} catch(e){res.status(500).json({error:'Could not load customer'});}
});

// Static pages
app.use(express.static(path.join(__dirname,'public'),{index:'index.html',dotfiles:'deny'}));
app.use((req,res)=>{ if(req.path.startsWith('/api/')) return res.status(404).json({error:'API route not found'}); res.sendFile(path.join(__dirname,'public','index.html')); });

ensureSeedData().catch(e=>console.error('Seed migration skipped:',e.message));

app.listen(PORT,()=>console.log(`🧶 WoollyCraft running on port ${PORT}`));
