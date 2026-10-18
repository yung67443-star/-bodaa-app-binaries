const express = require('express');
const router = express.Router();
const locationController = require('../controllers/locationController');

console.log("✅ locationRoutes LOADED");

router.post('/request', locationController.createLocationRequest);
router.get('/request/:token', locationController.getLocationRequest); // NEW: personalization lookup
router.post('/update/:token', locationController.updateLocationCoordinates);

module.exports = router;