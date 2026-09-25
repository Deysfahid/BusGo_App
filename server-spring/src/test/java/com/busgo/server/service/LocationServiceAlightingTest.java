package com.busgo.server.service;

import com.busgo.server.dto.LiveTripStateDto;
import com.busgo.server.entity.Bus;
import com.busgo.server.entity.Route;
import com.busgo.server.entity.RouteStop;
import com.busgo.server.entity.Stop;
import com.busgo.server.entity.Ticket;
import com.busgo.server.entity.Trip;
import com.busgo.server.repository.BusLocationRepository;
import com.busgo.server.repository.RouteStopRepository;
import com.busgo.server.repository.TicketRepository;
import com.busgo.server.repository.TripRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;

/**
 * Verifies the live-state DTO carries the expected-alighting figures and that
 * they follow the existing current/next-stop logic: the count is for the NEXT
 * stop only, changes as the bus advances, and is 0 at the end of the route.
 *
 * <p>LocationService is built by hand with mocked collaborators, so no database
 * or Spring context is needed and nothing in the real data is touched.</p>
 */
class LocationServiceAlightingTest {

    private static final long ROUTE = 100L;
    private static final long STOP_BMS = 10L;
    private static final long STOP_RAJANUKUNTE = 11L;
    private static final long STOP_DODDABALLAPURA = 12L;

    private final List<Ticket> tickets = new ArrayList<>();
    private LocationService locationService;
    private Trip tripA;
    private Trip tripB;

    @BeforeEach
    void setUp() {
        Route route = Route.builder().id(ROUTE).name("285").build();
        List<RouteStop> stops = List.of(
                routeStop(1, STOP_BMS, "BMS", 13.00, 77.50),
                routeStop(2, STOP_RAJANUKUNTE, "Rajanukunte", 13.10, 77.55),
                routeStop(3, STOP_DODDABALLAPURA, "Doddaballapura", 13.29, 77.54));

        tripA = Trip.builder().id(1L).status("active")
                .bus(Bus.builder().id(1L).busNumber("285A").capacity(50).build())
                .route(route).currentStopId(STOP_BMS).currentOccupancy(50).build();
        tripB = Trip.builder().id(2L).status("active")
                .bus(Bus.builder().id(2L).busNumber("285B").capacity(50).build())
                .route(route).currentStopId(STOP_BMS).currentOccupancy(48).build();

        RouteStopRepository routeStopRepository = Mockito.mock(RouteStopRepository.class);
        when(routeStopRepository.findByRouteIdOrderByStopOrderAsc(ROUTE)).thenReturn(stops);

        TicketRepository ticketRepository = Mockito.mock(TicketRepository.class);
        when(ticketRepository.findByTripIdAndToStopIdAndStatus(anyLong(), anyLong(), any()))
                .thenAnswer(inv -> tickets.stream()
                        .filter(t -> t.getTrip().getId().equals(inv.getArgument(0)))
                        .filter(t -> t.getToStopId().equals(inv.getArgument(1)))
                        .filter(t -> t.getStatus().equals(inv.getArgument(2)))
                        .toList());

        BusLocationRepository busLocationRepository = Mockito.mock(BusLocationRepository.class);
        when(busLocationRepository.findTopByTripIdOrderByTimestampDesc(anyLong())).thenReturn(Optional.empty());

        ETAService etaService = Mockito.mock(ETAService.class);
        when(etaService.calculateETA(anyLong(), any(), Mockito.anyDouble(), Mockito.anyDouble(), any()))
                .thenReturn(new ArrayList<>());
        PredictionService predictionService = Mockito.mock(PredictionService.class);
        when(predictionService.predictCrowdLevel(any(), Mockito.anyInt(), Mockito.anyInt())).thenReturn("FULL");

        locationService = new LocationService(
                Mockito.mock(TripService.class),
                etaService,
                predictionService,
                routeStopRepository,
                Mockito.mock(TripRepository.class),
                busLocationRepository,
                new AlightingService(ticketRepository));
    }

    private static RouteStop routeStop(int order, long id, String name, double lat, double lon) {
        return RouteStop.builder().stopOrder(order)
                .stop(Stop.builder().id(id).name(name).latitude(lat).longitude(lon).build())
                .build();
    }

    private void ticket(Trip trip, long toStopId, int passengers, String status) {
        tickets.add(Ticket.builder().trip(trip).fromStopId(STOP_BMS).toStopId(toStopId)
                .passengerCount(passengers).status(status).build());
    }

    @Test
    void fullBus_reportsPassengersGettingDownAtNextStop_withoutChangingOccupancy() {
        for (int i = 0; i < 8; i++) ticket(tripA, STOP_RAJANUKUNTE, 1, "ACTIVE");
        for (int i = 0; i < 42; i++) ticket(tripA, STOP_DODDABALLAPURA, 1, "ACTIVE");

        LiveTripStateDto dto = locationService.getCurrentState(tripA);

        assertEquals(STOP_RAJANUKUNTE, dto.getNextStopId());
        assertEquals("Rajanukunte", dto.getNextStopName());
        assertEquals(50, dto.getCurrentOccupancy());   // still FULL - nobody has got off yet
        assertEquals(0, dto.getAvailableSeats());
        assertEquals(8, dto.getExpectedPassengersGettingDownAtNextStop());
        assertEquals(8, dto.getExpectedAvailableSeatsAfterNextStop());
    }

    @Test
    void noPassengersGettingDown_isZero_andExpectedSeatsEqualCurrent() {
        ticket(tripA, STOP_DODDABALLAPURA, 50, "ACTIVE");

        LiveTripStateDto dto = locationService.getCurrentState(tripA);

        assertEquals(0, dto.getExpectedPassengersGettingDownAtNextStop());
        assertEquals(dto.getAvailableSeats(), dto.getExpectedAvailableSeatsAfterNextStop());
    }

    @Test
    void twoBusesOnSameRoute_reportIndependentCounts() {
        for (int i = 0; i < 8; i++) ticket(tripA, STOP_RAJANUKUNTE, 1, "ACTIVE");
        ticket(tripB, STOP_RAJANUKUNTE, 1, "ACTIVE");

        LiveTripStateDto a = locationService.getCurrentState(tripA);
        LiveTripStateDto b = locationService.getCurrentState(tripB);

        assertEquals(8, a.getExpectedPassengersGettingDownAtNextStop());
        assertEquals(8, a.getExpectedAvailableSeatsAfterNextStop());   // 0 free + 8
        assertEquals(1, b.getExpectedPassengersGettingDownAtNextStop());
        assertEquals(3, b.getExpectedAvailableSeatsAfterNextStop());   // 2 free + 1
    }

    @Test
    void countFollowsTheNextStop_asTheTripAdvances() {
        ticket(tripA, STOP_RAJANUKUNTE, 8, "ACTIVE");
        ticket(tripA, STOP_DODDABALLAPURA, 5, "ACTIVE");

        // At BMS: next is Rajanukunte
        assertEquals(8, locationService.getCurrentState(tripA).getExpectedPassengersGettingDownAtNextStop());

        // The existing arrival logic moves the bus and completes the Rajanukunte tickets
        tripA.setCurrentStopId(STOP_RAJANUKUNTE);
        tripA.setCurrentOccupancy(42);
        tickets.stream().filter(t -> t.getToStopId() == STOP_RAJANUKUNTE).forEach(t -> t.setStatus("COMPLETED"));

        LiveTripStateDto atRajanukunte = locationService.getCurrentState(tripA);
        assertEquals(STOP_DODDABALLAPURA, atRajanukunte.getNextStopId());
        assertEquals(5, atRajanukunte.getExpectedPassengersGettingDownAtNextStop()); // never the previous stop's 8
        assertEquals(8 + 5, atRajanukunte.getExpectedAvailableSeatsAfterNextStop());

        // At the final stop there is no next stop
        tripA.setCurrentStopId(STOP_DODDABALLAPURA);
        LiveTripStateDto atEnd = locationService.getCurrentState(tripA);
        assertNull(atEnd.getNextStopId());
        assertEquals(0, atEnd.getExpectedPassengersGettingDownAtNextStop());
        assertEquals(atEnd.getAvailableSeats(), atEnd.getExpectedAvailableSeatsAfterNextStop());
    }

    @Test
    void completedTrip_reportsZero() {
        ticket(tripA, STOP_RAJANUKUNTE, 8, "ACTIVE");
        tripA.setStatus("completed");

        assertEquals(0, locationService.getCurrentState(tripA).getExpectedPassengersGettingDownAtNextStop());
    }

    @Test
    void existingFieldsAreUnchanged() {
        ticket(tripA, STOP_RAJANUKUNTE, 8, "ACTIVE");
        LiveTripStateDto dto = locationService.getCurrentState(tripA);

        assertEquals(1L, dto.getTripId());
        assertEquals("285A", dto.getBusNumber());
        assertEquals(ROUTE, dto.getRouteId());
        assertEquals(STOP_BMS, dto.getCurrentStopId());
        assertEquals(50, dto.getMaxCapacity());
        assertEquals("FULL", dto.getCrowdLevel());
        assertNull(dto.getTimestamp()); // never reported GPS - must not be "now"
    }
}
