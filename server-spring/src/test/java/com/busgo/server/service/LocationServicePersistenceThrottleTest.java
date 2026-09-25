package com.busgo.server.service;

import com.busgo.server.dto.LiveTripStateDto;
import com.busgo.server.entity.Bus;
import com.busgo.server.entity.BusLocation;
import com.busgo.server.entity.Route;
import com.busgo.server.entity.RouteStop;
import com.busgo.server.entity.Stop;
import com.busgo.server.entity.Trip;
import com.busgo.server.repository.BusLocationRepository;
import com.busgo.server.repository.RouteStopRepository;
import com.busgo.server.repository.TripRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * R1: verifies that database persistence of GPS pings is throttled to at most once
 * per 15 s per trip, while GPS PROCESSING (the returned live state) still happens on
 * every ping. Everything is driven through the real {@code handleLocationUpdate} entry
 * point with mocked collaborators, so no database or Spring context is needed.
 */
class LocationServicePersistenceThrottleTest {

    private static final long ROUTE = 100L;
    private static final long TRIP_A = 1L;
    private static final long TRIP_B = 2L;

    private BusLocationRepository busLocationRepository;
    private TripRepository tripRepository;
    private LocationService locationService;

    @BeforeEach
    void setUp() {
        Route route = Route.builder().id(ROUTE).name("285").build();
        List<RouteStop> stops = List.of(
                routeStop(1, 10L, "BMS", 13.00, 77.50),
                routeStop(2, 11L, "Rajanukunte", 13.10, 77.55));

        RouteStopRepository routeStopRepository = Mockito.mock(RouteStopRepository.class);
        when(routeStopRepository.findByRouteIdOrderByStopOrderAsc(ROUTE)).thenReturn(stops);

        tripRepository = Mockito.mock(TripRepository.class);
        when(tripRepository.findByIdWithBusAndRoute(TRIP_A)).thenAnswer(inv -> Optional.of(trip(TRIP_A)));
        when(tripRepository.findByIdWithBusAndRoute(TRIP_B)).thenAnswer(inv -> Optional.of(trip(TRIP_B)));

        busLocationRepository = Mockito.mock(BusLocationRepository.class);
        // Default: no rows yet -> first ping of a trip must persist.
        when(busLocationRepository.findTopByTripIdOrderByTimestampDesc(anyLong())).thenReturn(Optional.empty());

        ETAService etaService = Mockito.mock(ETAService.class);
        when(etaService.calculateETA(anyLong(), any(), Mockito.anyDouble(), Mockito.anyDouble(), any()))
                .thenReturn(List.of());
        // Keep the bus far from every stop so no geofence advance is attempted here.
        when(etaService.calculateDistance(Mockito.anyDouble(), Mockito.anyDouble(),
                Mockito.anyDouble(), Mockito.anyDouble())).thenReturn(999.0);

        PredictionService predictionService = Mockito.mock(PredictionService.class);
        when(predictionService.predictCrowdLevel(any(), Mockito.anyInt(), Mockito.anyInt())).thenReturn("LOW");
        when(predictionService.isModelActive()).thenReturn(false);

        AlightingService alightingService = Mockito.mock(AlightingService.class);
        when(alightingService.countPassengersAlightingAt(anyLong(), any())).thenReturn(0);

        locationService = new LocationService(
                Mockito.mock(TripService.class),
                etaService,
                predictionService,
                routeStopRepository,
                tripRepository,
                busLocationRepository,
                alightingService);
    }

    private static RouteStop routeStop(int order, long id, String name, double lat, double lon) {
        return RouteStop.builder().stopOrder(order)
                .stop(Stop.builder().id(id).name(name).latitude(lat).longitude(lon).build())
                .build();
    }

    private static Trip trip(long id) {
        return Trip.builder().id(id).status("active")
                .bus(Bus.builder().id(id).busNumber("BUS-" + id).capacity(50).build())
                .route(Route.builder().id(ROUTE).name("285").build())
                .currentStopId(10L).currentOccupancy(0).build();
    }

    private LiveTripStateDto ping(long tripId) {
        return locationService.handleLocationUpdate(tripId, 13.05, 77.52, 10.0, "admin@busgo.ai", true);
    }

    @Test
    void firstUpdateIsAlwaysPersisted() {
        LiveTripStateDto dto = ping(TRIP_A);
        assertNotNull(dto, "processing must still return a live state");
        verify(busLocationRepository, times(1)).save(any(BusLocation.class));
    }

    @Test
    void updatesWithin15SecondsAreNotPersisted_butAreStillProcessed() {
        for (int i = 0; i < 10; i++) {
            LiveTripStateDto dto = ping(TRIP_A);
            assertNotNull(dto, "every ping must be processed and broadcast, even when not persisted");
        }
        // Only the first of ten back-to-back pings is written.
        verify(busLocationRepository, times(1)).save(any(BusLocation.class));
    }

    @Test
    void differentTripsThrottleIndependently() {
        ping(TRIP_A);   // A: first -> persist
        ping(TRIP_A);   // A: within window -> skip
        ping(TRIP_B);   // B: first -> persist (independent of A)
        ping(TRIP_B);   // B: within window -> skip
        // One save each, never A's window suppressing B.
        verify(busLocationRepository, times(2)).save(any(BusLocation.class));
    }

    @Test
    void afterRestart_recentDbTimestampSuppressesWrite() {
        // In-memory map is empty (as after a restart); the newest stored row is 2 s old.
        when(busLocationRepository.findTopByTripIdOrderByTimestampDesc(TRIP_A))
                .thenReturn(Optional.of(BusLocation.builder()
                        .timestamp(LocalDateTime.now().minusSeconds(2)).build()));

        LiveTripStateDto dto = ping(TRIP_A);

        assertNotNull(dto);
        verify(busLocationRepository, never()).save(any(BusLocation.class));
    }

    @Test
    void afterRestart_oldDbTimestampAllowsWrite() {
        // Newest stored row is 30 s old -> the first ping after restart persists.
        when(busLocationRepository.findTopByTripIdOrderByTimestampDesc(TRIP_A))
                .thenReturn(Optional.of(BusLocation.builder()
                        .timestamp(LocalDateTime.now().minusSeconds(30)).build()));

        ping(TRIP_A);

        verify(busLocationRepository, times(1)).save(any(BusLocation.class));
    }

    @Test
    void concurrentPingsForOneTrip_persistExactlyOnce() throws InterruptedException {
        int threads = 24;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch start = new CountDownLatch(1);
        CountDownLatch done = new CountDownLatch(threads);
        for (int i = 0; i < threads; i++) {
            pool.submit(() -> {
                try {
                    start.await();
                    ping(TRIP_A);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                } finally {
                    done.countDown();
                }
            });
        }
        start.countDown();
        assertTrue(done.await(10, TimeUnit.SECONDS), "all pings finished");
        pool.shutdown();
        // A race would double-write; the per-trip compute() must serialise to one.
        verify(busLocationRepository, times(1)).save(any(BusLocation.class));
    }

    @Test
    void endingTripClearsThrottleState_soANewTripCanPersistImmediately() {
        ping(TRIP_A);                       // persists
        locationService.clearGeofenceState(TRIP_A, TRIP_A); // trip end clears per-trip state
        ping(TRIP_A);                       // fresh again -> persists
        verify(busLocationRepository, times(2)).save(any(BusLocation.class));
    }
}
