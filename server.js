const express = require('express');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const nodemailer = require('nodemailer');
// Initialize and configure Cloudinary credentials
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});
const emailTransporter = nodemailer.createTransport({
    service: 'gmail', // You can use Gmail, Outlook, or your custom business webmail domain
    auth: {
        user: process.env.SUPPORT_EMAIL_ADDRESS,     // Your business email address
        pass: process.env.SUPPORT_EMAIL_APP_PASSWORD // Secure Google App Password (not your raw login password)
    }
});
// Configure Multer to parse memory buffer slots (bypasses saving locally to temporary disk files)
const storageEngine = multer.memoryStorage();
const uploadParser = multer({ 
    storage: storageEngine,
    limits: { fileSize: 5 * 1024 * 1024 } // Strict 5MB file cap safety shield
});

// Body data parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static helpdesk support page
app.use(express.static(path.join(__dirname, 'public')));
/**
 * @route POST /api/support/ticket
 * @desc Handles incoming user complaints, missing item claims, and fraud reporting vectors
 * @access Public
 */
app.post('/api/support/ticket', (req, res) => {
    const { ticketType, userName, userPhone, userEmail, reportedEntity, eventDescription } = req.body;

    // Validate essential contact coordinates form parameters safely
    if (!ticketType || !userName || !userPhone || !eventDescription) {
        return res.status(400).json({ success: false, error: "Missing required form fields." });
    }

    // Format the support email notification markup body clearly for administrators
    const mailOptions = {
        from: `"Bodaa Helpdesk" <${process.env.SUPPORT_EMAIL_ADDRESS}>`,
        to: process.env.SUPPORT_EMAIL_ADDRESS, // Sends directly to your inbox
        subject: `🚨 [${ticketType.toUpperCase()}] New Support Ticket from ${userName}`,
        html: `
            <div style="font-family: sans-serif; padding: 20px; color: #1F2937; max-width: 600px; border: 1px solid #E5E7EB; border-radius: 12px;">
                <h2 style="color: #FF6B35; margin-bottom: 20px;">New Helpdesk Support Ticket</h2>
                <p><strong>Ticket Category:</strong> ${ticketType.replace('_', ' ').toUpperCase()}</p>
                <hr style="border: 0; border-top: 1px solid #F3F4F6; margin: 15px 0;" />
                <p><strong>Reporter Name:</strong> ${userName}</p>
                <p><strong>Contact Phone:</strong> ${userPhone}</p>
                <p><strong>Contact Email:</strong> ${userEmail || 'Not Provided'}</p>
                <p><strong>Reported Driver/Vendor/Passenger Name:</strong> ${reportedEntity || 'N/A'}</p>
                <hr style="border: 0; border-top: 1px solid #F3F4F6; margin: 15px 0;" />
                <p><strong>Detailed Incident Description:</strong></p>
                <div style="background-color: #F9FAFB; padding: 15px; border-radius: 8px; border-left: 4px solid #FF6B35; font-style: italic;">
                    "${eventDescription}"
                </div>
                <p style="font-size: 11px; color: #9CA3AF; margin-top: 25px;">Submitted via Bodaa Web Support Portal infrastructure.</p>
            </div>
        `
    };

    // Fire the email transit action asynchronous pipe
    emailTransporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error('[NODEMAILER TRANSACTION ERROR]:', error.message);
            return res.status(500).json({ success: false, error: "Failed to transmit support ticket to administrative email relays." });
        }
        console.log('[SUPPORT ROUTER]: Ticket notification dispatched successfully.', info.messageId);
        return res.status(200).json({ success: true, message: "Your support ticket was submitted successfully! Our team will contact you shortly." });
    });
});
/**
 * @route POST /api/media/upload
 * @desc Accepts multipart imagery streaming data from Android and pushes directly to Cloudinary CDN
 * @access Public
 */
app.post('/api/media/upload', uploadParser.single('product_image'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: "Media upload abort: No file payload found in the request." });
        }

        // Convert the parsed memory buffer file bytes into a base64 string stream that Cloudinary recognizes
        const base64FileString = req.file.buffer.toString('base64');
        const dataUriString = `data:${req.file.mimetype};base64,${base64FileString}`;

        // Stream the data directly to Cloudinary's global cloud server network
        cloudinary.uploader.upload(dataUriString, {
            folder: 'bodaa_merchant_catalogs',
            resource_type: 'image'
        }, (error, result) => {
            if (error) {
                console.error('[CLOUDINARY TRANSACTION ERROR]:', error.message);
                return res.status(500).json({ success: false, error: "Failed to pipe media stream to cloud infrastructure nodes." });
            }

            // Respond back to Android with the permanent secure URL link address
            return res.status(200).json({
                success: true,
                message: "Image uploaded successfully!",
                imageUrl: result.secure_url // e.g. https://cloudinary.com...
            });
        });

    } catch (exception) {
        console.error('[API EXCEPTION CAUGHT]:', exception.message);
        return res.status(500).json({ success: false, error: "Internal crash occurred processing file multipart parameters." });
    }
});

// APK Package Download Route: Driver Fleet Build
app.get('/download/driver', (req, res) => {
    // Replace with your direct download link (e.g. GitHub Releases Link, Mediafire direct or Google Drive direct download)
    const DRIVER_APK_CLOUD_URL = "https://github.com";
    
    console.log("[APK ROUTER]: Redirecting user down to Driver App binary stream.");
    res.redirect(DRIVER_APK_CLOUD_URL);
});

// APK Package Download Route: Vendor/Merchant Panel Build
app.get('/download/vendor', (req, res) => {
    const VENDOR_APK_CLOUD_URL = "https://github.com";
    
    console.log("[APK ROUTER]: Redirecting user down to Vendor App binary stream.");
    res.redirect(VENDOR_APK_CLOUD_URL);
});

// Fallback to Support site home routing path
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`[BODAA SERVER RUNNING]: Listening closely on port ${PORT}`);
});
