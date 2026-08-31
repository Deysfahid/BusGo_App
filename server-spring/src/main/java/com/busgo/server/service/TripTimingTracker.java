package com.busgo.server.service;

import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Tracks the wall-clock time a trip arrived at its current stop, so that when
 * the bus reaches the <em>next</em> stop we can measure the real segment travel
 * time and record it as a {@code TravelSample}. Mirrors the in-memory
 * {@code geofenceEntryMap} pattern already used in {@link LocationService}.
 *
 * <p>Keyed by tripId. The first stop of a trip only seeds the timer (no segment
 * completed yet).</p>
 */
@Component
public class TripTimingTracker {

    private final Map<Long, Instant> lastArrival = new ConcurrentHashMap<>();

    /** Record that {@code tripId} just arrived somewhere; returns the previous
     *  arrival instant (null if this is the trip's first recorded arrival). */
    public Instant markArrival(Long tripId, Instant when) {
        return lastArrival.put(tripId, when);
    }

    public void clear(Long tripId) {
        lastArrival.remove(tripId);
    }
}
