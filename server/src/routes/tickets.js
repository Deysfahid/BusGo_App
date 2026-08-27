const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const prisma = require('../config/prisma');

const router = express.Router();

router.post('/issue', auth, requireRole('admin', 'conductor', 'inspector'), async (req, res) => {
  try {
    const { busId, fromStop, toStop, passengerCount } = req.body;
    if (!busId || !fromStop || !toStop || !passengerCount) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    if (fromStop === toStop) {
      return res.status(400).json({ message: 'Destination stop must differ' });
    }

    const count = Number(passengerCount);
    if (Number.isNaN(count) || count < 1) {
      return res.status(400).json({ message: 'Passenger count must be at least 1' });
    }

    // Find active trip for the bus
    const activeTrip = await prisma.trip.findFirst({
      where: { busId: parseInt(busId), status: 'active' },
      include: { bus: true, route: { include: { routeStops: { include: { stop: true } } } } }
    });

    if (!activeTrip) {
      return res.status(404).json({ message: 'Active trip for bus not found' });
    }

    const bus = activeTrip.bus;
    if (activeTrip.currentOccupancy + count > bus.capacity) {
      return res.status(400).json({ message: 'Bus capacity exceeded' });
    }

    // Find stop IDs
    const originStop = await prisma.stop.findUnique({ where: { name: fromStop } });
    const destStop = await prisma.stop.findUnique({ where: { name: toStop } });

    if (!originStop || !destStop) {
      return res.status(400).json({ message: 'Stops must exist' });
    }

    // Create ticket
    const ticket = await prisma.ticket.create({
      data: {
        tripId: activeTrip.id,
        fromStopId: originStop.id,
        toStopId: destStop.id,
        passengerCount: count,
        issuedById: req.user.id,
      }
    });

    // Update occupancy
    const updatedTrip = await prisma.trip.update({
      where: { id: activeTrip.id },
      data: { currentOccupancy: activeTrip.currentOccupancy + count }
    });

    return res.status(201).json({
      ticket: { ...ticket, _id: ticket.id },
      bus: {
        _id: bus.id,
        busNumber: bus.busNumber,
        routeName: activeTrip.route.name,
        occupancy: updatedTrip.currentOccupancy,
        capacity: bus.capacity,
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to issue ticket' });
  }
});

module.exports = router;
