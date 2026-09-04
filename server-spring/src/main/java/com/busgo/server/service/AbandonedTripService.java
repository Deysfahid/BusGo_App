package com.busgo.server.service;

import com.busgo.server.entity.BusLocation;
import com.busgo.server.entity.Trip;
import com.busgo.server.repository.BusLocationRepository;
import com.busgo.server.repository.TripRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;

/**
 * Finds active trips that have stopped reporting GPS — a conductor who closed
 * the browser, lost the phone, or went out of coverage without pressing END.
 *
 * <p><b>Reporting is always on; ending is opt-in.</b> By default this only logs
 * what it finds, so nothing is ended behind your back. Set
 * {@code busgo.trip.auto-end.enabled=true} to let it close them.</p>
 *
 * <p>The threshold is deliberately hours, not minutes: a bus in a tunnel, a
 * phone that briefly loses signal, or a conductor on a break must never have
 * their trip closed underneath them. A trip is only a candidate when its newest
 * stored position is older than {@code busgo.trip.abandoned-after-hours} — and a
 * trip that has never reported at all is judged on when it started instead.</p>
 */
@Service
@RequiredArgsConstructor
public class AbandonedTripService {

    private static final Logger log = LoggerFactory.getLogger(AbandonedTripService.class);

    private final TripRepository tripRepository;
    private final BusLocationRepository busLocationRepository;
    private final TripService tripService;

    /** Master switch. Off by default: report only, never end. */
    @Value("${busgo.trip.auto-end.enabled:false}")
    private boolean autoEndEnabled;

    /** How long a trip must be silent before it counts as abandoned. */
    @Value("${busgo.trip.abandoned-after-hours:6}")
    private long abandonedAfterHours;

    /** How often to look. Hourly by default - this is housekeeping, not tracking. */
    @Scheduled(fixedDelayString = "${busgo.trip.sweep-interval-ms:3600000}",
               initialDelayString = "${busgo.trip.sweep-interval-ms:3600000}")
    public void sweep() {
        List<Trip> active = tripRepository.findByStatus("active");
        if (active.isEmpty()) {
            return;
        }

        LocalDateTime cutoff = LocalDateTime.now().minusHours(abandonedAfterHours);
        int abandoned = 0;
        int ended = 0;

        for (Trip trip : active) {
            LocalDateTime lastSeen = busLocationRepository
                    .findTopByTripIdOrderByTimestampDesc(trip.getId())
                    .map(BusLocation::getTimestamp)
                    .orElse(trip.getStartTime());   // never reported: judge by start time

            if (lastSeen == null || !lastSeen.isBefore(cutoff)) {
                continue;   // still reporting, or too recent to judge
            }

            abandoned++;
            long hours = Duration.between(lastSeen, LocalDateTime.now()).toHours();

            if (!autoEndEnabled) {
                log.warn("[TRIP-SWEEP] Trip {} (bus {}) has had no GPS for {}h - looks abandoned. "
                                + "Auto-end is disabled; end it from the admin Live Fleet panel, "
                                + "or set busgo.trip.auto-end.enabled=true.",
                        trip.getId(), trip.getBus().getId(), hours);
                continue;
            }

            try {
                // Same path as the conductor's END button: tickets completed,
                // occupancy reset, state broadcast.
                tripService.endTrip(trip.getId());
                ended++;
                log.warn("[TRIP-SWEEP] Auto-ended trip {} (bus {}) after {}h without GPS.",
                        trip.getId(), trip.getBus().getId(), hours);
            } catch (Exception e) {
                log.error("[TRIP-SWEEP] Could not end trip {}: {}", trip.getId(), e.getMessage());
            }
        }

        if (abandoned > 0) {
            log.info("[TRIP-SWEEP] {} active trip(s), {} look abandoned (>{}h without GPS), {} ended.",
                    active.size(), abandoned, abandonedAfterHours, ended);
        }
    }

    /** Exposed so the sweep can be triggered in tests without waiting an hour. */
    @Transactional
    public void sweepNow() {
        sweep();
    }
}
