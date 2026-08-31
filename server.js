const express = require('express');
const path = require('path');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize and configure Cloudinary credentials
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
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
