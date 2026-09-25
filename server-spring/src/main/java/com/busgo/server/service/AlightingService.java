package com.busgo.server.service;

import com.busgo.server.entity.Ticket;
import com.busgo.server.repository.TicketRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Answers "how many passengers will get off this bus at its next stop?" from
 * the tickets already on board - never from a prediction.
 *
 * <p>Uses exactly the query {@link TripService#nextStop} uses to alight
 * passengers ({@code trip + toStop + ACTIVE}), and sums {@code passengerCount}
 * the same way, so the number shown to a waiting passenger is the number that
 * will actually leave the occupancy when the geofence fires. Once those tickets
 * are marked COMPLETED by the existing arrival logic they drop out of the query
 * automatically, so nothing is ever double-counted.</p>
 */
@Service
@RequiredArgsConstructor
public class AlightingService {

    private final TicketRepository ticketRepository;

    /**
     * Passengers on ACTIVE tickets for {@code tripId} whose destination is {@code stopId}.
     * Returns 0 when there is no such stop (end of route) or no matching tickets.
     */
    public int countPassengersAlightingAt(Long tripId, Long stopId) {
        if (tripId == null || stopId == null) {
            return 0;
        }
        List<Ticket> tickets = ticketRepository.findByTripIdAndToStopIdAndStatus(tripId, stopId, "ACTIVE");
        return sumPassengers(tickets);
    }

    /** Sum of {@code passengerCount} across tickets; a null count is one passenger, as when issued. */
    static int sumPassengers(List<Ticket> tickets) {
        if (tickets == null) {
            return 0;
        }
        int total = 0;
        for (Ticket t : tickets) {
            total += t.getPassengerCount() != null ? t.getPassengerCount() : 1;
        }
        return total;
    }

    /**
     * Seats a boarding passenger can expect once the alighting passengers have
     * left: current free seats plus those getting down, never above capacity.
     * This is an expectation about the future - current occupancy is untouched.
     */
    public static int expectedSeatsAfter(int availableSeatsNow, int alighting, int capacity) {
        int expected = Math.max(0, availableSeatsNow) + Math.max(0, alighting);
        return Math.min(Math.max(0, capacity), expected);
    }
}
