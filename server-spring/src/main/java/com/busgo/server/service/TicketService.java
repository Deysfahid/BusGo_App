package com.busgo.server.service;

import com.busgo.server.dto.IssueTicketRequest;
import com.busgo.server.entity.OccupancySample;
import com.busgo.server.entity.RouteStop;
import com.busgo.server.entity.Ticket;
import com.busgo.server.entity.Trip;
import com.busgo.server.repository.OccupancySampleRepository;
import com.busgo.server.repository.RouteStopRepository;
import com.busgo.server.repository.TicketRepository;
import com.busgo.server.repository.TripRepository;
import com.busgo.server.exception.ResourceNotFoundException;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
public class TicketService {

    private final TicketRepository ticketRepository;
    private final TripRepository tripRepository;
    private final TripService tripService;
    private final OccupancySampleRepository occupancySampleRepository;
    private final RouteStopRepository routeStopRepository;

    public List<Ticket> getTicketsByTripId(Long tripId) {
        return ticketRepository.findByTripId(tripId);
    }

    @Transactional
    public Ticket issueTicket(IssueTicketRequest request) {
        Trip trip = tripRepository.findById(request.getTripId())
                .orElseThrow(() -> new ResourceNotFoundException("Trip not found"));

        if (!"active".equals(trip.getStatus())) {
            throw new IllegalStateException("Cannot issue ticket for an inactive trip");
        }

        int passengerCount = request.getPassengerCount() != null ? request.getPassengerCount() : 1;
        int maxCapacity = trip.getBus().getCapacity();
        int currentOccupancy = trip.getCurrentOccupancy();
        
        if (currentOccupancy + passengerCount > maxCapacity) {
            int available = Math.max(0, maxCapacity - currentOccupancy);
            throw new IllegalStateException("Cannot issue ticket. Only " + available + " seats are available.");
        }

        Ticket ticket = Ticket.builder()
                .trip(trip)
                .fromStopId(request.getFromStopId())
                .toStopId(request.getToStopId())
                .passengerCount(passengerCount)
                .status("ACTIVE")
                .build();

        Ticket savedTicket = ticketRepository.save(ticket);

        // Update Trip Occupancy
        int newOccupancy = trip.getCurrentOccupancy() + savedTicket.getPassengerCount();
        trip.setCurrentOccupancy(newOccupancy);
        tripRepository.save(trip);

        // Phase 8: capture a real occupancy training row at the current stop.
        recordOccupancySample(trip);

        // Broadcast occupancy update
        tripService.broadcastTripUpdate(trip);

        return savedTicket;
    }

    /**
     * Appends one real (non-synthetic) occupancy sample for the trip's current
     * stop/time. Best-effort: any failure here must never break ticket issuing.
     */
    private void recordOccupancySample(Trip trip) {
        try {
            Long stopId = trip.getCurrentStopId();
            if (stopId == null) return;
            Long routeId = trip.getRoute().getId();
            int stopOrder = routeStopRepository.findByRouteIdAndStopId(routeId, stopId)
                    .map(RouteStop::getStopOrder).orElse(0);
            LocalDateTime now = LocalDateTime.now();
            occupancySampleRepository.save(OccupancySample.builder()
                    .routeId(routeId)
                    .stopId(stopId)
                    .stopOrder(stopOrder)
                    .hourOfDay(now.getHour())
                    .dayOfWeek(now.getDayOfWeek().getValue())
                    .occupancy(trip.getCurrentOccupancy())
                    .synthetic(false)
                    .build());
        } catch (Exception ignored) {
            // non-fatal: ticketing continues even if sampling fails
        }
    }
}

