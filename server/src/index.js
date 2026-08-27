const http = require('http')
const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const { Server } = require('socket.io')

const healthRoutes = require('./routes/health')
const authRoutes = require('./routes/auth')
const busRoutes = require('./routes/buses')
const ticketRoutes = require('./routes/tickets')
const tripRoutes = require('./routes/trips')
const seedAdmin = require('./utils/seedAdmin')
const prisma = require('./config/prisma')

dotenv.config()

const app = express()

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    credentials: true,
  })
)
app.use(express.json())

app.get('/', (req, res) => {
  res.json({ message: 'BusGo AI API' })
})
app.use('/api/health', healthRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/buses', busRoutes)
app.use('/api/tickets', ticketRoutes)
app.use('/api/trips', tripRoutes)

const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    credentials: true,
  },
})

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`)

  // Passenger subscribes to a specific bus/trip
  socket.on('subscribe_bus', (data) => {
    const { busId } = data
    if (busId) {
      const room = `bus_${busId}`
      socket.join(room)
      console.log(`Socket ${socket.id} joined room ${room}`)
    }
  })

  // Conductor emits live location
  socket.on('update_location', async (data) => {
    const { busId, tripId, latitude, longitude } = data
    if (busId && latitude && longitude) {
      const room = `bus_${busId}`
      
      // Broadcast to passengers
      io.to(room).emit('bus_location_updated', {
        busId,
        tripId,
        latitude,
        longitude,
        timestamp: new Date()
      })

      // Optional: Save to DB if trip is active (maybe throttle this in production)
      if (tripId) {
        try {
          await prisma.busLocation.create({
            data: {
              tripId: parseInt(tripId),
              latitude: parseFloat(latitude),
              longitude: parseFloat(longitude)
            }
          })
        } catch (error) {
          console.error('Error saving location', error)
        }
      }
    }
  })

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`)
  })
})

const PORT = process.env.PORT || 5000

const startServer = async () => {
  try {

    await seedAdmin()
    server.listen(PORT, () => {
      console.log(`API running on port ${PORT}`)
    })
  } catch (error) {
    console.error('Failed to start server:', error.message)
    process.exit(1)
  }
}

startServer()
