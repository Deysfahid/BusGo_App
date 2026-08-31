package com.busgo.server.service;

import com.busgo.server.dto.LiveTripStateDto.StopEtaDto;
import com.busgo.server.entity.RouteStop;
import com.busgo.server.service.ml.EtaModel;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Service
@RequiredArgsConstructor
public class ETAService {

    // 30 km/h = 0.5 km/min (heuristic fallback speed, used when the model is cold)
    private static final double DEFAULT_SPEED_KM_PER_MIN = 0.5;

    private final EtaModel etaModel;

    /**
     * Calculates the ETA in minutes for all remaining stops from the current GPS location.
     *
     * <p>Phase 8: when the segment-travel-time model is trained, each segment's
     * duration comes from the model (learned per route/segment/time-of-day);
     * otherwise it falls back to the fixed-speed heuristic. The cumulative
     * per-stop minutes are returned exactly as before, so consumers are unchanged.</p>
     *
     * @param routeId        the trip's route (model feature)
     * @param fromStopId     the last reached stop id (segment origin; may be null before the first stop)
     * @param currentLat     current GPS latitude
     * @param currentLon     current GPS longitude
     * @param remainingStops upcoming stops in order
     */
    public List<StopEtaDto> calculateETA(long routeId, Long fromStopId,
                                         double currentLat, double currentLon,
                                         List<RouteStop> remainingStops) {
        List<StopEtaDto> etas = new ArrayList<>();

        double lastLat = currentLat;
        double lastLon = currentLon;
        double cumulativeMinutes = 0.0;

        LocalDateTime now = LocalDateTime.now();
        int hour = now.getHour();
        int dow = now.getDayOfWeek().getValue();

        Long segFrom = fromStopId;

        for (RouteStop rs : remainingStops) {
            double segKm;
            boolean haveCoords = rs.getStop().getLatitude() != null && rs.getStop().getLongitude() != null;
            if (!haveCoords) {
                segKm = 1.5; // fallback distance so the chain isn't broken
            } else {
                segKm = calculateDistance(lastLat, lastLon, rs.getStop().getLatitude(), rs.getStop().getLongitude());
                lastLat = rs.getStop().getLatitude();
                lastLon = rs.getStop().getLongitude();
            }

            double segMinutes;
            double predSeconds = (segFrom != null && haveCoords)
                    ? etaModel.predictSeconds(routeId, segFrom, rs.getStop().getId(), segKm, hour, dow)
                    : Double.NaN;
            if (!Double.isNaN(predSeconds) && predSeconds > 0) {
                segMinutes = predSeconds / 60.0;               // learned segment time
            } else {
                segMinutes = segKm / DEFAULT_SPEED_KM_PER_MIN; // heuristic fallback
            }

            cumulativeMinutes += segMinutes;
            int etaMinutes = (int) Math.round(cumulativeMinutes);
            if (etaMinutes == 0 && cumulativeMinutes > 0) etaMinutes = 1;

            etas.add(StopEtaDto.builder()
                    .stopId(rs.getStop().getId())
                    .stopName(rs.getStop().getName())
                    .estimatedMinutes(etaMinutes)
                    .build());

            segFrom = rs.getStop().getId();
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
