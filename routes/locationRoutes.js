const express = require('express');
const router = express.Router();
const locationController = require('../controllers/locationController');

// App handles: Request token parameters creation
router.post('/request', locationController.createLocationRequest);

// Web browser handles: Pushing Bob's real-time browser GPS coordinates 
router.post('/update/:token', locationController.updateLocationCoordinates);

module.exports = router;
