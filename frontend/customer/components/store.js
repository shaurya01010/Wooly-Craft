let PRODUCTS=[],PRICE_BUCKETS=[],SLIDES=[],HOME_SECTION_PRODUCTS={},slideIndex=0,slideTimer=null;
let cart=JSON.parse(localStorage.woolly_cart||"[]"),wish=JSON.parse(localStorage.woolly_wish||"[]");
if(!localStorage.woolly_customer_id)localStorage.woolly_customer_id=(crypto.randomUUID?crypto.randomUUID():"wc_"+Date.now());
const $=s=>document.querySelector(s),money=n=>"₹"+Number(n||0).toLocaleString("en-IN"),esc=s=>String(s??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
async function api(u,o={}){let r=await fetch(u,{headers:{"Content-Type":"application/json",...(o.headers||{})},...o}),d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||"Request failed");return d}
async function applyUserPageConfig(){try{const d=await api('/api/user-pages'),pages=d.pages||[],map=new Map(pages.map(p=>[p.id,p]));const current=location.pathname.match(/\/customer\/pages\/([^/]+)\.html$/)?.[1];const page=map.get(current);if(page?.name)document.title=page.name+' — WoollyCraft';document.querySelectorAll('a[href*="/customer/pages/"]').forEach(a=>{const m=a.getAttribute('href')?.match(/\/customer\/pages\/([^/?#]+)\.html/);if(!m)return;const p=map.get(m[1]);if(p){a.textContent=(a.textContent.trim().match(/^[^A-Za-z0-9]*/)?.[0]||'')+(p.navLabel||p.name);a.style.display=p.enabled===false?'none':''}else if(current&&USER_PAGE_IDS.has(m[1]))a.style.display='none'});const nav=document.querySelector('.navlinks');if(nav){pages.filter(p=>p.enabled!==false&&!['home','shop','product','cart','checkout','orders','order-confirmation','track-order','wishlist','profile','addresses','reviews','support'].includes(p.id)).forEach(p=>{const exists=[...nav.querySelectorAll('a[href]')].some(a=>{const h=a.getAttribute('href')||'';return h.includes('/customer/pages/'+p.id+'.html')||h==='/'+p.id+'.html'});if(!exists&&!nav.querySelector(`[data-user-page-link="${p.id}"]`)){const a=document.createElement('a');a.href='/customer/pages/'+encodeURIComponent(p.id)+'.html';a.textContent=p.navLabel||p.name;a.dataset.userPageLink=p.id;nav.appendChild(a)}});
// Prevent duplicate navigation entries when multiple old menu items point to the same page.
const seen=new Set(), seenLabels=new Set();[...nav.querySelectorAll('a[href]')].forEach(a=>{const raw=a.getAttribute('href')||'';const url=new URL(raw,location.origin);const key=url.pathname+url.search;const label=(a.textContent||'').replace(/\s+/g,' ').trim().toLowerCase(); if(seen.has(key)||label==='shop'&&seenLabels.has('shop')){a.remove()}else{seen.add(key);if(label==='shop')seenLabels.add('shop')}});
}}catch(e){console.warn('User page config unavailable',e)}}
const USER_PAGE_IDS=new Set(['home','shop','product','cart','checkout','orders','order-confirmation','track-order','wishlist','profile','addresses','reviews','support']);
const img=p=>(p.images&&p.images[0])||p.image||"https://placehold.co/700x700/f3e5df/8d5b4c?text=WoollyCraft";
function notify(msg){let n=document.getElementById("wcToast");if(!n){n=document.createElement("div");n.id="wcToast";n.style.cssText="position:fixed;left:50%;bottom:24px;transform:translate(-50%,20px);opacity:0;background:#2d2522;color:#fff;padding:12px 18px;border-radius:999px;z-index:999;font-weight:700;font-size:13px;transition:.25s;box-shadow:0 12px 30px rgba(0,0,0,.2)";document.body.appendChild(n)}n.textContent=msg;n.style.opacity="1";n.style.transform="translate(-50%,0)";clearTimeout(window.__wcToast);window.__wcToast=setTimeout(()=>{n.style.opacity="0";n.style.transform="translate(-50%,20px)"},2200)}
function save(){localStorage.woolly_cart=JSON.stringify(cart);localStorage.woolly_wish=JSON.stringify(wish);document.querySelectorAll("[data-count]").forEach(x=>x.textContent=cart.reduce((a,b)=>a+b.qty,0))}
function productShopUrl(id){return "/customer/pages/product.html?id="+encodeURIComponent(id)}
function card(p){return `<article class="card" id="product-${esc(p.id)}"><div class="card-img"><img loading="lazy" src="${esc(img(p))}" alt="${esc(p.name)}"><span class="pill">${esc(p.badge||"HANDMADE")}</span><button class="heart" aria-label="Wishlist" onclick="toggleWish('${esc(p.id)}')">${wish.includes(p.id)?"♥":"♡"}</button></div><div class="card-body"><h3>${esc(p.name)}</h3><small class="sku">Product No: ${esc(p.sku||"—")}</small><p>${esc(p.description)}</p><span class="price">${money(p.price)}</span>${p.originalPrice?`<span class="old">${money(p.originalPrice)}</span>`:""}<div class="card-actions"><button class="btn light" onclick="add('${esc(p.id)}')">Add to cart</button><a class="btn primary" href="/customer/pages/product.html?id=${encodeURIComponent(p.id)}">View</a></div></div></article>`}
function add(id){
  const p=PRODUCTS.find(x=>String(x.id)===String(id));
  if(!p){notify("Product is unavailable");return;}
  let x=cart.find(i=>String(i.id)===String(p.id));
  x?x.qty++:cart.push({id:p.id,qty:1});
  save();
  notify(`🛒 ${p.name} added to cart`);
}
function toggleWish(id){wish.includes(id)?wish=wish.filter(x=>x!==id):wish.push(id);save();render()}
function renderSlider(){
  const track=$("#sliderTrack"),dots=$("#sliderDots"); if(!track)return;
  if(!SLIDES.length){track.innerHTML='<div class="slider-empty">Slider products will appear here.</div>';dots.innerHTML="";return}
  if(slideIndex>=SLIDES.length)slideIndex=0;
  track.innerHTML=SLIDES.map((p,i)=>`<div class="slide" role="button" tabindex="0" onclick="openSlide('${esc(p.id)}')" onkeydown="if(event.key==='Enter')openSlide('${esc(p.id)}')">
    <div class="slide-copy"><span class="eyebrow">${esc(p.badge||"WOOLLYCRAFT PICK")}</span><h3>${esc(p.name)}</h3><p>${esc(p.description||"Handmade with care.")}</p><div><span class="price">${money(p.price)}</span>${p.originalPrice?`<span class="old">${money(p.originalPrice)}</span>`:""} <span class="btn primary" style="margin-left:8px">Shop this →</span></div></div>
    <div class="slide-image"><img src="${esc(img(p))}" alt="${esc(p.name)}"></div>
  </div>`).join("");
  dots.innerHTML=SLIDES.map((_,i)=>`<button class="slider-dot ${i===slideIndex?"active":""}" aria-label="Slide ${i+1}" onclick="goSlide(${i})"></button>`).join("");
  track.style.transform=`translateX(-${slideIndex*100}%)`;
}
function goSlide(i){if(!SLIDES.length)return;slideIndex=(i+SLIDES.length)%SLIDES.length;renderSlider();restartSlider()}
function moveSlide(n){goSlide(slideIndex+n)}
function openSlide(id){location.href=productShopUrl(id)}
function restartSlider(){clearInterval(slideTimer);if(SLIDES.length>1)slideTimer=setInterval(()=>moveSlide(1),1500)}
function setupSliderTouch(){const box=$("#homeSlider");if(!box)return;let startX=0;box.addEventListener("touchstart",e=>{startX=e.touches[0].clientX},{passive:true});box.addEventListener("touchend",e=>{let dx=e.changedTouches[0].clientX-startX;if(Math.abs(dx)>45)moveSlide(dx<0?1:-1)},{passive:true});box.addEventListener("mouseenter",()=>clearInterval(slideTimer));box.addEventListener("mouseleave",restartSlider)}
function renderBudgets(){
  const el=$("#priceBuckets"); if(!el)return;
  el.innerHTML=PRICE_BUCKETS.filter(x=>x.active!==false).map(b=>`<a class="budget-card" href="/customer/pages/shop.html?price=${encodeURIComponent(b.id)}"><b>${esc(b.label)}</b><span>Shop →</span></a>`).join("")||'<div class="empty">Budget options are coming soon.</div>';
}
function render(){
  save();
  document.querySelectorAll("[data-products]").forEach(el=>{let a=PRODUCTS;if(el.dataset.products==="trending")a=PRODUCTS.filter(x=>x.trending);el.innerHTML=a.length?a.map(card).join(""):`<div class="empty">No products yet.</div>`});
  let s=$("[data-shop]");
  if(s){
    let q=($("[data-search]")?.value||"").toLowerCase(),c=$("[data-cat]")?.value||"all",sort=$("[data-sort]")?.value||"featured",priceId=new URLSearchParams(location.search).get("price"),price=PRICE_BUCKETS.find(x=>x.id===priceId),a=PRODUCTS.filter(p=>p.active!==false&&(c==="all"||p.category===c)&&(`${p.name} ${p.description} ${p.sku||""} ${(p.tags||[]).join(" ")}`.toLowerCase().includes(q))&&(!price||((price.min==null||p.price>=Number(price.min))&&(price.max==null||p.price<=Number(price.max)))));
    if(sort==="low")a.sort((x,y)=>x.price-y.price);if(sort==="high")a.sort((x,y)=>y.price-x.price);if(sort==="new")a.sort((x,y)=>(y.createdAt||0)-(x.createdAt||0));
    s.innerHTML=a.length?a.map(card).join(""):`<div class="empty">No products found.</div>`;
    const notice=$("#shopNotice");if(notice){if(price){notice.textContent=price.label;notice.classList.remove("hidden")}else notice.classList.add("hidden")}
    const target=new URLSearchParams(location.search).get("product");if(target){setTimeout(()=>{let node=document.getElementById("product-"+target);if(node){node.scrollIntoView({behavior:"smooth",block:"center"});node.classList.add("slider-highlight");setTimeout(()=>node.classList.remove("slider-highlight"),1300)}},80)}
  }
  let w=$("[data-wishlist]");if(w){let a=PRODUCTS.filter(p=>wish.includes(p.id));w.innerHTML=a.length?a.map(card).join(""):`<div class="empty"><h2>Your wishlist is empty</h2><a class="btn primary" href="/customer/pages/shop.html">Start shopping</a></div>`}
  let d=$("[data-detail]");if(d){let p=PRODUCTS.find(x=>x.id===new URLSearchParams(location.search).get("id"));if(p){let recent=JSON.parse(localStorage.woolly_recent||"[]").filter(x=>x!==p.id);recent.unshift(p.id);localStorage.woolly_recent=JSON.stringify(recent.slice(0,12));}d.innerHTML=p?`<div class="detail-img"><img id="mainProductImage" src="${esc(img(p))}" alt="${esc(p.name)}">${(p.images&&p.images.length>1)?`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${p.images.slice(0,5).map((u,i)=>`<button type="button" onclick="document.getElementById(\'mainProductImage\').src=\'${esc(u)}\'" style="border:1px solid #eadfd8;background:#fff;padding:2px;border-radius:8px"><img src="${esc(u)}" style="width:58px;height:58px;object-fit:cover;border-radius:6px"></button>`).join("")}</div>`:""}</div><div><span class="eyebrow">${esc(p.category)}</span><h1>${esc(p.name)}</h1><div class="product-number">Product No: <b>${esc(p.sku||"—")}</b></div><div class="product-tags">${(p.tags||[]).map(t=>`<span class="pill">${esc(t)}</span>`).join(" ")}</div><div class="detail-price">${money(p.price)}</div><p>${esc(p.description)}</p><div class="stack"><button class="btn primary" onclick="add('${esc(p.id)}')">Add to cart</button><a class="btn light" href="/customer/pages/cart.html">Go to cart</a></div></div>`:`<div class="empty">Product not found.</div>`}
  let c=$("[data-cart]");if(c){if(!cart.length)c.innerHTML=`<div class="empty"><h2>Your cart is empty</h2><a class="btn primary" href="/customer/pages/shop.html">Start shopping</a></div>`;else{let rows=cart.map(i=>{let p=PRODUCTS.find(x=>x.id===i.id);return p?`<div class="cart-row"><img src="${esc(img(p))}"><div><b>${esc(p.name)}</b><p>${money(p.price)} × ${i.qty}</p><div class="qty"><button onclick="qty('${p.id}',-1)">−</button><span>${i.qty}</span><button onclick="qty('${p.id}',1)">+</button></div></div><button class="btn light" onclick="removeItem('${p.id}')">Remove</button></div>`:""}).join(""),t=cart.reduce((s,i)=>{let p=PRODUCTS.find(x=>x.id===i.id);return s+(p?p.price*i.qty:0)},0);api("/api/config").then(cfg=>{let free=cfg.freeShippingEnabled!==false&&cfg.freeShipping!=null&&t>=Number(cfg.freeShipping),ship=free?0:Number(cfg.shipping||49);c.innerHTML=rows+`<div class="summary"><div class="line"><span>Subtotal</span><b>${money(t)}</b></div><div class="line"><span>Shipping</span><b>${free?"FREE":money(ship)}</b></div><div class="line total"><span>Total</span><b>${money(t+ship)}</b></div><a class="btn primary" style="width:100%;margin-top:10px" href="/customer/pages/checkout.html">Checkout</a></div>`}).catch(()=>{let ship=49;c.innerHTML=rows+`<div class="summary"><div class="line"><span>Subtotal</span><b>${money(t)}</b></div><div class="line"><span>Shipping</span><b>${money(ship)}</b></div><div class="line total"><span>Total</span><b>${money(t+ship)}</b></div><a class="btn primary" style="width:100%;margin-top:10px" href="/customer/pages/checkout.html">Checkout</a></div>`})}}
}
function qty(id,n){let x=cart.find(i=>i.id===id);x.qty+=n;if(x.qty<1)cart=cart.filter(i=>i.id!==id);render()}function removeItem(id){cart=cart.filter(i=>i.id!==id);render()}
async function checkout(){
  let e=$("[data-checkout]");
  if(!e)return;
  cart=cart.filter(i=>PRODUCTS.some(p=>String(p.id)===String(i.id)&&p.active!==false));
  save();
  if(!cart.length){e.innerHTML='<div class="empty"><h2>Your cart is empty</h2><a class="btn primary" href="/customer/pages/shop.html">Start shopping</a></div>';return;}
  let rows=cart.map(i=>{let p=PRODUCTS.find(x=>String(x.id)===String(i.id));return p?`<div class="cart-row"><img src="${esc(img(p))}" alt=""><div><b>${esc(p.name)}</b><small>Product No: ${esc(p.sku||p.productNumber||"—")}</small><p>${money(p.price)} × ${i.qty}</p></div></div>`:""}).join("");
  let sub=cart.reduce((sum,i)=>{let p=PRODUCTS.find(x=>String(x.id)===String(i.id));return sum+(p?p.price*i.qty:0)},0);
  let cfg=await api("/api/config"),shipping=(cfg.freeShippingEnabled!==false&&cfg.freeShipping!=null&&sub>=Number(cfg.freeShipping))?0:Number(cfg.shipping||49);
  e.innerHTML=`<div class="checkout-summary"><h2>Order summary</h2>${rows}<div class="summary"><div class="line"><span>Subtotal</span><b>${money(sub)}</b></div><div class="line"><span>Shipping</span><b>${shipping?money(shipping):"FREE"}</b></div><div class="line total"><span>Total</span><b>${money(sub+shipping)}</b></div></div></div><form class="form" onsubmit="pay(event)"><h2>Delivery details</h2><div id="savedAccountBox" class="mini" style="margin-bottom:14px;display:none"></div><div class="form-grid"><label class="field"><span>Name</span><input id="name" required></label><label class="field"><span>Phone</span><input id="phone" required></label><label class="field"><span>Email</span><input id="email" type="email"></label><label class="field full"><span>Saved delivery address</span><select id="savedAddress" onchange="useSavedAddress(this.value)"><option value="new">Enter a new address</option></select></label><label class="field"><span>Pincode</span><input id="pin" required></label><label class="field full"><span>Address</span><textarea id="address" required></textarea></label><label class="field"><span>City</span><input id="city" required></label><label class="field"><span>State</span><input id="state" value="Uttar Pradesh" required></label><label class="field full"><span>Payment method</span><select id="paymentMethod"><option value="razorpay">Razorpay — Pay online</option>${cfg.codEnabled!==false?'<option value="cod">Cash on Delivery — temporary</option>':''}</select></label></div><p id="addressMsg" class="muted" style="margin-top:8px"></p><p id="payerr" class="error"></p><button id="payButton" class="btn primary" style="width:100%">Continue to payment · ${money(sub+shipping)}</button></form>`;
  await loadSavedCheckoutProfile();
}
async function loadSavedCheckoutProfile(){
  const cid=localStorage.woolly_customer_id;
  if(!cid)return;
  try{
    const d=await api('/api/customer/profile?customerId='+encodeURIComponent(cid));
    const p=d.profile;
    if(!p)return;
    localStorage.woolly_saved_customer=JSON.stringify(p);
    $("#name").value=p.name||""; $("#phone").value=p.phone||""; $("#email").value=p.email||"";
    const addresses=Array.isArray(p.addresses)?p.addresses:[];
    const sel=$("#savedAddress");
    if(sel && addresses.length){
      addresses.forEach((a,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=`${a.label||'Address'} — ${a.address||''}, ${a.city||''} ${a.pincode||''}${a.isDefault?' ★':''}`;sel.appendChild(o)});
      const di=Math.max(0,addresses.findIndex(a=>a.isDefault)); sel.value=String(di); useSavedAddress(String(di));
    }
    const box=$("#savedAccountBox");
    if(box){box.style.display='block';box.innerHTML=`<b>✓ Saved account</b><span style="display:block;margin-top:4px">${esc(p.name||'Customer')} · ${esc(p.phone||'')} · Your details are saved on this device.</span><a href="/customer/pages/profile.html" style="display:inline-block;margin-top:7px">Manage account & delivery addresses →</a>`}
  }catch(e){
    try{const p=JSON.parse(localStorage.woolly_saved_customer||'null');if(p){$("#name").value=p.name||"";$("#phone").value=p.phone||"";$("#email").value=p.email||""}}catch(_){ }
  }
}
function useSavedAddress(index){
  const sel=$("#savedAddress"), msg=$("#addressMsg");
  if(!sel || index==='new'){if(msg)msg.textContent='Enter a new delivery address. It will be saved for your next order.';return;}
  try{
    const p=JSON.parse(localStorage.woolly_saved_customer||'null');
    const a=p&&Array.isArray(p.addresses)?p.addresses[Number(index)]:null;
    if(!a)return;
    $("#pin").value=a.pincode||"";$("#address").value=a.address||"";$("#city").value=a.city||"";$("#state").value=a.state||"Uttar Pradesh";
    if(msg)msg.innerHTML=`Using <b>${esc(a.label||'saved address')}</b>. <a href="/customer/pages/profile.html#addresses">Change address</a>`;
  }catch(e){}
}
async function saveCustomerAfterOrder(customer){
  const cid=localStorage.woolly_customer_id;if(!cid)return;
  try{
    const current=(await api('/api/customer/profile?customerId='+encodeURIComponent(cid))).profile||{};
    let addresses=Array.isArray(current.addresses)?current.addresses:[];
    const key=[customer.address,customer.city,customer.state,customer.pincode].map(x=>String(x||'').trim().toLowerCase()).join('|');
    const idx=addresses.findIndex(a=>[a.address,a.city,a.state,a.pincode].map(x=>String(x||'').trim().toLowerCase()).join('|')===key);
    const addr={label:idx>=0?(addresses[idx].label||'Home'):'Home',address:customer.address,city:customer.city,state:customer.state,pincode:customer.pincode,isDefault:true,updatedAt:Date.now()};
    addresses=addresses.map(a=>({...a,isDefault:false}));
    if(idx>=0)addresses[idx]={...addresses[idx],...addr};else addresses.unshift(addr);
    const profile={customerId:cid,name:customer.name,phone:customer.phone,email:customer.email,addresses:addresses.slice(0,20),avatar:current.avatar||'',preferences:current.preferences||{}};
    const out=await api('/api/customer/profile',{method:'PUT',body:JSON.stringify(profile)});
    localStorage.woolly_saved_customer=JSON.stringify(out.profile||profile);
  }catch(err){console.warn('Could not save customer profile:',err)}
}
async function pay(e){e.preventDefault();try{let cfg=await api("/api/config"),fresh=(await api("/api/products")).products||[],items=cart.map(x=>{let p=fresh.find(y=>String(y.id)===String(x.id));if(!p)throw Error("Product not found: "+x.id);return {id:p.id,qty:x.qty}}),customer={name:$("#name").value,phone:$("#phone").value,email:$("#email").value,address:$("#address").value,city:$("#city").value,state:$("#state").value,pincode:$("#pin").value},method=$("#paymentMethod").value;if(method==="cod"){let out=await api("/api/payments/cod",{method:"POST",body:JSON.stringify({items,customer,customerId:localStorage.woolly_customer_id})});cart=[];save();localStorage.woolly_orders=JSON.stringify([...(JSON.parse(localStorage.woolly_orders||"[]")),out.orderId]);location.href="/customer/pages/order-confirmation.html?id="+out.orderId;return}if(!cfg.razorpayKeyId)throw Error("Razorpay is not configured in .env");let o=await api("/api/payments/create-order",{method:"POST",body:JSON.stringify({items,customer})});let s=document.createElement("script");s.src="https://checkout.razorpay.com/v1/checkout.js";s.onload=()=>new Razorpay({key:cfg.razorpayKeyId,amount:o.amount,currency:"INR",name:"WoollyCraft",order_id:o.razorpayOrderId,prefill:customer,theme:{color:"#8d5b4c"},handler:async r=>{let out=await api("/api/payments/verify",{method:"POST",body:JSON.stringify({...r,items,customer,customerId:localStorage.woolly_customer_id})});await saveCustomerAfterOrder(customer);cart=[];save();localStorage.woolly_orders=JSON.stringify([...(JSON.parse(localStorage.woolly_orders||"[]")),out.orderId]);location.href="/customer/pages/order-confirmation.html?id="+out.orderId}}).open();document.head.appendChild(s)}catch(x){$("#payerr").textContent=x.message}}
async function confirm(){let e=$("[data-confirm]");if(!e)return;try{let o=(await api("/api/orders/"+new URLSearchParams(location.search).get("id"))).order;e.innerHTML=`<div class="empty"><div style="font-size:3rem">🎉</div><h1>Order confirmed!</h1><p>Order ID: <b>${esc(o.id)}</b></p><p>Amount paid: <b>${money(o.amount)}</b></p><a class="btn primary" href="/customer/pages/track-order.html?id=${encodeURIComponent(o.id)}">Track order</a></div>`}catch(x){e.innerHTML=`<div class="empty">Order not found.</div>`}}
document.addEventListener("DOMContentLoaded",async()=>{try{await applyUserPageConfig();PRODUCTS=(await api("/api/products")).products||[];PRICE_BUCKETS=(await api("/api/price-buckets")).items||[];try{HOME_SECTION_PRODUCTS=(await api("/api/home-sections")).products||{}}catch(_){HOME_SECTION_PRODUCTS={}};let cat=$("[data-cat]");if(cat)[...new Set(PRODUCTS.filter(x=>x.active!==false).map(x=>x.category))].forEach(c=>cat.insertAdjacentHTML("beforeend",`<option>${esc(c)}</option>`));let price=$("[data-price]");if(price)PRICE_BUCKETS.filter(x=>x.active!==false).forEach(b=>price.insertAdjacentHTML("beforeend",`<option value="${esc(b.id)}">${esc(b.label)}</option>`));SLIDES=(await api("/api/home-slider")).products||[];render();renderBudgets();renderSlider();setupSliderTouch();restartSlider();await checkout();await confirm()}catch(e){console.error(e)}});