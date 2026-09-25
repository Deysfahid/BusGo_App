package com.busgo.server.service;

import com.busgo.server.entity.Ticket;
import com.busgo.server.entity.Trip;
import com.busgo.server.repository.TicketRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit tests for the "passengers getting down at the next stop" count.
 * The repository is stubbed with an in-memory ticket table so that the
 * trip / destination / status filtering the real query performs is exercised.
 */
class AlightingServiceTest {

    private static final long TRIP_A = 1L;
    private static final long TRIP_B = 2L;
    private static final long STOP_BMS = 10L;
    private static final long STOP_RAJANUKUNTE = 11L;
    private static final long STOP_DODDABALLAPURA = 12L;

    private final List<Ticket> table = new ArrayList<>();
    private TicketRepository repo;
    private AlightingService service;

    @BeforeEach
    void setUp() {
        repo = Mockito.mock(TicketRepository.class);
        when(repo.findByTripIdAndToStopIdAndStatus(anyLong(), anyLong(), any()))
                .thenAnswer(inv -> {
                    Long tripId = inv.getArgument(0);
                    Long toStopId = inv.getArgument(1);
                    String status = inv.getArgument(2);
                    return table.stream()
                            .filter(t -> t.getTrip().getId().equals(tripId))
                            .filter(t -> t.getToStopId().equals(toStopId))
                            .filter(t -> t.getStatus().equals(status))
                            .toList();
                });
        service = new AlightingService(repo);
    }

    private void ticket(long tripId, long toStopId, int passengers, String status) {
        table.add(Ticket.builder()
                .trip(Trip.builder().id(tripId).build())
                .fromStopId(STOP_BMS)
                .toStopId(toStopId)
                .passengerCount(passengers)
                .status(status)
                .build());
    }

    @Test
    void noActiveTickets_isZero() {
        assertEquals(0, service.countPassengersAlightingAt(TRIP_A, STOP_RAJANUKUNTE));
    }

    @Test
    void onePassengerGettingDown() {
        ticket(TRIP_A, STOP_RAJANUKUNTE, 1, "ACTIVE");
        assertEquals(1, service.countPassengersAlightingAt(TRIP_A, STOP_RAJANUKUNTE));
    }

    @Test
    void multiplePassengers_sumsPassengerCountAcrossTickets() {
        // 8 passengers on 5 tickets - matches what TripService.nextStop will decrement
        ticket(TRIP_A, STOP_RAJANUKUNTE, 1, "ACTIVE");
        ticket(TRIP_A, STOP_RAJANUKUNTE, 2, "ACTIVE");
        ticket(TRIP_A, STOP_RAJANUKUNTE, 1, "ACTIVE");
        ticket(TRIP_A, STOP_RAJANUKUNTE, 3, "ACTIVE");
        ticket(TRIP_A, STOP_RAJANUKUNTE, 1, "ACTIVE");
        assertEquals(8, service.countPassengersAlightingAt(TRIP_A, STOP_RAJANUKUNTE));
    }

    @Test
    void laterDestinations_areNotCountedForNextStop() {
        ticket(TRIP_A, STOP_RAJANUKUNTE, 2, "ACTIVE");
        ticket(TRIP_A, STOP_DODDABALLAPURA, 5, "ACTIVE"); // going further - stays on
        assertEquals(2, service.countPassengersAlightingAt(TRIP_A, STOP_RAJANUKUNTE));
    }

    @Test
    void completedTickets_areExcluded() {
        ticket(TRIP_A, STOP_RAJANUKUNTE, 4, "COMPLETED"); // already got off earlier
        ticket(TRIP_A, STOP_RAJANUKUNTE, 1, "ACTIVE");
        assertEquals(1, service.countPassengersAlightingAt(TRIP_A, STOP_RAJANUKUNTE));
    }

    @Test
    void cancelledOrUnknownStatus_isExcluded() {
        ticket(TRIP_A, STOP_RAJANUKUNTE, 3, "CANCELLED");
        assertEquals(0, service.countPassengersAlightingAt(TRIP_A, STOP_RAJANUKUNTE));
    }

    @Test
    void multipleBuses_eachCountsOnlyItsOwnTrip() {
        ticket(TRIP_A, STOP_RAJANUKUNTE, 8, "ACTIVE");
        ticket(TRIP_B, STOP_RAJANUKUNTE, 1, "ACTIVE");
        assertEquals(8, service.countPassengersAlightingAt(TRIP_A, STOP_RAJANUKUNTE));
        assertEquals(1, service.countPassengersAlightingAt(TRIP_B, STOP_RAJANUKUNTE));
    }

    @Test
    void noNextStop_isZeroWithoutQuerying() {
        ticket(TRIP_A, STOP_RAJANUKUNTE, 8, "ACTIVE");
        assertEquals(0, service.countPassengersAlightingAt(TRIP_A, null));
        verify(repo, never()).findByTripIdAndToStopIdAndStatus(anyLong(), anyLong(), any());
    }

    @Test
    void nullPassengerCount_countsAsOne() {
        table.add(Ticket.builder()
                .trip(Trip.builder().id(TRIP_A).build())
                .fromStopId(STOP_BMS).toStopId(STOP_RAJANUKUNTE)
                .passengerCount(null).status("ACTIVE").build());
        assertEquals(1, service.countPassengersAlightingAt(TRIP_A, STOP_RAJANUKUNTE));
    }

    @Test
    void expectedSeatsAfter_addsAlightingToFreeSeats() {
        assertEquals(8, AlightingService.expectedSeatsAfter(0, 8, 50));   // FULL now, 8 expected
        assertEquals(3, AlightingService.expectedSeatsAfter(2, 1, 50));
        assertEquals(15, AlightingService.expectedSeatsAfter(15, 0, 50)); // nobody getting down
    }

    @Test
    void expectedSeatsAfter_neverExceedsCapacity() {
        assertEquals(50, AlightingService.expectedSeatsAfter(45, 10, 50));
        assertEquals(0, AlightingService.expectedSeatsAfter(-3, 0, 50));
    }
}
