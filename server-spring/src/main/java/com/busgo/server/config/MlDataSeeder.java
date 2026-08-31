package com.busgo.server.config;

import com.busgo.server.entity.OccupancySample;
import com.busgo.server.entity.Route;
import com.busgo.server.entity.RouteStop;
import com.busgo.server.entity.Stop;
import com.busgo.server.entity.TravelSample;
import com.busgo.server.repository.OccupancySampleRepository;
import com.busgo.server.repository.RouteRepository;
import com.busgo.server.repository.RouteStopRepository;
import com.busgo.server.repository.TravelSampleRepository;
import com.busgo.server.service.ETAService;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.annotation.Order;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * Cold-start bootstrap: there is no real ridership history on a fresh database,
 * so on first startup (only if the sample tables are empty) this generates
 * <em>realistic synthetic</em> training rows for every route/stop across all
 * hours (0-23) and days (1-7). The synthetic distribution deliberately encodes
 * the patterns the models should learn:
 * <ul>
 *   <li>rush-hour peaks (08-10, 17-19) and quiet nights,</li>
 *   <li>lighter weekend loads,</li>
 *   <li>higher occupancy toward the middle of a route,</li>
 *   <li>slower segment speeds in rush hour -> longer travel times.</li>
 * </ul>
 * Real trips then append genuine rows to the same tables (see TicketService /
 * TripService), so the models improve with actual use. Runs after {@link DataSeeder}.
 */
@Component
@Order(2)
@RequiredArgsConstructor
public class MlDataSeeder implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(MlDataSeeder.class);

    private static final int NOMINAL_CAPACITY = 50; // occupancy labels are absolute passenger counts
    private static final double BASE_FRACTION = 0.42;

    private final RouteRepository routeRepository;
    private final RouteStopRepository routeStopRepository;
    private final OccupancySampleRepository occupancySampleRepository;
    private final TravelSampleRepository travelSampleRepository;
    private final ETAService etaService;

    @Value("${busgo.ml.enabled:true}")
    private boolean mlEnabled;

    @Value("${busgo.ml.synthetic.samples-per-slot:3}")
    private int samplesPerSlot;

    private final Random random = new Random(42); // fixed seed -> reproducible bootstrap

    @Override
    public void run(String... args) {
        if (!mlEnabled) {
            log.info("busgo.ml.enabled=false -> skipping synthetic ML bootstrap.");
            return;
        }
        if (occupancySampleRepository.count() > 0 || travelSampleRepository.count() > 0) {
            log.info("ML sample tables already populated -> skipping synthetic bootstrap.");
            return;
        }

        List<OccupancySample> occBatch = new ArrayList<>();
        List<TravelSample> travBatch = new ArrayList<>();

        for (Route route : routeRepository.findAll()) {
            List<RouteStop> stops = routeStopRepository.findByRouteIdOrderByStopOrderAsc(route.getId());
            if (stops.isEmpty()) continue;
            int total = stops.size();

            for (int hour = 0; hour < 24; hour++) {
                for (int dow = 1; dow <= 7; dow++) {
                    double rush = rushMultiplier(hour);
                    double weekend = weekendFactor(dow);

                    // Occupancy samples (one per stop)
                    for (RouteStop rs : stops) {
                        double pos = positionFactor(rs.getStopOrder(), total);
                        double frac = BASE_FRACTION * rush * weekend * pos;
                        for (int k = 0; k < samplesPerSlot; k++) {
                            double noisy = NOMINAL_CAPACITY * frac + random.nextGaussian() * 3.0;
                            int occ = (int) Math.round(noisy);
                            occ = Math.max(0, Math.min(NOMINAL_CAPACITY, occ));
                            occBatch.add(OccupancySample.builder()
                                    .routeId(route.getId())
                                    .stopId(rs.getStop().getId())
                                    .stopOrder(rs.getStopOrder())
                                    .hourOfDay(hour)
                                    .dayOfWeek(dow)
                                    .occupancy(occ)
                                    .synthetic(true)
                                    .build());
                        }
                    }

                    // Travel samples (one per consecutive geocoded segment)
                    double speedKmh = segmentSpeedKmh(hour);
                    for (int i = 0; i < stops.size() - 1; i++) {
                        Stop from = stops.get(i).getStop();
                        Stop to = stops.get(i + 1).getStop();
                        if (from.getLatitude() == null || from.getLongitude() == null
                                || to.getLatitude() == null || to.getLongitude() == null) {
                            continue; // cannot compute distance -> ETA falls back to heuristic here
                        }
                        double distKm = etaService.calculateDistance(
                                from.getLatitude(), from.getLongitude(),
                                to.getLatitude(), to.getLongitude());
                        for (int k = 0; k < samplesPerSlot; k++) {
                            double seconds = (distKm / speedKmh) * 3600.0 * (1.0 + random.nextGaussian() * 0.08);
                            int secs = (int) Math.max(20, Math.round(seconds));
                            travBatch.add(TravelSample.builder()
                                    .routeId(route.getId())
                                    .fromStopId(from.getId())
                                    .toStopId(to.getId())
                                    .distanceKm(distKm)
                                    .hourOfDay(hour)
                                    .dayOfWeek(dow)
                                    .travelSeconds(secs)
                                    .synthetic(true)
                                    .build());
                        }
                    }
                }
            }
        }

        occupancySampleRepository.saveAll(occBatch);
        travelSampleRepository.saveAll(travBatch);
        log.info("MlDataSeeder inserted {} synthetic occupancy rows and {} synthetic travel rows.",
                occBatch.size(), travBatch.size());
    }

    // --- synthetic pattern helpers ---

    private double rushMultiplier(int hour) {
        if ((hour >= 8 && hour <= 10) || (hour >= 17 && hour <= 19)) return 1.7;   // peak
        if (hour == 7 || hour == 11 || hour == 16 || hour == 20) return 1.25;      // shoulder
        if (hour >= 0 && hour <= 5) return 0.35;                                   // night
        return 0.9;                                                                // off-peak day
    }

    private double weekendFactor(int dayOfWeek) {
        return (dayOfWeek == 6 || dayOfWeek == 7) ? 0.65 : 1.0;
    }

    // Buses fill toward the middle of a route and empty toward the ends.
    private double positionFactor(int stopOrder, int totalStops) {
        if (totalStops <= 1) return 1.0;
        double p = (stopOrder - 1) / (double) (totalStops - 1); // 0..1
        return 0.55 + 0.7 * Math.sin(Math.PI * p);
    }

    // Slower in rush hour, faster at night -> ETA that varies with time of day.
    private double segmentSpeedKmh(int hour) {
        if ((hour >= 8 && hour <= 10) || (hour >= 17 && hour <= 19)) return 16.0;
        if (hour == 7 || hour == 11 || hour == 16 || hour == 20) return 24.0;
        if (hour >= 0 && hour <= 5) return 45.0;
        return 30.0;
    }
}
