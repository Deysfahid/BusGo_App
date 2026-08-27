# BusGo AI — Project Report

*Smart Bus Tracking & Occupancy Prediction System*

---

## 1. Project Overview

**BusGo AI** is a full-stack, real-time public-bus tracking platform. It lets a **conductor** run a live trip from a phone, **passengers** watch buses move on a live map with occupancy and arrival estimates, and an **administrator** manage the fleet and view analytics.

The system's distinguishing feature is that trip progress is **fully automatic**: as the bus physically moves, its GPS position is streamed to the server, which uses **geofencing** to detect stop arrivals, advance the current stop, and automatically "alight" (drop off) the passengers destined for that stop — the conductor never presses a "next stop" button.

It is built as **one React web app** (three role-based experiences) talking to **one Spring Boot backend** over REST + WebSockets, backed by **PostgreSQL**.

---

## 2. Objectives

- Provide **live bus location** to passengers on an interactive map.
- Track **occupancy in real time** as tickets are issued and passengers alight.
- **Automate stop progression** using GPS geofencing instead of manual input.
- Give passengers **crowd levels** and **ETAs** for upcoming stops.
- Give admins **fleet management** (buses, routes, stops, conductors) and **analytics**.
- Enforce **role-based access** (Admin / Conductor / Passenger) with secure authentication.

---

## 3. System Architecture

A **single-page React frontend** communicates with a **monolithic Spring Boot backend** through two channels: a stateless **REST API** (auth, CRUD, ticketing) and a **STOMP-over-WebSocket** channel (live GPS in, live trip state out). All persistent data lives in **PostgreSQL**.

```
                 ┌──────────────────────────────────────────┐
                 │            React SPA (client/)             │
                 │  Passenger • Conductor • Admin  (one app)  │
                 └───────────────┬───────────────┬────────────┘
                     REST/HTTPS  │               │  WebSocket (STOMP)
                (JWT-authenticated)              │  ws://…/ws
                                 ▼               ▼
                 ┌──────────────────────────────────────────┐
                 │        Spring Boot backend (server-spring) │
                 │  Controllers → Services → Repositories     │
                 │  Security (JWT) • Geofencing • Broadcast   │
                 └───────────────────────┬────────────────────┘
                                         │ JPA / Hibernate
                                         ▼
                              ┌────────────────────┐
                              │  PostgreSQL (busgo_dev) │
                              └────────────────────┘
```

**Real-time loop:** Conductor's device publishes GPS → `/app/update_location` → backend runs geofencing & occupancy logic → backend broadcasts a single `LiveTripStateDto` to `/topic/bus_{id}` and `/topic/bus-updates` → all subscribed passengers/conductor update instantly, no refresh.

---

## 4. Technology Stack

### 4.1 Frontend (`client/`)
| Concern | Technology | Version |
|---|---|---|
| UI library | **React** | 19.2.6 |
| Build tool / dev server | **Vite** | 8.0.12 |
| Routing | **React Router DOM** | 7.15.0 |
| Styling | **Tailwind CSS** (via `@tailwindcss/postcss`) | 4.3.0 |
| **Maps** | **Leaflet** + **React-Leaflet** | 1.9.4 / 5.0.0 |
| Real-time client | **@stomp/stompjs** (native WebSocket) | 7.3.0 |
| Icons | **lucide-react** | 1.28.0 |
| Linting | ESLint + react-hooks / react-refresh plugins | 10.x |

### 4.2 Backend (`server-spring/`)
| Concern | Technology | Version |
|---|---|---|
| Framework | **Spring Boot** (Web MVC, Data JPA, Security, Validation, WebSocket starters) | 4.1.0 |
| Language / runtime | **Java** | 17 |
| ORM | **Spring Data JPA / Hibernate** | (Boot-managed) |
| Authentication | **JWT** via `jjwt` (api/impl/jackson) | 0.12.3 |
| DTO mapping | **MapStruct** | 1.5.5.Final |
| Boilerplate reduction | **Lombok** | (Boot-managed) |
| API documentation | **springdoc-openapi** (Swagger UI) | 2.3.0 |
| Build | **Maven** (`mvnw` wrapper) | — |

### 4.3 Database
- **PostgreSQL** — database `busgo_dev` on `localhost:5432`.
- Schema is **auto-managed by Hibernate** (`ddl-auto: update`); tables are created/updated from the JPA entities on startup.
- Initial data (users, stops, routes, buses) is inserted by a **`DataSeeder`** component on boot.

### 4.4 Maps & Geospatial
- **Rendering:** Leaflet map via React-Leaflet, using **CARTO "dark_all" tiles** (`basemaps.cartocdn.com`) with **OpenStreetMap** data attribution.
- **Bus marker:** custom icon (Flaticon bus PNG), 32×32, re-centered smoothly on GPS updates via Leaflet's `map.setView()`.
- **Distance / geofencing:** the **Haversine formula** (great-circle distance) computes bus-to-stop distance for both geofence detection and ETA.

---

## 5. Feature Set

### 5.1 Passenger (public / guest)
- Browse **all active buses** with occupancy % and crowd level.
- Select a bus to open a **live map** with a moving bus marker.
- See **available seats**, **crowd prediction**, **next stop**, and a **live ETA timeline** for remaining stops.
- All values update in real time over WebSocket — **no page refresh**.
- Search/filter by route or bus number; guest access (no login required) or self-registration.

### 5.2 Conductor
- **Start / end a trip** by selecting a bus and route.
- **Issue tickets** (destination stop + passenger count; flat fare **₹15**, cash only) with live capacity validation (cannot oversell seats).
- **Two location modes:**
  - **Real GPS** — uses the device's browser geolocation (`watchPosition`) for on-road use.
  - **Simulation Mode** — auto-drives the route for demos/testing.
- **Live occupancy** and **automatic** current/next-stop display — **there is no manual "Next Stop" button** by design.

### 5.3 Administrator
- **Dashboard:** total buses, active trips, routes, conductors, tickets, average occupancy, today's revenue (all computed from live data).
- **Fleet management:** create/delete **buses, routes, stops**; **assign conductors** to buses; reorder route stops.
- **Guarded deletes:** cannot delete a bus with trip history or a stop used by a route (returns a clear error).
- **Analytics:** busiest routes and busiest stops by real footfall.

### 5.4 Core Real-Time Engine (shared)
- **GPS ingestion** over STOMP (`/app/update_location`).
- **Geofencing:** when the bus is within **100 m** of the next stop for **≥ 3 s**, the stop is marked reached.
- **Automatic stop advancement** and **automatic alighting** of passengers whose destination is the reached stop (occupancy decremented accordingly).
- **Single-source broadcast** of a unified `LiveTripStateDto` to keep every client consistent.

---

## 6. Database Design

### 6.1 Entities (JPA)
| Entity | Purpose |
|---|---|
| **User** | Accounts with a `Role` (ADMIN / CONDUCTOR / PASSENGER); BCrypt-hashed password. |
| **Bus** | Vehicle with `busNumber`, `capacity`, optional assigned conductor. |
| **Stop** | A named location with latitude/longitude. |
| **Route** | A named line composed of ordered stops. |
| **RouteStop** | Join entity linking a Route to a Stop with a `stopOrder`. |
| **Trip** | A running/finished journey of a bus on a route (`status` active/completed, `currentStopId`, `currentOccupancy`, `revenue`). |
| **Ticket** | Issued fare: from/to stop, passenger count, `status` (ACTIVE/COMPLETED). |
| **BusLocation** | Historical GPS points (lat/lon/timestamp) per bus/trip. |
| **OccupancyHistory** | *Scaffolding table for future ML — currently not populated or read.* |
| **Prediction** | *Scaffolding table for future ML — currently not populated or read.* |

### 6.2 Relationships
- `Route 1—* RouteStop *—1 Stop` (ordered many-to-many via `RouteStop`).
- `Bus 1—* Trip`, `Route 1—* Trip`.
- `Trip 1—* Ticket`, each Ticket references a from/to `Stop`.
- `Bus 1—* BusLocation` (GPS trail).
- `User(conductor) 1—* Bus` (assignment).

### 6.3 Seeded data (via `DataSeeder`)
- **Users:** `admin@busgo.ai` (ADMIN), `conductor@busgo.ai` and `syed@busgo.ai` (CONDUCTOR).
- **Stops:** Hebbal `(13.0358, 77.5970)`, Yelahanka `(13.1007, 77.5963)`, Doddaballapura `(13.2924, 77.5430)`.
- **Route:** "Hebbal – Doddaballapura" (fully geocoded, used for GPS/simulation).
- **Buses:** `KA-01-F-1234` (capacity 50), `MH-12-AB-9876` (capacity 45).

### 6.4 How stop coordinates get into the database
The `stops` table stores each stop's fixed `latitude`/`longitude`. Coordinates are written in exactly two ways — **there is no automatic geocoding** (no name-to-coordinate lookup service):
1. **`DataSeeder`** hardcodes lat/lon for the demo stops on startup.
2. **Admin (manual entry):** the Stops → *Add Stop* form has Latitude/Longitude fields; submitting POSTs `{name, latitude, longitude}` to `/api/admin/stops`, which persists a `Stop` row.

Latitude/longitude are **optional** at creation, so a stop may exist without coordinates. Geofencing simply **skips** any stop that has no coordinates (it cannot compute a distance to it), so arrival can only be auto-detected at geocoded stops.

---

## 7. API Reference

### 7.1 REST endpoints (JSON, JWT-secured except where noted)
| Area | Method & Path | Notes |
|---|---|---|
| Auth | `POST /api/auth/login`, `POST /api/auth/register` | Public; returns JWT. |
| Health | `GET /api/health` | Public. |
| Buses | `GET /api/buses` | Public read. |
| Routes | `GET /api/routes` | Public read. |
| Stops | (managed under `/api/admin/stops`) | — |
| Trips | `GET /api/trips/active`, `POST /api/trips`, `POST /api/trips/{id}/end`, `POST /api/trips/{id}/next-stop` | `next-stop` exists but is **not used by the UI** (advancement is automatic). |
| Tickets | `POST /api/tickets/issue` | Validates capacity, increments occupancy, broadcasts. |
| Admin | `GET /api/admin/stats`, `/api/admin/reports`, CRUD for `/buses` `/routes` `/stops` `/conductors`, assign/reorder | `@PreAuthorize("hasRole('ADMIN')")`. |
| ETA / Prediction | `GET /api/eta/...`, `GET /api/predictions/...` | **Deprecated stubs (return null)** — data now travels inside the WebSocket DTO. |

### 7.2 WebSocket (STOMP)
- **Endpoint:** `/ws` (native WebSocket — **no SockJS**).
- **App prefix (client → server):** `/app` → `@MessageMapping("/update_location")` receives `LocationUpdateDto {busId, tripId, latitude, longitude}`.
- **Broker topics (server → clients):** `/topic/bus_{busId}` (a specific bus) and `/topic/bus-updates` (all buses).
- **Payload:** a single **`LiveTripStateDto`** — tripId, busId, routeName, status, currentLat/Lon, current/next stop, maxCapacity, currentOccupancy, availableSeats, crowdLevel, `remainingStopsEta[]`, timestamp.

---

## 8. Core Algorithms, Formulas & Techniques

This section lists every formula and technique the system actually uses, with the real constants from the code.

### 8.1 Haversine great-circle distance (the core geospatial formula)
Every distance in the system — for both geofencing and ETA — comes from the **Haversine formula**, which gives the shortest distance between two latitude/longitude points over the Earth's surface (`ETAService.calculateDistance`).

Given two points `(φ₁, λ₁)` and `(φ₂, λ₂)` in **radians** (latitude φ, longitude λ):

```
Δφ = φ₂ − φ₁
Δλ = λ₂ − λ₁
a  = sin²(Δφ / 2) + cos(φ₁) · cos(φ₂) · sin²(Δλ / 2)
c  = 2 · atan2(√a, √(1 − a))
d  = R · c
```

- **R = 6371 km** (mean Earth radius, hardcoded).
- `d` is the distance in kilometres; the code multiplies by 1000 when it needs metres.
- Input degrees are converted with `Math.toRadians(...)` before the formula.

**Why this technique:** it is accurate for the short city distances involved, needs no external service, and treats the Earth as a sphere (good to well under the 100 m geofence tolerance used here).

### 8.2 Geofencing with dwell time → automatic stop arrival
This is the "how does the bus know it reached a stop?" logic (`LocationService.processLocationUpdate`). On **every** incoming GPS point:

1. Find the trip's **next** stop (the one after `currentStopId` in route order).
2. If that stop has coordinates, compute `distanceMeters = Haversine(bus, nextStop) × 1000`.
3. **Arrival test — two conditions must both hold:**

```
distanceMeters ≤ GEOFENCE_RADIUS        (GEOFENCE_RADIUS = 100 metres)
AND
secondsInsideGeofence ≥ DWELL_SECONDS   (DWELL_SECONDS = 3 seconds)
```

The **dwell requirement** is a hysteresis technique: the bus must *stay* inside the 100 m circle for ≥ 3 s, not merely clip its edge while driving past. The backend records the timestamp when the bus first enters the circle (`geofenceEntryMap`, keyed by bus id); if the bus leaves the circle the timer is reset. When both conditions hold, the stop is declared "reached", the current stop advances, and passengers alight (§8.3). Both constants are configurable (`busgo.geofence.radius`, `busgo.geofence.dwell-seconds`).

### 8.3 Automatic alighting & occupancy update
When a stop is reached (§8.2), the backend updates occupancy without any manual input:

```
alighting  = Σ passengerCount of all ACTIVE tickets whose toStopId == reachedStopId
newOccupancy = max(0, currentOccupancy − alighting)     (floored at 0)
those tickets → status COMPLETED
```

Available seats shown to everyone are then:

```
availableSeats = max(0, maxCapacity − currentOccupancy)
```

**Verified example** (route Hebbal→Yelahanka→Doddaballapura, capacity 50): issue 5→Yelahanka and 3→Doddaballapura → occupancy `0 → 5 → 8`; on reaching Yelahanka the 5 alight (`8 → 3`); on Doddaballapura the 3 alight (`3 → 0`). Available seats mirror this: `50 → 45 → 42 → 47 → 50`.

### 8.4 Capacity check on ticket issue
Before a ticket is created, the backend rejects oversell:

```
reject if (currentOccupancy + requestedPassengers) > maxCapacity
else currentOccupancy += requestedPassengers
```

### 8.5 ETA estimate (heuristic, not ML)
`ETAService.calculateETA` estimates minutes to each upcoming stop by walking the remaining stops in order and accumulating Haversine distance from the bus's current position:

```
totalDistanceKm = Haversine(bus → stop₁) + Haversine(stop₁ → stop₂) + …
etaMinutes(stopₖ) = cumulativeDistanceKm(stopₖ) / SPEED
SPEED = 0.5 km per minute   (i.e. a fixed assumed 30 km/h)
```

- A stop missing coordinates contributes a **1.5 km fallback** so the chain isn't broken.
- Result is rounded up to a minimum of 1 minute when any distance remains.

**This is a heuristic** — a constant assumed speed, no traffic, no history, no learning.

### 8.6 Crowd-level prediction (heuristic, not ML)
`PredictionService.predictCrowdLevel` turns occupancy into a LOW/MEDIUM/HIGH/FULL label using simple rules:

```
rate = currentOccupancy / maxCapacity
rate += 0.2   if hour ∈ [08,10) or [17,19)      (rush-hour bump)
rate −= 0.1   if day is Saturday or Sunday      (weekend easing)
rate  = clamp(rate, 0, 1)

FULL    if rate ≥ 0.9
HIGH    if rate ≥ 0.6
MEDIUM  if rate ≥ 0.3
LOW     otherwise
```

The code comment states outright this is an MVP placeholder for a future historical/ML model.

### 8.7 Admin analytics formulas
Computed live in `AdminService` from real ticket/trip data (flat fare **₹15**):

```
todayRevenue      = 15 × (Σ passengerCount of tickets created today)
averageOccupancy  = mean over active trips of (currentOccupancy × 100 / capacity), rounded to 1 decimal
busiestRoutes     = Σ passengerCount grouped by route name, top 5 descending
busiestStops      = Σ passengerCount for each stop (counted as both origin and destination), top 5 descending
```

### 8.8 Frontend occupancy bar
The conductor/passenger progress bar uses:

```
percent = min(100, round(currentOccupancy / capacity × 100))
```

---

## 9. Security
- **Stateless JWT** authentication (`jjwt`), token subject = user email, role resolved per request as authority `ROLE_<ROLE>`.
- **Spring Security** filter chain: public routes for auth, health, read-only bus/route lookups, WebSocket handshake, and Swagger; **all other endpoints authenticated**; admin endpoints gated by `@PreAuthorize`.
- **Passwords** stored BCrypt-hashed.
- **CORS** restricted to the local dev origins (`localhost:5173–5176`).
- Login also enforces a **role match** (the selected role must equal the account's role).

---

## 10. Project Status

### ✅ Implemented & runtime-verified
- Role-based authentication and route protection (Admin / Conductor / Passenger).
- Conductor trip lifecycle: start → issue tickets → live occupancy → end.
- **Automatic** GPS geofence stop-advancement and automatic alighting (no manual button) — verified end-to-end in the browser and via an automated STOMP test (occupancy 0→5→8→3→0).
- Real-time WebSocket updates via a single `LiveTripStateDto` (no SockJS).
- Passenger live map (moving marker, recenter), occupancy, crowd level, ETA timeline.
- Admin dashboard (live stats), fleet CRUD with guarded deletes, and analytics.
- Registration, and 404 handling.

### ⚠️ Present but heuristic / placeholder
- **ETA** and **crowd prediction** work but are rule-based (not machine-learned).
- `/api/eta` and `/api/predictions` controllers are **deprecated stubs**.
- `OccupancyHistory` and `Prediction` entities/tables exist but are **unused scaffolding** for future ML.

---

## 11. Limitations & Future Work

1. **Machine-learning layer (primary remaining work):** replace the heuristic ETA and crowd prediction with data-driven models trained on historical tickets/trips/locations (time-of-day, day-of-week, route, stop). The scaffolding tables (`OccupancyHistory`, `Prediction`) are intended for this. Should remain **inside the existing Spring Boot backend** and be surfaced through the same `LiveTripStateDto`.
2. **Deployment for real-world GPS:** host over **HTTPS** (browsers block geolocation on non-secure origins) so a conductor's phone can stream real GPS; consider a background-capable mobile/PWA client or a hardware GPS tracker feeding the same `/app/update_location` channel.
3. **Minor cleanups:** add coordinates to a few seed stops (e.g. NES, Rajanukunte) so more routes are simulatable; remove the unused `sockjs-client` dependency and the dead `GET /api/stops` security permit; clear remaining non-blocking lint warnings.

---

## 12. Setup & Credentials

**Run backend** (port 8080, needs PostgreSQL `busgo_dev` on 5432, Java 17):
`cd server-spring && ./mvnw spring-boot:run`

**Run frontend** (port 5173):
`cd client && npm install && npm run dev` → open http://localhost:5173

**Seeded logins:**
| Role | Email | Password |
|---|---|---|
| Admin | `admin@busgo.ai` | `admin123` |
| Conductor | `conductor@busgo.ai` | `conductor123` |
| Conductor | `syed@busgo.ai` | `password` |
| Passenger | *self-register or "Continue as Guest"* | — |

*(On the login screen, select the matching role before signing in.)*

---

## 13. Conclusion

BusGo AI delivers a working, real-time bus-tracking system with automatic GPS-driven stop management, live occupancy, and role-based dashboards on a clean single-app / single-backend architecture. The real-time pipeline, ticketing, geofencing, and administration are complete and verified. The main avenue for future work is upgrading the existing heuristic ETA and crowd-prediction features into a genuine machine-learning prediction layer, for which the data model is already scaffolded.
