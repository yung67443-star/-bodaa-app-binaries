const express = require('express');
const router = express.Router();
const locationController = require('../controllers/locationController');

console.log("✅ locationRoutes.js LOADED — registering /request");
console.log("   Controller has createLocationRequest?", typeof locationController.createLocationRequest);

router.post('/request', locationController.createLocationRequest);
router.post('/update/:token', locationController.updateLocationCoordinates);

module.exports = router;