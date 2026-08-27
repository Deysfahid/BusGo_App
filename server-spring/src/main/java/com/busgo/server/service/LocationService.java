package com.busgo.server.service;

import com.busgo.server.dto.LiveTripStateDto;
import com.busgo.server.entity.RouteStop;
import com.busgo.server.entity.Trip;
import com.busgo.server.repository.RouteStopRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Service
@RequiredArgsConstructor
public class LocationService {

    private final TripService tripService;
    private final ETAService etaService;
    private final PredictionService predictionService;
    private final RouteStopRepository routeStopRepository;

    @Value("${busgo.geofence.radius:100}")
    private double geofenceRadiusMeters;

    @Value("${busgo.geofence.dwell-seconds:3}")
    private long geofenceDwellSeconds;

    // Track when a bus first entered the geofence of its *next* stop
    // Map of BusID -> EntryTime
    private final Map<Long, Instant> geofenceEntryMap = new ConcurrentHashMap<>();

    // Track latest known location per TripId
    private final Map<Long, double[]> latestLocations = new ConcurrentHashMap<>();

    public LiveTripStateDto processLocationUpdate(Trip trip, double lat, double lon) {
        // Cache latest location for this trip
        latestLocations.put(trip.getId(), new double[]{lat, lon});

        List<RouteStop> stops = routeStopRepository.findByRouteIdOrderByStopOrderAsc(trip.getRoute().getId());
        
        int currentIndex = -1;
        for (int i = 0; i < stops.size(); i++) {
            if (trip.getCurrentStopId() != null && stops.get(i).getStop().getId().equals(trip.getCurrentStopId())) {
                currentIndex = i;
                break;
            }
        }

        RouteStop currentRouteStop = (currentIndex != -1) ? stops.get(currentIndex) : null;
        RouteStop nextRouteStop = null;
        
        if (currentIndex != -1 && currentIndex < stops.size() - 1) {
            nextRouteStop = stops.get(currentIndex + 1);
        } else if (currentIndex == -1 && !stops.isEmpty()) {
            // Bus hasn't reached first stop yet, or currentStopId is null
            nextRouteStop = stops.get(0);
        }

        // Hysteresis / Geofencing logic
        if (nextRouteStop != null && nextRouteStop.getStop().getLatitude() != null && nextRouteStop.getStop().getLongitude() != null) {
            double distanceKm = etaService.calculateDistance(
                    lat, lon, 
                    nextRouteStop.getStop().getLatitude(), 
                    nextRouteStop.getStop().getLongitude()
            );
            
            double distanceMeters = distanceKm * 1000.0;
            
            if (distanceMeters <= geofenceRadiusMeters) {
                Instant entryTime = geofenceEntryMap.get(trip.getBus().getId());
                if (entryTime == null) {
                    geofenceEntryMap.put(trip.getBus().getId(), Instant.now());
                } else {
                    long secondsInGeofence = ChronoUnit.SECONDS.between(entryTime, Instant.now());
                    if (secondsInGeofence >= geofenceDwellSeconds) {
                        // Stop reached! Trigger nextStop
                        trip = tripService.nextStop(trip.getId()); // this updates trip object in DB
                        geofenceEntryMap.remove(trip.getBus().getId());
                        
                        // Update our references since we moved forward
                        currentIndex++;
                        currentRouteStop = nextRouteStop;
                        nextRouteStop = (currentIndex < stops.size() - 1) ? stops.get(currentIndex + 1) : null;
                    }
                }
            } else {
                // Bus is outside geofence, reset dwell timer
                geofenceEntryMap.remove(trip.getBus().getId());
            }
        }

        return buildDto(trip, lat, lon, stops, currentIndex, currentRouteStop, nextRouteStop);
    }

    public LiveTripStateDto getCurrentState(Trip trip) {
        double[] loc = latestLocations.getOrDefault(trip.getId(), new double[]{0.0, 0.0});
        double lat = loc[0];
        double lon = loc[1];

        List<RouteStop> stops = routeStopRepository.findByRouteIdOrderByStopOrderAsc(trip.getRoute().getId());
        
        int currentIndex = -1;
        for (int i = 0; i < stops.size(); i++) {
            if (trip.getCurrentStopId() != null && stops.get(i).getStop().getId().equals(trip.getCurrentStopId())) {
                currentIndex = i;
                break;
            }
        }

        RouteStop currentRouteStop = (currentIndex != -1) ? stops.get(currentIndex) : null;
        RouteStop nextRouteStop = null;
        
        if (currentIndex != -1 && currentIndex < stops.size() - 1) {
            nextRouteStop = stops.get(currentIndex + 1);
        } else if (currentIndex == -1 && !stops.isEmpty()) {
            nextRouteStop = stops.get(0);
        }

        return buildDto(trip, lat, lon, stops, currentIndex, currentRouteStop, nextRouteStop);
    }

    private LiveTripStateDto buildDto(Trip trip, double lat, double lon, List<RouteStop> stops, int currentIndex, RouteStop currentRouteStop, RouteStop nextRouteStop) {
        // Prepare remaining stops for ETA calculation
        List<RouteStop> remainingStops = stops;
        if (currentIndex != -1) {
            remainingStops = stops.subList(currentIndex + 1, stops.size());
        }
        
        List<LiveTripStateDto.StopEtaDto> etas = etaService.calculateETA(lat, lon, remainingStops);
        
        int maxCap = trip.getBus().getCapacity();
        int availSeats = Math.max(0, maxCap - trip.getCurrentOccupancy());
        String crowdLvl = predictionService.predictCrowdLevel(trip, availSeats, maxCap);

        return LiveTripStateDto.builder()
                .tripId(trip.getId())
                .busId(trip.getBus().getId())
                .routeName(trip.getRoute().getName())
                .status(trip.getStatus())
                .currentLat(lat)
                .currentLon(lon)
                .currentStopId(currentRouteStop != null ? currentRouteStop.getStop().getId() : null)
                .currentStopName(currentRouteStop != null ? currentRouteStop.getStop().getName() : null)
                .nextStopId(nextRouteStop != null ? nextRouteStop.getStop().getId() : null)
                .nextStopName(nextRouteStop != null ? nextRouteStop.getStop().getName() : null)
                .maxCapacity(maxCap)
                .currentOccupancy(trip.getCurrentOccupancy())
                .availableSeats(availSeats)
                .crowdLevel(crowdLvl)
                .remainingStopsEta(etas)
                .timestamp(System.currentTimeMillis())
                .build();
    }
}
