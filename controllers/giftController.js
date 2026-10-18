const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const getDb = () => getFirestore();
// TODO: replace with your real Play Store URL when live
const PLAY_STORE_URL = process.env.PLAY_STORE_URL || "https://play.google.com/store";

const escapeHtml = (unsafe = "") =>
    String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

const personaEmoji = (p = "") => ({
    bae: "❤️", talking: "👀", mom_dad: "🙏",
    bestie: "🤞", sibling: "🏠", me: "😌"
}[p] || "🎁");

/**
 * POST /api/gift/create-message
 * Body: { orderId, senderName, senderUid, recipientPhone, giftMessage, persona, vendorName }
 */
exports.sealGiftMessage = async (req, res) => {
    try {
        const { orderId, senderName, senderUid, recipientPhone, giftMessage, persona, vendorName } = req.body;

        if (!orderId || !giftMessage) {
            return res.status(400).json({ success: false, error: "Missing identity tracking tokens or gift text." });
        }

        const db = getDb();
        await db.collection('premium_gift_cards').doc(orderId).set({
            order_id: orderId,
            sender_name: senderName || "A Mysterious Admirer",
            sender_uid: senderUid || "",
            recipient_phone: recipientPhone || "",
            gift_message: giftMessage.toString().slice(0, 500),
            persona: persona || "",
            vendor_name: vendorName || "",
            opened: false,
            opened_at: null,
            created_at: FieldValue.serverTimestamp()
        });

        return res.status(200).json({ success: true, message: "Premium message card sealed successfully." });

    } catch (e) {
        console.error("[GIFT CONTROLLER ERROR]:", e.message);
        return res.status(500).json({ success: false, error: "Failed to seal luxury message envelopes safely." });
    }
};

/**
 * GET /api/gift/reveal/:orderId — QR target. Screenshot-worthy envelope.
 */
exports.revealGiftEnvelope = async (req, res) => {
    try {
        const { orderId } = req.params;
        const db = getDb();

        const cardSnapshot = await db.collection('premium_gift_cards').doc(orderId).get();

        if (!cardSnapshot.exists) {
            return res.status(404).send("<h3 style='font-family:sans-serif; text-align:center; margin-top:50px;'>Oops! This digital envelope does not exist.</h3>");
        }

        const data = cardSnapshot.data();

        // Mark opened once (keeps first opened_at for sender receipt)
        if (!data.opened) {
            await db.collection('premium_gift_cards').doc(orderId).update({
                opened: true,
                opened_at: FieldValue.serverTimestamp()
            });
            // NOTE: fire FCM to sender here if you have admin.messaging():
            // admin.messaging().send({ token: senderFcm, notification: { title: `${sender} opened your note 💌` } })
        }

        const safeMessage = escapeHtml(data.gift_message);
        const safeSender = escapeHtml(data.sender_name);
        const safeVendor = escapeHtml(data.vendor_name || "");
        const emoji = personaEmoji(data.persona);
        const shareText = encodeURIComponent("I just got surprised via Bodaa " + emoji);

        return res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Bodaa — A gift for you ${emoji}</title>
                <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;1,600&family=Poppins:wght@400;500;600&display=swap" rel="stylesheet">
                <style>
                    body { background-color: #FAF4F0; font-family: 'Poppins', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; overflow-x: hidden; padding: 16px; box-sizing: border-box; }
                    .confetti { position: fixed; top: -30px; font-size: 20px; animation: fall linear forwards; pointer-events: none; z-index: 5; }
                    @keyframes fall { to { transform: translateY(110vh) rotate(360deg); } }
                    .envelope-container { text-align: center; width: 100%; max-width: 400px; background: #FFFFFF; padding: 30px 26px 22px; border-radius: 24px; box-shadow: 0 15px 35px rgba(212,140,126,.15); border: 1px solid #F3ECE6; transform: translateY(20px) scale(.97); opacity: 0; animation: slideUp .8s cubic-bezier(.1,1,.1,1) forwards; position: relative; z-index: 10; }
                    .brand { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: #D48C7E; font-weight: 600; margin-bottom: 18px; }
                    .icon { font-size: 42px; margin-bottom: 10px; animation: heartBeat 2s infinite ease-in-out; }
                    h2 { color: #4A3E3D; font-family: 'Playfair Display', serif; font-style: italic; font-size: 24px; margin: 0 0 12px 0; }
                    .divider { width: 40px; height: 2px; background: #EEDCD0; margin: 12px auto; }
                    .message-box { background: #FFFDFB; border: 1px dashed #E3CFC3; padding: 20px; border-radius: 16px; color: #615554; font-size: 15px; line-height: 1.6; margin-top: 12px; font-style: italic; font-family: 'Playfair Display', serif; }
                    .sender-tag { margin-top: 18px; font-weight: 500; color: #4A3E3D; font-size: 14px; }
                    .vendor-tag { margin-top: 6px; font-size: 12px; color: #9A8A86; }
                    .btn { display: block; width: 100%; border: none; border-radius: 14px; padding: 14px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 12px; text-decoration: none; box-sizing: border-box; }
                    .btn-primary { background: #4A3E3D; color: #fff; }
                    .btn-ghost { background: #FFF1E6; color: #EA580C; }
                    .watermark { margin-top: 16px; font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #C9B8B2; }
                    .tiny { margin-top: 8px; font-size: 11px; color: #B7A6A1; }
                    @keyframes slideUp { to { transform: translateY(0) scale(1); opacity: 1; } }
                    @keyframes heartBeat { 0%,100% { transform: scale(1); } 50% { transform: scale(1.06); } }
                </style>
            </head>
            <body>
                <div class="envelope-container" id="card">
                    <div class="brand">Bodaa Premium Box</div>
                    <div class="icon">${emoji}🧁✨</div>
                    <h2>A sweet message for you...</h2>
                    <div class="divider"></div>
                    <div class="message-box">"${safeMessage}"</div>
                    <div class="sender-tag">— with love from ${safeSender}</div>
                    ${safeVendor ? `<div class="vendor-tag">${safeVendor} • delivered in ~12 min 🛵</div>` : `<div class="vendor-tag">Delivered with love 🛵</div>`}
                    <a class="btn btn-primary" href="${PLAY_STORE_URL}">Surprise them back in 1 tap ❤️</a>
                    <button class="btn btn-ghost" onclick="shareMoment()">Share this moment 📤</button>
                    <div class="watermark">Made with Bodaa 🛵</div>
                    <div class="tiny">87% sent midnight snacks back this week 🔥</div>
                </div>
                <script>
                    // confetti hearts on open (screenshot moment)
                    const emojis = ['❤️','✨','🧁','💌','🎉'];
                    for (let i = 0; i < 26; i++) {
                        const s = document.createElement('div');
                        s.className = 'confetti';
                        s.textContent = emojis[Math.floor(Math.random()*emojis.length)];
                        s.style.left = Math.random()*100 + 'vw';
                        s.style.animationDuration = (2.2 + Math.random()*2.5) + 's';
                        s.style.fontSize = (14 + Math.random()*18) + 'px';
                        document.body.appendChild(s);
                        setTimeout(() => s.remove(), 5000);
                    }
                    function shareMoment() {
                        const text = decodeURIComponent('${shareText}') + ' — surprise someone: ${PLAY_STORE_URL}';
                        if (navigator.share) { navigator.share({ title: 'Bodaa surprise', text, url: '${PLAY_STORE_URL}' }).catch(()=>{}); }
                        else { window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(text), '_blank'); }
                    }
                </script>
            </body>
            </html>
        `);

    } catch (e) {
        console.error("[GIFT REVEAL ERROR]:", e.message);
        return res.status(500).send("An error occurred opening your gift envelope.");
    }
};