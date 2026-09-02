package com.busgo.server.service;

import com.busgo.server.dto.LiveTripStateDto;
import com.busgo.server.entity.BusLocation;
import com.busgo.server.entity.RouteStop;
import com.busgo.server.entity.Trip;
import com.busgo.server.entity.User;
import com.busgo.server.repository.BusLocationRepository;
import com.busgo.server.repository.RouteStopRepository;
import com.busgo.server.repository.TripRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
@RequiredArgsConstructor
public class LocationService {

    private static final Logger log = LoggerFactory.getLogger(LocationService.class);

    private final TripService tripService;
    private final ETAService etaService;
    private final PredictionService predictionService;
    private final RouteStopRepository routeStopRepository;
    private final TripRepository tripRepository;
    private final BusLocationRepository busLocationRepository;

    @Value("${busgo.geofence.radius:100}")
    private double geofenceRadiusMeters;

    @Value("${busgo.geofence.dwell-seconds:3}")
    private long geofenceDwellSeconds;

    /**
     * Fixes less accurate than this (metres) still move the map marker but are
     * not trusted to change the current stop - a 500 m accuracy circle can sit
     * "inside" a 100 m geofence while the bus is nowhere near the stop.
     */
    @Value("${busgo.geofence.max-accuracy-meters:250}")
    private double maxAccuracyMeters;

    /** Which stop a bus is currently dwelling at, and since when. Keyed by bus id. */
    private record GeofenceEntry(Long stopId, Instant since) {}

    private final Map<Long, GeofenceEntry> geofenceEntryMap = new ConcurrentHashMap<>();

    /** Latest known position per trip id: {lat, lon}. */
    private final Map<Long, double[]> latestLocations = new ConcurrentHashMap<>();

    /**
     * Transactional entry point for a GPS ping arriving on the STOMP endpoint.
     *
     * <p>The trip is loaded with its bus and route eagerly fetched, and the whole
     * persist / geofence / advance chain runs in one transaction, so the geofence
     * logic can safely walk {@code trip.getBus()} and {@code trip.getRoute()} even
     * though WebSocket handlers get no Open-Session-In-View.</p>
     *
     * @param senderEmail the authenticated publisher; only the conductor assigned
     *                    to this bus (or an admin) may move it
     * @return the enriched live state, or {@code null} when the update is rejected
     */
    @Transactional
    public LiveTripStateDto handleLocationUpdate(Long tripId, double lat, double lon,
                                                 Double accuracy, String senderEmail, boolean senderIsAdmin) {
        Trip trip = tripRepository.findByIdWithBusAndRoute(tripId).orElse(null);
        if (trip == null) {
            log.warn("[GPS] Ignoring location update: trip {} not found", tripId);
            return null;
        }
        if (!isAllowedToPublish(trip, senderEmail, senderIsAdmin)) {
            log.warn("[GPS] REJECTED location for trip {} from '{}' - not the conductor of bus {}",
                    tripId, senderEmail, trip.getBus().getId());
            return null;
        }
        if (!"active".equals(trip.getStatus())) {
            log.info("[GPS] Ignoring location update: trip {} is '{}', not active", tripId, trip.getStatus());
            return null;
        }

        busLocationRepository.save(BusLocation.builder()
                .trip(trip)
                .latitude(lat)
                .longitude(lon)
                .timestamp(LocalDateTime.now())
                .build());

        return processLocationUpdate(trip, lat, lon, accuracy);
    }

    /**
     * A bus may only be moved by the conductor it is assigned to, or by an admin.
     * Buses with no conductor assigned yet stay open to any authenticated staff
     * user, so existing fleets keep working until assignments are made.
     */
    private boolean isAllowedToPublish(Trip trip, String senderEmail, boolean senderIsAdmin) {
        if (senderEmail == null) {
            return false;
        }
        if (senderIsAdmin) {
            return true;
        }
        User conductor = trip.getBus().getConductor();
        if (conductor == null) {
            return true; // unassigned bus - any authenticated conductor may drive it
        }
        return senderEmail.equalsIgnoreCase(conductor.getEmail());
    }

    /**
     * Forget any dwell timer / cached position held for a bus or trip, so a stale
     * entry from a previous trip cannot instantly satisfy the dwell check.
     */
    public void clearGeofenceState(Long busId, Long tripId) {
        if (busId != null) {
            geofenceEntryMap.remove(busId);
        }
        if (tripId != null) {
            latestLocations.remove(tripId);
        }
    }

    public LiveTripStateDto processLocationUpdate(Trip trip, double lat, double lon) {
        return processLocationUpdate(trip, lat, lon, null);
    }

    public LiveTripStateDto processLocationUpdate(Trip trip, double lat, double lon, Double accuracy) {
        latestLocations.put(trip.getId(), new double[]{lat, lon});

        List<RouteStop> stops = routeStopRepository.findByRouteIdOrderByStopOrderAsc(trip.getRoute().getId());
        int currentIndex = indexOfCurrentStop(trip, stops);
        Long busId = trip.getBus().getId();

        boolean accurateEnough = accuracy == null || accuracy <= maxAccuracyMeters;
        if (!accurateEnough) {
            log.info("[GEOFENCE] trip={} bus={} fix accuracy {}m worse than {}m - position broadcast, stop detection skipped",
                    trip.getId(), busId, Math.round(accuracy), Math.round(maxAccuracyMeters));
            geofenceEntryMap.remove(busId);
        } else {
            trip = detectArrival(trip, stops, currentIndex, lat, lon, busId);
            currentIndex = indexOfCurrentStop(trip, stops);
        }

        return buildDto(trip, lat, lon, stops, currentIndex, true);
    }

    /**
     * Decides whether the bus has arrived at a stop, and advances the trip if so.
     *
     * <p>Unlike a strict "is it at stop N+1" check, this looks at every stop still
     * ahead on the route and picks the nearest one inside the geofence. That way a
     * conductor whose GPS was off for a stretch, or who joined the route part-way,
     * converges on their real position instead of staying pinned to an earlier stop.
     * The dwell timer is keyed to the candidate stop, so drifting between two stops
     * restarts it rather than falsely confirming an arrival.</p>
     */
    private Trip detectArrival(Trip trip, List<RouteStop> stops, int currentIndex,
                               double lat, double lon, Long busId) {
        RouteStop nearest = null;
        double nearestMeters = Double.MAX_VALUE;

        for (int i = currentIndex + 1; i < stops.size(); i++) {
            RouteStop rs = stops.get(i);
            if (rs.getStop().getLatitude() == null || rs.getStop().getLongitude() == null) {
                continue;
            }
            double meters = etaService.calculateDistance(
                    lat, lon, rs.getStop().getLatitude(), rs.getStop().getLongitude()) * 1000.0;
            if (meters < nearestMeters) {
                nearestMeters = meters;
                nearest = rs;
            }
        }

        if (nearest == null) {
            log.info("[GEOFENCE] trip={} bus={} no upcoming stop with coordinates (currentStopId={})",
                    trip.getId(), busId, trip.getCurrentStopId());
            geofenceEntryMap.remove(busId);
            return trip;
        }

        log.info("[GEOFENCE] trip={} bus={} pos=({}, {}) nearestUpcoming='{}' distance={}m radius={}m",
                trip.getId(), busId, lat, lon, nearest.getStop().getName(),
                Math.round(nearestMeters), Math.round(geofenceRadiusMeters));

        if (nearestMeters > geofenceRadiusMeters) {
            if (geofenceEntryMap.remove(busId) != null) {
                log.info("[GEOFENCE] trip={} bus={} left the geofence before dwell elapsed - timer reset",
                        trip.getId(), busId);
            }
            return trip;
        }

        Long candidateStopId = nearest.getStop().getId();
        GeofenceEntry entry = geofenceEntryMap.get(busId);

        if (entry == null || !candidateStopId.equals(entry.stopId())) {
            geofenceEntryMap.put(busId, new GeofenceEntry(candidateStopId, Instant.now()));
            log.info("[GEOFENCE] ENTERED geofence of '{}' (trip={} bus={}) - dwell timer started, need {}s",
                    nearest.getStop().getName(), trip.getId(), busId, geofenceDwellSeconds);
            return trip;
        }

        long dwelt = ChronoUnit.SECONDS.between(entry.since(), Instant.now());
        log.info("[GEOFENCE] dwelling at '{}' for {}s of {}s required (trip={} bus={})",
                nearest.getStop().getName(), dwelt, geofenceDwellSeconds, trip.getId(), busId);
        if (dwelt < geofenceDwellSeconds) {
            return trip;
        }

        log.info("[GEOFENCE] DWELL COMPLETE at '{}' - advancing trip {}",
                nearest.getStop().getName(), trip.getId());
        geofenceEntryMap.remove(busId);

        // Advance one stop at a time so every intermediate stop still processes its
        // own alighting passengers exactly once, even when several were missed.
        int guard = stops.size() + 1;
        while (guard-- > 0 && !candidateStopId.equals(trip.getCurrentStopId())) {
            Trip advanced = tripService.nextStop(trip.getId());
            if (advanced.getCurrentStopId() != null
                    && advanced.getCurrentStopId().equals(trip.getCurrentStopId())) {
                break; // already at the last stop; nothing more to do
            }
            trip = advanced;
        }
        return trip;
    }

    private int indexOfCurrentStop(Trip trip, List<RouteStop> stops) {
        for (int i = 0; i < stops.size(); i++) {
            if (trip.getCurrentStopId() != null
                    && stops.get(i).getStop().getId().equals(trip.getCurrentStopId())) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Current live state without a new GPS fix. Falls back to the last position
     * stored in the database when nothing is cached in memory, so a passenger
     * opening the app - or the app restarting - still shows the bus.
     */
    public LiveTripStateDto getCurrentState(Trip trip) {
        double[] loc = latestLocations.get(trip.getId());
        if (loc == null) {
            loc = busLocationRepository.findTopByTripIdOrderByTimestampDesc(trip.getId())
                    .map(bl -> new double[]{bl.getLatitude(), bl.getLongitude()})
                    .orElse(null);
        }
        List<RouteStop> stops = routeStopRepository.findByRouteIdOrderByStopOrderAsc(trip.getRoute().getId());
        int currentIndex = indexOfCurrentStop(trip, stops);

        if (loc != null) {
            return buildDto(trip, loc[0], loc[1], stops, currentIndex, true);
        }

        // No GPS has ever arrived for this trip. Report an unknown position rather
        // than (0, 0) - which would drop the map marker in the Atlantic - and use
        // the trip's current stop as the ETA origin so the timeline stays sane.
        RouteStop origin = currentIndex >= 0 ? stops.get(currentIndex)
                : (stops.isEmpty() ? null : stops.get(0));
        double lat = (origin != null && origin.getStop().getLatitude() != null)
                ? origin.getStop().getLatitude() : 0.0;
        double lon = (origin != null && origin.getStop().getLongitude() != null)
                ? origin.getStop().getLongitude() : 0.0;
        return buildDto(trip, lat, lon, stops, currentIndex, false);
    }

    /** Loads a trip and returns its live state; used by the REST live-state endpoint. */
    @Transactional(readOnly = true)
    public LiveTripStateDto getCurrentStateByTripId(Long tripId) {
        return tripRepository.findByIdWithBusAndRoute(tripId)
                .map(this::getCurrentState)
                .orElse(null);
    }

    private LiveTripStateDto buildDto(Trip trip, double lat, double lon,
                                      List<RouteStop> stops, int currentIndex, boolean hasPosition) {
        RouteStop currentRouteStop = (currentIndex != -1) ? stops.get(currentIndex) : null;
        RouteStop nextRouteStop = null;
        if (currentIndex < stops.size() - 1) {
            nextRouteStop = stops.get(currentIndex + 1);
        }

        List<RouteStop> remainingStops = stops.subList(currentIndex + 1, stops.size());

        long routeId = trip.getRoute().getId();
        Long currentStopId = currentRouteStop != null ? currentRouteStop.getStop().getId() : null;
        List<LiveTripStateDto.StopEtaDto> etas =
                etaService.calculateETA(routeId, currentStopId, lat, lon, remainingStops);

        int maxCap = trip.getBus().getCapacity();
        int availSeats = Math.max(0, maxCap - trip.getCurrentOccupancy());
        String crowdLvl = predictionService.predictCrowdLevel(trip, availSeats, maxCap);

        // Phase 8: attach ML-predicted occupancy to each upcoming stop, and derive
        // a forward-looking crowd level for the next stop. Falls back gracefully
        // (null predictions / live crowd label) when the model is not yet trained.
        LocalDateTime now = LocalDateTime.now();
        int hour = now.getHour();
        int dow = now.getDayOfWeek().getValue();
        Integer nextStopPredOcc = null;
        for (int i = 0; i < etas.size(); i++) {
            RouteStop rs = remainingStops.get(i);
            Integer predOcc = predictionService.predictOccupancy(
                    routeId, rs.getStop().getId(), rs.getStopOrder(), hour, dow, maxCap);
            etas.get(i).setPredictedOccupancy(predOcc);
            if (i == 0) {
                nextStopPredOcc = predOcc;
            }
        }
        boolean modelActive = predictionService.isModelActive();
        String predictedCrowd = (nextStopPredOcc != null)
                ? predictionService.crowdLevelFromOccupancy(nextStopPredOcc, maxCap)
                : crowdLvl;

        return LiveTripStateDto.builder()
                .tripId(trip.getId())
                .busId(trip.getBus().getId())
                .busNumber(trip.getBus().getBusNumber())
                .routeName(trip.getRoute().getName())
                .status(trip.getStatus())
                .currentLat(hasPosition ? lat : null)
                .currentLon(hasPosition ? lon : null)
                .currentStopId(currentStopId)
                .currentStopName(currentRouteStop != null ? currentRouteStop.getStop().getName() : null)
                .nextStopId(nextRouteStop != null ? nextRouteStop.getStop().getId() : null)
                .nextStopName(nextRouteStop != null ? nextRouteStop.getStop().getName() : null)
                .maxCapacity(maxCap)
                .currentOccupancy(trip.getCurrentOccupancy())
                .availableSeats(availSeats)
                .crowdLevel(crowdLvl)
                .predictedCrowdLevel(predictedCrowd)
                .modelActive(modelActive)
                .remainingStopsEta(etas)
                .timestamp(System.currentTimeMillis())
                .build();
    }
}
