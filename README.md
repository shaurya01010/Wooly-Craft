# WoollyCraft Pro

Professional WoollyCraft handmade ecommerce starter.

## Run
```powershell
npm install
Copy-Item .env.example .env
npm start
```

Open http://localhost:3000/
Admin: http://localhost:3000/admin/

Configure Firebase, Razorpay, Cloudinary and ADMIN_PASSWORD in `.env`.

Firebase Admin SDK stores products/orders permanently when configured. Razorpay totals are calculated on the server and signatures are verified on the server. Cloudinary receives admin product images; only the resulting URL is stored with the product.


## Latest home-store upgrade

- Home page now uses a dedicated product slider instead of Featured Products.
- Slider supports up to 5 products.
- Slider auto-advances every 1.5 seconds, with arrows, dots and mobile swipe.
- Clicking a slider product opens the Shop page and highlights that exact product.
- Added editable Amazon-style budget shortcuts: Under ₹49, Under ₹69, Under ₹99 and Under ₹149 by default.
- Admin can add, edit, disable/remove, or permanently delete budget shortcuts.
- Admin can add/remove/reorder the 5 slider products.
- Budget and slider configuration is stored in Firebase Firestore when Firebase is configured; local fallback is used for local development.

## Latest upgrade
- Customer account dashboard follows the supplied Linewise account specification: profile, summary, active order, orders, wishlist, addresses, coupons, reviews, recently viewed, recommendations, settings and support links. No OTP is used.
- Added persistent profile-completion reminder. It stays visible until the customer saves name and phone details.
- Added cart toast notification instead of browser alert when a product is added.
- Admin product editor now accepts up to 5 product images in one upload and previews them before saving.
- Product images are uploaded to Cloudinary and the resulting URLs are stored with the product. Product pages can display a 5-image gallery.
- Orders now carry a customerId and customer orders can be retrieved from Firebase when Firebase is configured.
- Customer profile/address data can be stored in Firebase when configured.

## Admin v2.4 full-working upgrade

The admin panel is no longer a collection of placeholder pages. The sidebar sections now have working local/Firebase-backed data flows:

- Dashboard
- Orders + status history + AWB + CSV export
- Products + unique SKU + up to 5 Cloudinary images + tags/badges
- Inventory
- Categories
- Home Slider (up to 5, 1.5-second customer slider)
- Price Options (Under ₹49 / ₹69 / ₹99 / ₹149 and custom options)
- Customers
- Payments
- Coupons
- Offers
- Banners
- Reviews
- Analytics
- Shipping
- Invoices
- Admin Users
- Settings

When Firebase is not configured, admin/customer/order data is persisted locally in `backend/data/admin-data.json`, so restarting localhost does not erase test orders. Order status updates update the existing order record instead of pushing a duplicate order.

Temporary COD is also available when `codEnabled` is enabled in Admin → Settings.


## Admin login
Open `http://localhost:3000/admin/`. The default admin password is `shaurya123` unless you change `ADMIN_PASSWORD` in `.env`.
