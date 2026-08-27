package com.busgo.server.service;

import com.busgo.server.dto.LiveTripStateDto.StopEtaDto;
import com.busgo.server.entity.RouteStop;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

@Service
public class ETAService {

    // 30 km/h = 0.5 km/min
    private static final double DEFAULT_SPEED_KM_PER_MIN = 0.5;

    /**
     * Calculates the ETA in minutes for all remaining stops from the current GPS location.
     */
    public List<StopEtaDto> calculateETA(double currentLat, double currentLon, List<RouteStop> remainingStops) {
        List<StopEtaDto> etas = new ArrayList<>();
        
        double lastLat = currentLat;
        double lastLon = currentLon;
        double totalDistanceKm = 0.0;

        for (RouteStop rs : remainingStops) {
            if (rs.getStop().getLatitude() == null || rs.getStop().getLongitude() == null) {
                totalDistanceKm += 1.5; // fallback
            } else {
                totalDistanceKm += calculateDistance(lastLat, lastLon, rs.getStop().getLatitude(), rs.getStop().getLongitude());
                lastLat = rs.getStop().getLatitude();
                lastLon = rs.getStop().getLongitude();
            }

            int etaMinutes = (int) (totalDistanceKm / DEFAULT_SPEED_KM_PER_MIN);
            if (etaMinutes == 0 && totalDistanceKm > 0) etaMinutes = 1;

            etas.add(StopEtaDto.builder()
                    .stopId(rs.getStop().getId())
                    .stopName(rs.getStop().getName())
                    .estimatedMinutes(etaMinutes)
                    .build());
        }

        return etas;
    }

    public double calculateDistance(double lat1, double lon1, double lat2, double lon2) {
        final int R = 6371; // Radius of the earth in km
        double latDistance = Math.toRadians(lat2 - lat1);
        double lonDistance = Math.toRadians(lon2 - lon1);
        double a = Math.sin(latDistance / 2) * Math.sin(latDistance / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(lonDistance / 2) * Math.sin(lonDistance / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }
}
