// DOLCE VENDOR-WEB MASTER ROUTER - STANDALONE AMBASSADOR EDITION
// Existing routes kept 100%. Ambassador added WITHOUT touching main backend.
// Serves:
//   /ambassador/login.html  -> public/ambassador/login.html (NEW dark login - you lost this file)
//   /ambassador/dashboard.html -> public/ambassador/dashboard.html (NEW dark dashboard with slots/escrow)
//   /ambassador             -> redirect to /ambassador/login.html
//   /admin                  -> public/admin/index.html
// IMPORTANT: these must stay BEFORE the catch-all.
// Fixed: Express 5 no longer allows app.get('*') -> use app.get(/.*/)

const express = require('express');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
require('dotenv').config();

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getDatabase } = require('firebase-admin/database');

const app = express();
const PORT = process.env.PORT || 3000;
const nodemailer = require('nodemailer');

const serviceAccount = require('./firebase-service-account.json');
initializeApp({
  credential: cert(serviceAccount),
  databaseURL: process.env.FIREBASE_RTDB_URL || 'https://bodaa-app-default-rtdb.firebaseio.com',
});

const db = getFirestore();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
const emailTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.SUPPORT_EMAIL_ADDRESS, pass: process.env.SUPPORT_EMAIL_APP_PASSWORD },
});

const storageEngine = multer.memoryStorage();
const uploadParser = multer({ storage: storageEngine, limits: { fileSize: 5 * 1024 * 1024 } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- existing routers (kept) ----
const locationRoutes = require('./routes/locationRoutes');
const giftRoutes = require('./routes/giftRoutes');
app.use('/api/location', locationRoutes);
app.use('/api/gift', giftRoutes);

// ---- NEW: standalone ambassador (no main-backend dependency) ----
const ambassadorRoutes = require('./routes/ambassadorRoutes');
app.use('/api/ambassador', ambassadorRoutes);

// ---- existing heritage workflows (kept) ----
app.post('/api/support/ticket', (req, res) => {
  const { ticketType, userName, userPhone, userEmail, eventDescription } = req.body;
  if (!ticketType || !userName || !userPhone || !eventDescription) {
    return res.status(400).json({ success: false, error: 'Missing required fields.' });
  }
  const mailOptions = {
    from: `"Dolce Ride Helpdesk" <${process.env.SUPPORT_EMAIL_ADDRESS}>`,
    to: process.env.SUPPORT_EMAIL_ADDRESS,
    subject: `🚨 [${ticketType.toUpperCase()}] New Ticket from ${userName}`,
    html: `<h3>New Incident Report</h3><p><strong>Name:</strong> ${userName}</p><p>${eventDescription}</p>`,
  };
  emailTransporter.sendMail(mailOptions, (error) => {
    if (error) return res.status(500).json({ success: false, error: 'Failed to transmit support ticket.' });
    return res.status(200).json({ success: true, message: 'Ticket submitted successfully!' });
  });
});

app.post('/api/media/upload', uploadParser.single('product_image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No media file stream attached.' });
    const base64FileString = req.file.buffer.toString('base64');
    const dataUriString = `data:${req.file.mimetype};base64,${base64FileString}`;
    cloudinary.uploader.upload(dataUriString, { folder: 'Dolce_merchant_catalogs' }, (error, result) => {
      if (error) return res.status(500).json({ success: false, error: 'Cloudinary upload failure.' });
      return res.status(200).json({ success: true, imageUrl: result.secure_url });
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Internal file processing error.' });
  }
});

app.get('/download/driver', (req, res) => res.redirect('https://github.com'));
app.get('/download/vendor', (req, res) => res.redirect('https://github.com'));
app.get('/vendor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'vendor', 'index.html')));

// ---- NEW ambassador + admin pages (BEFORE catch-all!) ----
const AMB_DIR = path.join(__dirname, 'public', 'ambassador');
const ADMIN_DIR = path.join(__dirname, 'public', 'admin');

// /ambassador -> login (keeps old bookmark working)
app.get('/ambassador', (req, res) => res.sendFile(path.join(AMB_DIR, 'login.html')));
app.get('/ambassador/', (req, res) => res.sendFile(path.join(AMB_DIR, 'login.html')));
app.get('/ambassador/login', (req, res) => res.sendFile(path.join(AMB_DIR, 'login.html')));
app.get('/ambassador/login.html', (req, res) => res.sendFile(path.join(AMB_DIR, 'login.html')));

// dashboard (new dark file with slots/escrow)
app.get('/ambassador/dashboard', (req, res) => res.sendFile(path.join(AMB_DIR, 'dashboard.html')));
app.get('/ambassador/dashboard.html', (req, res) => res.sendFile(path.join(AMB_DIR, 'dashboard.html')));

// legacy: if you still have public/ambassador/index.html (old light combined page),
// keep it accessible at /ambassador/old for rollback
app.get('/ambassador/old', (req, res) => res.sendFile(path.join(AMB_DIR, 'index.html')));

// admin
app.get('/admin', (req, res) => res.sendFile(path.join(ADMIN_DIR, 'index.html')));
app.get('/admin/', (req, res) => res.sendFile(path.join(ADMIN_DIR, 'index.html')));

// catch-all -> main site (Express 5 safe)
app.get(/.*/, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`[DOLCE RIDE MASTER ROUTER + AMBASSADOR STANDALONE]: Listening on port ${PORT}`);
});