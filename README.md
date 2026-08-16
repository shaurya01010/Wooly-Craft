# WoollyCraft — Render + Firebase Firestore + Cloudinary + Razorpay

Persistent store architecture:
- Render: Node/Express app
- Firebase Firestore: products, orders, settings
- Cloudinary: product images (free plan available; check current quota)
- Razorpay: online payments only

## Render
Build: `npm install`
Start: `npm start`

## Environment variables
ADMIN_PASSWORD
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
FIREBASE_SERVICE_ACCOUNT_B64
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET

Never commit secrets to GitHub.
