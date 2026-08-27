const express = require('express');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const prisma = require('../config/prisma');

const router = express.Router();

router.get('/', async (req, res) => {
  const buses = await prisma.bus.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      trips: {
        where: { status: 'active' },
        include: { 
          route: {
            include: {
              routeStops: {
                include: { stop: true },
                orderBy: { stopOrder: 'asc' }
              }
            }
          }
        }
      }
    }
  });

  // Simple rule-based prediction
  const currentHour = new Date().getHours();
  let predictionStr = 'Stable';
  if ((currentHour >= 8 && currentHour <= 10) || (currentHour >= 17 && currentHour <= 19)) {
    predictionStr = 'Expected to spike (Rush Hour)';
  } else if (currentHour >= 22 || currentHour <= 5) {
    predictionStr = 'Expected to drop (Night)';
  } else {
    predictionStr = 'Moderate traffic expected';
  }

  // Map to old structure for frontend compatibility
  const mappedBuses = buses.map(b => {
    // Mock ETA logic (3 to 8 minutes)
    const mockEta = Math.floor(Math.random() * 5) + 3;
    return {
      _id: b.id,
      busNumber: b.busNumber,
      capacity: b.capacity,
      routeName: b.trips.length > 0 ? b.trips[0].route.name : 'Unassigned',
      occupancy: b.trips.length > 0 ? b.trips[0].currentOccupancy : 0,
      stops: b.trips.length > 0 ? b.trips[0].route.routeStops.map(rs => ({ id: rs.stop.id, name: rs.stop.name })) : [],
      tripId: b.trips.length > 0 ? b.trips[0].id : null,
      currentStopId: b.trips.length > 0 ? b.trips[0].currentStopId : null,
      prediction: predictionStr,
      eta: `${mockEta} mins`
    };
  });

  return res.json({ buses: mappedBuses });
});

router.post('/', auth, requireRole('admin'), async (req, res) => {
  try {
    const { busNumber, routeName, capacity, stops } = req.body;
    if (!busNumber || !routeName) {
      return res.status(400).json({ message: 'busNumber and routeName are required' });
    }

    const existing = await prisma.bus.findUnique({ where: { busNumber: busNumber.toUpperCase() } });
    if (existing) {
      return res.status(409).json({ message: 'Bus already exists' });
    }

    // 1. Create or find Route
    let route = await prisma.route.findFirst({ where: { name: routeName } });
    if (!route) {
      route = await prisma.route.create({ data: { name: routeName } });
      
      // Seed route stops
      if (Array.isArray(stops)) {
        for (let i = 0; i < stops.length; i++) {
          const stopName = stops[i];
          let stop = await prisma.stop.findUnique({ where: { name: stopName } });
          if (!stop) {
            stop = await prisma.stop.create({ data: { name: stopName } });
          }
          await prisma.routeStop.create({
            data: { routeId: route.id, stopId: stop.id, stopOrder: i }
          });
        }
      }
    }

    // 2. Create Bus
    const bus = await prisma.bus.create({
      data: {
        busNumber: busNumber.toUpperCase(),
        capacity: capacity || 50,
      },
    });

    // 3. Create active Trip to associate Bus with Route
    await prisma.trip.create({
      data: {
        busId: bus.id,
        routeId: route.id,
        status: 'active',
        currentOccupancy: 0
      }
    });

    return res.status(201).json({ bus: { _id: bus.id, busNumber: bus.busNumber, routeName, stops } });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to create bus' });
  }
});

module.exports = router;
