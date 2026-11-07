/**
 * PATCH for locationController.js — hybrid share.
 * What changed vs your version:
 *  1. recipientName/recipientPhone now OPTIONAL (WhatsApp sheet path has no contact yet).
 *  2. purpose + note accepted, enforced rule: PICKUP => ORDER_FOR_THEM.
 * Apply: replace createLocationRequest + getLocationRequest in your file,
 * or drop this whole file in (identical except those two handlers).
 */
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const getDb = () => getFirestore();
const BASE_URL = process.env.BASE_URL || "https://bodaa-app-binaries-svaw.onrender.com";
const LINK_TTL_MIN = 30;

const PURPOSES = ['ORDER_FOR_THEM', 'ME_TO_THEM', 'GIFT_SURPRISE'];

function resolvePurpose(roleType, purpose) {
  const role = String(roleType || '').toUpperCase().trim();
  let p = String(purpose || '').toUpperCase().trim();
  if (role === 'PICKUP') return 'ORDER_FOR_THEM';
  if (!PURPOSES.includes(p)) return 'GIFT_SURPRISE';
  if (p === 'ORDER_FOR_THEM') return 'GIFT_SURPRISE';
  return p;
}

exports.createLocationRequest = async (req, res) => {
    try {
        const { requesterUid, requesterName, recipientName, recipientPhone, roleType, purpose, note } = req.body;

        // HYBRID: recipient optional (sheet path shares before picking a chat)
        if (!requesterUid || !roleType) {
            return res.status(400).json({ success: false, error: "Missing required tracking parameters." });
        }

        const role = String(roleType).toUpperCase().trim();
        if (role !== 'PICKUP' && role !== 'DROPOFF') {
            return res.status(400).json({ success: false, error: "roleType must be PICKUP or DROPOFF." });
        }
        const finalPurpose = resolvePurpose(role, purpose);

        const trackingToken = Math.random().toString(36).substring(2, 10).toUpperCase();
        const db = getDb();
        const now = Date.now();

        await db.collection('location_requests').doc(trackingToken).set({
            tracking_token: trackingToken,
            requester_uid: requesterUid,
            requester_name: (requesterName || "A friend").toString().slice(0, 40),
            recipient_name: (recipientName || "WhatsApp share").toString().slice(0, 40),
            recipient_phone: (recipientPhone || "").toString().slice(0, 20),
            role_type: role,
            purpose: finalPurpose,
            note: (note || "").toString().slice(0, 140),
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
            purpose: finalPurpose,
            webTrackingUrl: `${BASE_URL}/track.html?token=${trackingToken}`
        });

    } catch (e) {
        console.error("[LOCATION CONTROLLER ERROR]:", e.message);
        return res.status(500).json({ success: false, error: "Failed to allocate secure token structures." });
    }
};

exports.getLocationRequest = async (req, res) => {
    try {
        const { token } = req.params;
        const snap = await getDb().collection('location_requests').doc(token).get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Link invalid." });
        const d = snap.data();
        if (d.expires_at_ms && Date.now() > d.expires_at_ms && d.status === "PENDING") {
            return res.status(410).json({ success: false, error: "Link expired. Ask for a fresh one." });
        }
        const role = String(d.role_type || "DROPOFF").toUpperCase();
        const purpose = resolvePurpose(role, d.purpose);
        return res.status(200).json({
            success: true,
            recipientName: d.recipient_name || "there",
            requesterName: d.requester_name || "A friend",
            roleType: role,
            purpose,
            note: d.note || "",
            status: d.status || "PENDING"
        });
    } catch (e) {
        console.error("[LOCATION GET ERROR]:", e.message);
        return res.status(500).json({ success: false, error: "Lookup failed." });
    }
};

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

exports.resolvePurpose = resolvePurpose;