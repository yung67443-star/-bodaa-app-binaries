const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * Saves a card message attached to a snack delivery transaction order.
 */
exports.sealGiftMessage = async (req, res) => {
    try {
        const { orderId, senderName, recipientPhone, giftMessage } = req.body;

        if (!orderId || !giftMessage) {
            return res.status(400).json({ success: false, error: "Missing identity tracking tokens or gift text." });
        }

        await db.collection('premium_gift_cards').document(orderId).set({
            order_id: orderId,
            sender_name: senderName || "A Mysterious Admirer",
            recipient_phone: recipientPhone || "",
            gift_message: giftMessage,
            opened: false,
            created_at: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.status(200).json({ success: true, message: "Premium message card sealed successfully." });

    } catch (e) {
        console.error("[GIFT CONTROLLER ERROR]:", e.message);
        return res.status(500).json({ success: false, error: "Failed to seal luxury message envelopes safely." });
    }
};

/**
 * Serves a premium custom CSS/HTML web view envelope for the camera QR scanner.
 */
exports.revealGiftEnvelope = async (req, res) => {
    try {
        const { orderId } = req.params;
        const cardSnapshot = await db.collection('premium_gift_cards').document(orderId).get();

        if (!cardSnapshot.exists) {
            return res.status(404).send("<h3 style='font-family:sans-serif; text-align:center; margin-top:50px;'>Oops! This digital envelope does not exist.</h3>");
        }

        const data = cardSnapshot.data();
        await db.collection('premium_gift_cards').document(orderId).update({ opened: true });

        // Serve the high-end unboxing presentation directly
        return res.send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Dolce Ride — Premium Gift</title>
                <link href="https://googleapis.com" rel="stylesheet">
                <style>
                    body { background-color: #FAF4F0; font-family: 'Poppins', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; overflow: hidden; }
                    .envelope-container { text-align: center; width: 90%; max-width: 400px; background: #FFFFFF; padding: 30px; border-radius: 24px; box-shadow: 0 15px 35px rgba(212, 140, 126, 0.15); border: 1px solid #F3ECE6; transform: translateY(20px); opacity: 0; animation: slideUp 0.8s cubic-bezier(0.1, 1, 0.1, 1) forwards; }
                    .brand { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: #D48C7E; font-weight: 600; margin-bottom: 25px; }
                    .icon { font-size: 42px; margin-bottom: 10px; animation: heartBeat 2s infinite ease-in-out; }
                    h2 { color: #4A3E3D; font-family: 'Playfair Display', serif; font-style: italic; font-size: 24px; margin: 0 0 15px 0; }
                    .divider { width: 40px; height: 2px; background: #EEDCD0; margin: 15px auto; }
                    .message-box { background: #FFFDFB; border: 1px dashed #E3CFC3; padding: 20px; border-radius: 16px; color: #615554; font-size: 15px; line-height: 1.6; margin-top: 15px; font-style: italic; }
                    .sender-tag { margin-top: 25px; font-weight: 500; color: #4A3E3D; font-size: 14px; }
                    @keyframes slideUp { to { transform: translateY(0); opacity: 1; } }
                    @keyframes heartBeat { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
                </style>
            </head>
            <body>
                <div class="envelope-container">
                    <div class="brand">Dolce Ride Premium Box</div>
                    <div class="icon">🧁🎁✨</div>
                    <h2>A sweet message for you...</h2>
                    <div class="divider"></div>
                    <div class="message-box">"${data.gift_message}"</div>
                    <div class="sender-tag">— with love from ${data.sender_name}</div>
                </div>
            </body>
            </html>
        `);

    } catch (e) {
        return res.status(500).send("An error occurred opening your gift envelope.");
    }
};
