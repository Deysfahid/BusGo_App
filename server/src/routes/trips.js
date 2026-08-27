const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const prisma = require('../config/prisma');

const router = express.Router();

// Start a trip
router.post('/start', auth, requireRole('conductor', 'admin'), async (req, res) => {
  try {
    const { busId, routeId } = req.body;
    if (!busId || !routeId) {
      return res.status(400).json({ message: 'busId and routeId are required' });
    }

    // Check if bus already has an active trip
    const activeTrip = await prisma.trip.findFirst({
      where: { busId: parseInt(busId), status: 'active' }
    });

    if (activeTrip) {
      return res.status(409).json({ message: 'Bus already has an active trip' });
    }

    const trip = await prisma.trip.create({
      data: {
        busId: parseInt(busId),
        routeId: parseInt(routeId),
        status: 'active',
        currentOccupancy: 0,
      }
    });

    return res.status(201).json({ trip });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to start trip' });
  }
});

// End a trip
router.post('/end', auth, requireRole('conductor', 'admin'), async (req, res) => {
  try {
    const { tripId } = req.body;
    if (!tripId) {
      return res.status(400).json({ message: 'tripId is required' });
    }

    const trip = await prisma.trip.update({
      where: { id: parseInt(tripId) },
      data: {
        status: 'completed',
        endTime: new Date(),
      }
    });

    return res.json({ trip });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to end trip' });
  }
});

// Update current stop
router.post('/update-stop', auth, requireRole('conductor', 'admin'), async (req, res) => {
  try {
    const { tripId, stopId } = req.body;
    if (!tripId || !stopId) {
      return res.status(400).json({ message: 'tripId and stopId are required' });
    }

    const trip = await prisma.trip.findUnique({
      where: { id: parseInt(tripId) },
      include: { tickets: true }
    });

    if (!trip) {
      return res.status(404).json({ message: 'Trip not found' });
    }

    // Process tickets where destination is the current stop
    let passengersExiting = 0;
    const activeTickets = trip.tickets.filter(t => t.toStopId === parseInt(stopId));
    
    for (const ticket of activeTickets) {
      passengersExiting += ticket.passengerCount;
      // In a real app we might mark the ticket as 'used' or 'completed'
    }

    const newOccupancy = Math.max(0, trip.currentOccupancy - passengersExiting);

    const updatedTrip = await prisma.trip.update({
      where: { id: parseInt(tripId) },
      data: {
        currentStopId: parseInt(stopId),
        currentOccupancy: newOccupancy
      }
    });

    // Save to occupancy history for predictions
    await prisma.occupancyHistory.create({
      data: {
        tripId: parseInt(tripId),
        stopId: parseInt(stopId),
        occupancyCount: newOccupancy
      }
    });

    return res.json({
      trip: updatedTrip,
      passengersExited: passengersExiting
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to update stop' });
  }
});

module.exports = router;
