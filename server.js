const express = require('express');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
require('dotenv').config();

// 📍 Modern Modular Firebase Imports
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { cert } = require('firebase-admin/app');

const app = express();
const PORT = process.env.PORT || 3000;
const nodemailer = require('nodemailer');

// 1. Initialize Firebase Admin SDK using the standalone cert import
const serviceAccount = require('./firebase-service-account.json');
initializeApp({
    credential: cert(serviceAccount) // ✅ 100% reliable in modern SDK versions
});

// 2. Establish your Firestore handle using the modern method
const db = getFirestore();

// Configure Cloudinary credentials
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});
const emailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.SUPPORT_EMAIL_ADDRESS,     
        pass: process.env.SUPPORT_EMAIL_APP_PASSWORD 
    }
});

const storageEngine = multer.memoryStorage();
const uploadParser = multer({ 
    storage: storageEngine,
    limits: { fileSize: 5 * 1024 * 1024 }
});

// Global standard body parsers [4]
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// =========================================================================
// 🎛️ MOUNT THE NEW SEPARATED DOLCE RIDE ROUTERS
// =========================================================================
const locationRoutes = require('./routes/locationRoutes');
const giftRoutes = require('./routes/giftRoutes');

// All endpoints inside locationRoutes will be prefixed with /api/location
app.use('/api/location', locationRoutes);

// All endpoints inside giftRoutes will be prefixed with /api/gift
app.use('/api/gift', giftRoutes);

// =========================================================================
// RETAINED HERITAGE CODE WORKFLOWS (Helpdesk tickets & APK delivery channels) [4]
// =========================================================================
app.post('/api/support/ticket', (req, res) => {
    const { ticketType, userName, userPhone, userEmail, eventDescription } = req.body;
    if (!ticketType || !userName || !userPhone || !eventDescription) {
        return res.status(400).json({ success: false, error: "Missing required fields." });
    }
    const mailOptions = {
        from: `"Dolce Ride Helpdesk" <${process.env.SUPPORT_EMAIL_ADDRESS}>`,
        to: process.env.SUPPORT_EMAIL_ADDRESS,
        subject: `🚨 [${ticketType.toUpperCase()}] New Ticket from ${userName}`,
        html: `<h3>New Incident Report</h3><p><strong>Name:</strong> ${userName}</p><p>${eventDescription}</p>`
    };
    emailTransporter.sendMail(mailOptions, (error) => {
        if (error) return res.status(500).json({ success: false, error: "Failed to transmit support ticket." });
        return res.status(200).json({ success: true, message: "Ticket submitted successfully!" });
    });
});

app.post('/api/media/upload', uploadParser.single('product_image'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: "No media file stream attached." });
        const base64FileString = req.file.buffer.toString('base64');
        const dataUriString = `data:${req.file.mimetype};base64,${base64FileString}`;
        cloudinary.uploader.upload(dataUriString, { folder: 'bodaa_merchant_catalogs' }, (error, result) => {
            if (error) return res.status(500).json({ success: false, error: "Cloudinary upload failure." });
            return res.status(200).json({ success: true, imageUrl: result.secure_url });
        });
    } catch (e) {
        return res.status(500).json({ success: false, error: "Internal file processing error." });
    }
});

app.get('/download/driver', (req, res) => res.redirect("https://github.com"));
app.get('/download/vendor', (req, res) => res.redirect("https://github.com"));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
    console.log(`[DOLCE RIDE MASTER ROUTER ACTIVE]: Listening on port ${PORT}`);
});
