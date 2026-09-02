# BusGo AI

A real-time smart bus tracking and occupancy management platform for passengers, conductors, and administrators.

BusGo AI allows users to view live bus locations, monitor crowd levels, issue tickets, and manage routes and stops through a role-based web application. The system combines a React frontend with a Spring Boot backend, a PostgreSQL database, and real-time WebSocket updates for live trip state.

## Features

- Live bus tracking on an interactive map
- Real-time occupancy and crowd level monitoring
- Automatic stop progression using geofencing and GPS updates
- Passenger ETA and next-stop information
- Conductor trip management and ticket issuance
- Admin dashboard for fleet, routes, and analytics
- Role-based authentication with Admin, Conductor, and Passenger access
- WebSocket-based live synchronization without page refreshes

## Tech Stack

### Frontend
- React
- Vite
- React Router
- Leaflet + React-Leaflet
- Tailwind CSS
- STOMP client for real-time updates

### Backend
- Java 17
- Spring Boot 4.1.0
- Spring Security
- Spring Data JPA
- PostgreSQL
- JWT authentication
- WebSocket support

### Legacy/Additional Server
- Node.js + Express + Prisma (in the `server/` folder)

## Project Structure

```text
BusApp/
├── client/                # React frontend
├── server/                # Node.js/Express backend
├── server-spring/         # Main Spring Boot backend
├── PROJECT_REPORT.md      # Detailed technical project report
├── README.md              # GitHub project README
└── .github/               # GitHub workflows/config if present
```

## Architecture

The frontend communicates with the Spring Boot backend through REST APIs and WebSockets. Live GPS updates are sent from conductor devices or simulation mode, processed by the backend, and then broadcast to relevant connected clients.

```text
React Frontend -> REST + WebSocket -> Spring Boot API -> PostgreSQL
                                |
                                +-> Live trip state broadcasting
```

## Prerequisites

Before running the project, make sure you have installed:

- Java 17+
- Maven
- Node.js 18+
- PostgreSQL
- Git

## Database Setup

Create a PostgreSQL database named:

```text
busgo_dev
```

The Spring Boot application is configured to connect to PostgreSQL at:

```text
jdbc:postgresql://localhost:5432/busgo_dev
```

### Configuring credentials

Database and JWT secrets are **not** stored in the repository. Copy the example file
and fill in your own local values:

```bash
cd server-spring && cp secrets.properties.example secrets.properties
```

`secrets.properties` is gitignored. It sets:

```text
DB_URL          jdbc:postgresql://localhost:5432/busgo_dev
DB_USERNAME     postgres
DB_PASSWORD     your local postgres password
APP_JWT_SECRET  a random string of at least 32 characters
```

Generate a JWT secret with `openssl rand -hex 32`.

> In production these are supplied as environment variables (for example in the
> Render dashboard) rather than through the file, and environment variables take
> precedence if both are present.

## Running the App

### 1) Start the backend

From the project root:

```bash
cd server-spring
./mvnw spring-boot:run
```

The backend will run on:

```text
http://localhost:8080
```

Swagger UI is available at:

```text
http://localhost:8080/swagger-ui/index.html
```

### 2) Start the frontend

Open a second terminal and run:

```bash
cd client
npm install
npm run dev
```

The frontend usually runs at:

```text
http://localhost:5173
```

## Default Login Credentials

The backend seeds default users on startup.

### Admin
- Email: `admin@busgo.ai`
- Password: `admin123`

### Conductor
- Email: `conductor@busgo.ai`
- Password: `conductor123`

### Additional seeded conductor
- Email: `syed@busgo.ai`
- Password: `password`

## Demo Route

The application includes a seeded route and stops for demonstration:

- Hebbal
- Yelahanka
- Doddaballapura
- Route: Hebbal - Doddaballapura

## Notes

- Geofencing is configured at a radius of 100 meters with a dwell time of 3 seconds.
- Automatic bus stop progression is the core behavior of the system.
- Real-time trip updates are broadcast over WebSocket topics for connected clients.

## License

This project is currently distributed without a formal license declaration.

## Contact

For questions or collaboration, please reach out through the repository owner or project maintainer.

## Related Docs

- [PROJECT_REPORT.md](PROJECT_REPORT.md) — project overview, architecture, and system design
