// ─────────────────────────────────────────────
// DOLCE RIDE — Vendor Web Config (CONNECTED ✅)
// Project: bodaa-app
// Still missing: VAPID key for iPhone push (see README step 2)
// Firebase Console → Project Settings → Cloud Messaging → Web Push certificates → Generate
// ─────────────────────────────────────────────
window.DOLCE_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCBVpX3626iL5zyfzZMGpDXETj6X99lxvg",
  authDomain: "bodaa-app.firebaseapp.com",
  databaseURL: "https://bodaa-app-default-rtdb.firebaseio.com",
  projectId: "bodaa-app",
  storageBucket: "bodaa-app.firebasestorage.app",
  messagingSenderId: "349965400677",
  appId: "1:349965400677:web:9c43682314609e6fbd648c",
  measurementId: "G-CYM9Z3KWF7"
};
window.DOLCE_VAPID_KEY = "PASTE_VAPID_KEY";
window.DOLCE_ENDPOINTS = {
  binariesBase: "https://bodaa-app-binaries-svaw.onrender.com",
  localUpload: "/api/media/upload"
};