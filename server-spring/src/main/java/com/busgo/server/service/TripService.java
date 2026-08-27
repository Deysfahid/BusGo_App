package com.busgo.server.service;

import com.busgo.server.entity.RouteStop;
import com.busgo.server.entity.Ticket;
import com.busgo.server.entity.Trip;
import com.busgo.server.repository.RouteStopRepository;
import com.busgo.server.repository.TicketRepository;
import com.busgo.server.repository.TripRepository;
import com.busgo.server.repository.BusRepository;
import com.busgo.server.repository.RouteRepository;
import com.busgo.server.exception.ResourceNotFoundException;
import lombok.RequiredArgsConstructor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
public class TripService {

    private final TripRepository tripRepository;
    private final TicketRepository ticketRepository;
    private final RouteStopRepository routeStopRepository;
    private final BusRepository busRepository;
    private final RouteRepository routeRepository;
    private final SimpMessagingTemplate messagingTemplate;
    
    @org.springframework.context.annotation.Lazy
    @org.springframework.beans.factory.annotation.Autowired
    private LocationService locationService;

    public List<Trip> getAllTrips() {
        return tripRepository.findAll();
    }

    public List<Trip> getActiveTrips() {
        return tripRepository.findByStatus("active");
    }

    public Trip getTripById(Long tripId) {
        return tripRepository.findById(tripId)
                .orElseThrow(() -> new ResourceNotFoundException("Trip not found"));
    }

    @Transactional
    public Trip createTrip(Long busId, Long routeId) {
        com.busgo.server.entity.Bus bus = busRepository.findById(busId)
                .orElseThrow(() -> new ResourceNotFoundException("Bus not found"));
        com.busgo.server.entity.Route route = routeRepository.findById(routeId)
                .orElseThrow(() -> new ResourceNotFoundException("Route not found"));
        
        Trip trip = Trip.builder()
                .bus(bus)
                .route(route)
                .status("active")
                .startTime(LocalDateTime.now())
                .currentOccupancy(0)
                .revenue(0.0)
                .build();
                
        List<RouteStop> stops = routeStopRepository.findByRouteIdOrderByStopOrderAsc(route.getId());
        if (!stops.isEmpty()) {
            trip.setCurrentStopId(stops.get(0).getStop().getId());
        }
        
        Trip savedTrip = tripRepository.save(trip);
        broadcastTripUpdate(savedTrip);
        return savedTrip;
    }

    @Transactional
    public Trip startTrip(Long tripId) {
        Trip trip = getTripById(tripId);
        trip.setStatus("active");
        trip.setStartTime(LocalDateTime.now());
        
        // Find the first stop of the route
        List<RouteStop> stops = routeStopRepository.findByRouteIdOrderByStopOrderAsc(trip.getRoute().getId());
        if (!stops.isEmpty()) {
            trip.setCurrentStopId(stops.get(0).getStop().getId());
        }
        
        Trip savedTrip = tripRepository.save(trip);
        broadcastTripUpdate(savedTrip);
        return savedTrip;
    }

    @Transactional
    public Trip endTrip(Long tripId) {
        Trip trip = getTripById(tripId);
        trip.setStatus("completed");
        trip.setEndTime(LocalDateTime.now());
        trip.setCurrentOccupancy(0);
        
        // Complete any active tickets
        List<Ticket> activeTickets = ticketRepository.findByTripId(tripId).stream()
                .filter(t -> "ACTIVE".equals(t.getStatus()))
                .toList();
        for (Ticket ticket : activeTickets) {
            ticket.setStatus("COMPLETED");
        }
        ticketRepository.saveAll(activeTickets);
        
        Trip savedTrip = tripRepository.save(trip);
        broadcastTripUpdate(savedTrip);
        return savedTrip;
    }

    @Transactional
    public Trip nextStop(Long tripId) {
        Trip trip = getTripById(tripId);
        if (!"active".equals(trip.getStatus())) {
            throw new IllegalStateException("Trip is not active");
        }

        List<RouteStop> stops = routeStopRepository.findByRouteIdOrderByStopOrderAsc(trip.getRoute().getId());
        if (stops.isEmpty()) {
            return trip;
        }

        // Find current stop index
        int currentIndex = -1;
        for (int i = 0; i < stops.size(); i++) {
            if (trip.getCurrentStopId() != null && stops.get(i).getStop().getId().equals(trip.getCurrentStopId())) {
                currentIndex = i;
                break;
            }
        }

        if (currentIndex != -1 && currentIndex < stops.size() - 1) {
            // Move to next stop
            Long nextStopId = stops.get(currentIndex + 1).getStop().getId();
            trip.setCurrentStopId(nextStopId);

            // Auto-decrement passengers whose destination is this next stop
            List<Ticket> alightingTickets = ticketRepository.findByTripIdAndToStopIdAndStatus(trip.getId(), nextStopId, "ACTIVE");
            
            int alightingCount = 0;
            for (Ticket ticket : alightingTickets) {
                alightingCount += ticket.getPassengerCount();
                ticket.setStatus("COMPLETED");
            }
            ticketRepository.saveAll(alightingTickets);

            // Update occupancy
            int newOccupancy = trip.getCurrentOccupancy() - alightingCount;
            if (newOccupancy < 0) newOccupancy = 0;
            trip.setCurrentOccupancy(newOccupancy);
        }

        Trip savedTrip = tripRepository.save(trip);
        broadcastTripUpdate(savedTrip);
        return savedTrip;
    }

    public void broadcastTripUpdate(Trip trip) {
        // Broadcast the updated trip state to WebSocket topic
        com.busgo.server.dto.LiveTripStateDto dto = locationService.getCurrentState(trip);
        messagingTemplate.convertAndSend("/topic/bus_" + trip.getBus().getId(), dto);
        messagingTemplate.convertAndSend("/topic/bus-updates", dto);
    }
}

