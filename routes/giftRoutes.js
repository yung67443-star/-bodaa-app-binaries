const express = require('express');
const router = express.Router();
const giftController = require('../controllers/giftController');

// App handles: Sealing custom messaging strings onto a snack payload
router.post('/create-message', giftController.sealGiftMessage);

// Web scanner handles: Launching the premium HTML envelope presentation view
router.get('/reveal/:orderId', giftController.revealGiftEnvelope);

module.exports = router;
