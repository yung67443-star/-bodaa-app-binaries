const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const getDb = () => getFirestore();
const BASE_URL = process.env.BASE_URL || "https://bodaa-app-binaries.onrender.com";
const LINK_TTL_MIN = 30;

/**
 * POST /api/location/request
 * Body: { requesterUid, requesterName, recipientName, recipientPhone, roleType }
 */
exports.createLocationRequest = async (req, res) => {
    try {
        const { requesterUid, requesterName, recipientName, recipientPhone, roleType } = req.body;

        if (!requesterUid || !recipientPhone || !roleType) {
            return res.status(400).json({ success: false, error: "Missing required tracking parameters." });
        }

        const trackingToken = Math.random().toString(36).substring(2, 10).toUpperCase();
        const db = getDb();
        const now = Date.now();

        await db.collection('location_requests').doc(trackingToken).set({
            tracking_token: trackingToken,
            requester_uid: requesterUid,
            requester_name: (requesterName || "A friend").toString().slice(0, 40),
            recipient_name: recipientName || "A Loved One",
            recipient_phone: recipientPhone,
            role_type: roleType, // "PICKUP" or "DROPOFF"
            status: "PENDING",
            latitude: 0.0,
            longitude: 0.0,
            resolved_address: "",
            expires_at_ms: now + LINK_TTL_MIN * 60 * 1000,
            created_at: FieldValue.serverTimestamp()
        });

        return res.status(200).json({
            success: true,
            trackingToken,
            webTrackingUrl: `${BASE_URL}/track.html?token=${trackingToken}`
        });

    } catch (e) {
        console.error("[LOCATION CONTROLLER ERROR]:", e.message);
        return res.status(500).json({ success: false, error: "Failed to allocate secure token structures." });
    }
};

/**
 * GET /api/location/request/:token
 * Public — only safe display fields (no phone, no coords until shared).
 */
exports.getLocationRequest = async (req, res) => {
    try {
        const { token } = req.params;
        const snap = await getDb().collection('location_requests').doc(token).get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Link invalid." });
        const d = snap.data();
        if (d.expires_at_ms && Date.now() > d.expires_at_ms && d.status === "PENDING") {
            return res.status(410).json({ success: false, error: "Link expired. Ask for a fresh one." });
        }
        return res.status(200).json({
            success: true,
            recipientName: d.recipient_name || "there",
            requesterName: d.requester_name || "A friend",
            roleType: d.role_type || "DROPOFF",
            status: d.status || "PENDING"
        });
    } catch (e) {
        console.error("[LOCATION GET ERROR]:", e.message);
        return res.status(500).json({ success: false, error: "Lookup failed." });
    }
};

/**
 * POST /api/location/update/:token — Bob hits Allow.
 */
exports.updateLocationCoordinates = async (req, res) => {
    try {
        const { token } = req.params;
        const { latitude, longitude, resolvedAddress } = req.body;

        if (!latitude || !longitude) {
            return res.status(400).json({ success: false, error: "Coordinates invalid or unresolved." });
        }

        const db = getDb();
        const ref = db.collection('location_requests').doc(token);
        const snap = await ref.get();

        if (!snap.exists) {
            return res.status(404).json({ success: false, error: "This location link has expired or is invalid." });
        }
        const d = snap.data();
        if (d.expires_at_ms && Date.now() > d.expires_at_ms && d.status === "PENDING") {
            return res.status(410).json({ success: false, error: "Link expired. Ask for a fresh one." });
        }
        if (d.status === "COMPLETED") {
            return res.status(200).json({ success: true, message: "Already synced." });
        }

        await ref.update({
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            resolved_address: resolvedAddress || "Shared Contact Point",
            status: "COMPLETED",
            updated_at: FieldValue.serverTimestamp()
        });

        console.log(`[DOLCE RIDE SYNC]: Synced coordinates for token: ${token}`);
        return res.status(200).json({ success: true, message: "Location updated successfully! Friend notified." });

    } catch (e) {
        console.error("[LOCATION CONTROLLER ERROR]:", e.message);
        return res.status(500).json({ success: false, error: "Internal processing failure writing coordinate maps." });
    }
};