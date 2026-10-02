// 📍 FIX: Import FieldValue directly from the modular SDK subpath
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

// Initialize the handle inside functions to ensure server.js finishes boot tasks first
const getDb = () => getFirestore();

/**
 * Generates an 8-character token and creates a tracking session.
 */
exports.createLocationRequest = async (req, res) => {
    try {
        const { requesterUid, recipientName, recipientPhone, roleType } = req.body;

        if (!requesterUid || !recipientPhone || !roleType) {
            return res.status(400).json({ success: false, error: "Missing required tracking parameters." });
        }

        const trackingToken = Math.random().toString(36).substring(2, 10).toUpperCase();
        const db = getDb();

        await db.collection('location_requests').document(trackingToken).set({
            tracking_token: trackingToken,
            requester_uid: requesterUid,
            recipient_name: recipientName || "A Loved One",
            recipient_phone: recipientPhone,
            role_type: roleType, // "PICKUP" or "DROPOFF"
            status: "PENDING",
            latitude: 0.0,
            longitude: 0.0,
            resolved_address: "",
            // 📍 FIX: Replaced 'admin.firestore' with the modern destructured FieldValue property
            created_at: FieldValue.serverTimestamp()
        });

        return res.status(200).json({
            success: true,
            trackingToken: trackingToken,
            webTrackingUrl: `https://${req.get('host')}/track.html?token=${trackingToken}`
        });

    } catch (e) {
        console.error("[LOCATION CONTROLLER ERROR]:", e.message);
        return res.status(500).json({ success: false, error: "Failed to allocate secure token structures." });
    }
};

/**
 * Updates coordinates instantly when Bob hits 'Allow' in his web browser.
 */
exports.updateLocationCoordinates = async (req, res) => {
    try {
        const { token } = req.params;
        const { latitude, longitude, resolvedAddress } = req.body;

        if (!latitude || !longitude) {
            return res.status(400).json({ success: false, error: "Coordinates invalid or unresolved." });
        }

        const db = getDb();
        const requestDocRef = db.collection('location_requests').document(token);
        const docSnapshot = await requestDocRef.get();

        if (!docSnapshot.exists) {
            return res.status(404).json({ success: false, error: "This location link has expired or is invalid." });
        }

        await requestDocRef.update({
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            resolved_address: resolvedAddress || "Shared Contact Point",
            status: "COMPLETED",
            // 📍 FIX: Replaced 'admin.firestore' with the modern destructured FieldValue property
            updated_at: FieldValue.serverTimestamp()
        });

        console.log(`[DOLCE RIDE SYNC]: Synced coordinates for token: ${token}`);
        return res.status(200).json({ success: true, message: "Location updated successfully! Friend notified." });

    } catch (e) {
        console.error("[LOCATION CONTROLLER ERROR]:", e.message);
        return res.status(500).json({ success: false, error: "Internal processing failure writing coordinate maps." });
    }
};
