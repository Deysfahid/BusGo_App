package com.busgo.server.service;

import com.busgo.server.entity.Bus;
import com.busgo.server.entity.Role;
import com.busgo.server.entity.Stop;
import com.busgo.server.entity.Ticket;
import com.busgo.server.entity.Trip;
import com.busgo.server.entity.User;
import com.busgo.server.exception.ResourceNotFoundException;
import com.busgo.server.repository.BusRepository;
import com.busgo.server.repository.RouteRepository;
import com.busgo.server.repository.RouteStopRepository;
import com.busgo.server.repository.StopRepository;
import com.busgo.server.repository.TicketRepository;
import com.busgo.server.repository.TripRepository;
import com.busgo.server.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class AdminService {

    private final BusRepository busRepository;
    private final RouteRepository routeRepository;
    private final UserRepository userRepository;
    private final TripRepository tripRepository;
    private final TicketRepository ticketRepository;
    private final StopRepository stopRepository;
    private final RouteStopRepository routeStopRepository;

    // The schema has no per-ticket fare, so revenue is derived from real ticket
    // volume using a single flat fare rather than a hard-coded figure.
    private static final double FLAT_FARE = 15.0;

    @Transactional(readOnly = true)
    public Map<String, Object> getDashboardStats() {
        Map<String, Object> stats = new HashMap<>();
        stats.put("totalBuses", busRepository.count());
        stats.put("totalRoutes", routeRepository.count());
        stats.put("totalConductors", userRepository.findAll().stream()
                .filter(u -> u.getRole() == Role.CONDUCTOR).count());

        List<Trip> activeTrips = tripRepository.findByStatus("active");
        stats.put("activeTrips", activeTrips.size());
        stats.put("totalTickets", ticketRepository.count());

        // Today's revenue: flat fare * passengers ticketed today.
        LocalDate today = LocalDate.now();
        int passengersToday = ticketRepository.findAll().stream()
                .filter(t -> t.getCreatedAt() != null && t.getCreatedAt().toLocalDate().isEqual(today))
                .mapToInt(Ticket::getPassengerCount)
                .sum();
        stats.put("todayRevenue", passengersToday * FLAT_FARE);

        // Average occupancy across currently-active trips (% of capacity).
        double avgOccupancy = 0.0;
        int counted = 0;
        double sumPct = 0.0;
        for (Trip t : activeTrips) {
            int cap = (t.getBus() != null && t.getBus().getCapacity() != null) ? t.getBus().getCapacity() : 0;
            if (cap > 0) {
                sumPct += (t.getCurrentOccupancy() * 100.0) / cap;
                counted++;
            }
        }
        if (counted > 0) {
            avgOccupancy = Math.round((sumPct / counted) * 10.0) / 10.0;
        }
        stats.put("averageOccupancy", avgOccupancy);

        return stats;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getAnalyticsReports() {
        Map<String, Object> reports = new HashMap<>();
        List<Ticket> tickets = ticketRepository.findAll();

        // Busiest routes: passengers grouped by the trip's route name.
        Map<String, Integer> routeCounts = new HashMap<>();
        for (Ticket t : tickets) {
            if (t.getTrip() != null && t.getTrip().getRoute() != null) {
                routeCounts.merge(t.getTrip().getRoute().getName(), t.getPassengerCount(), Integer::sum);
            }
        }
        reports.put("busiestRoutes", topN(routeCounts, 5));

        // Busiest stops: passengers boarding/alighting per stop (from + to).
        Map<Long, Integer> stopCounts = new HashMap<>();
        for (Ticket t : tickets) {
            if (t.getFromStopId() != null) stopCounts.merge(t.getFromStopId(), t.getPassengerCount(), Integer::sum);
            if (t.getToStopId() != null) stopCounts.merge(t.getToStopId(), t.getPassengerCount(), Integer::sum);
        }
        Map<String, Integer> stopNameCounts = new HashMap<>();
        for (Map.Entry<Long, Integer> e : stopCounts.entrySet()) {
            String name = stopRepository.findById(e.getKey()).map(Stop::getName).orElse("Stop #" + e.getKey());
            stopNameCounts.merge(name, e.getValue(), Integer::sum);
        }
        reports.put("busiestStops", topN(stopNameCounts, 5));

        return reports;
    }

    // Sort a name->count map descending and keep the top n in insertion order.
    private Map<String, Integer> topN(Map<String, Integer> counts, int n) {
        return counts.entrySet().stream()
                .sorted(Map.Entry.<String, Integer>comparingByValue().reversed())
                .limit(n)
                .collect(Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue,
                        (a, b) -> a, LinkedHashMap::new));
    }

    // --- Guarded deletes ---

    @Transactional
    public void deleteBus(Long busId) {
        Bus bus = busRepository.findById(busId)
                .orElseThrow(() -> new ResourceNotFoundException("Bus not found"));
        if (tripRepository.existsByBusId(busId)) {
            throw new IllegalStateException("Cannot delete a bus that has trip history. Remove its trips first.");
        }
        busRepository.delete(bus);
    }

    @Transactional
    public void deleteStop(Long stopId) {
        Stop stop = stopRepository.findById(stopId)
                .orElseThrow(() -> new ResourceNotFoundException("Stop not found"));
        if (routeStopRepository.existsByStopId(stopId)) {
            throw new IllegalStateException("Cannot delete a stop that is used on a route. Remove it from all routes first.");
        }
        stopRepository.delete(stop);
    }

    @Transactional
    public void deleteConductor(Long conductorId) {
        User user = userRepository.findById(conductorId)
                .orElseThrow(() -> new ResourceNotFoundException("Conductor not found"));
        if (user.getRole() != Role.CONDUCTOR) {
            throw new IllegalStateException("Only conductor accounts can be deleted here.");
        }
        // Unassign from any bus first (the FK lives on the bus side).
        busRepository.findByConductorId(conductorId).ifPresent(b -> {
            b.setConductor(null);
            busRepository.save(b);
        });
        // Preserve issued tickets for history but detach them from the user.
        List<Ticket> issued = ticketRepository.findByIssuedById(conductorId);
        for (Ticket t : issued) {
            t.setIssuedBy(null);
        }
        ticketRepository.saveAll(issued);
        userRepository.delete(user);
    }
}
