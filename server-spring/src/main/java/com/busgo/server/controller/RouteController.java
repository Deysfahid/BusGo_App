package com.busgo.server.controller;

import com.busgo.server.dto.ApiResponse;
import com.busgo.server.dto.LiveTripStateDto;
import com.busgo.server.dto.RouteDetailDto;
import com.busgo.server.dto.RouteSummaryDto;
import com.busgo.server.entity.Route;
import com.busgo.server.entity.RouteStop;
import com.busgo.server.entity.Trip;
import com.busgo.server.exception.ResourceNotFoundException;
import com.busgo.server.repository.RouteRepository;
import com.busgo.server.repository.TripRepository;
import com.busgo.server.service.LocationService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

@RestController
@RequestMapping("/api/routes")
@RequiredArgsConstructor
public class RouteController {

    private final RouteRepository routeRepository;
    private final TripRepository tripRepository;
    private final LocationService locationService;

    @GetMapping
    public ResponseEntity<ApiResponse<List<Route>>> getAllRoutes() {
        return ResponseEntity.ok(ApiResponse.success(routeRepository.findAll()));
    }

    /**
     * Lightweight route search for the passenger/conductor autocomplete: id + name
     * only, capped, so the browser never downloads the whole network. A blank query
     * returns nothing rather than every route. Public GET, like the other reads here.
     */
    @GetMapping("/search")
    public ResponseEntity<ApiResponse<List<RouteSummaryDto>>> searchRoutes(
            @RequestParam(name = "q", required = false) String q,
            @RequestParam(name = "limit", defaultValue = "20") int limit) {
        String query = q == null ? "" : q.trim();
        if (query.isEmpty()) {
            return ResponseEntity.ok(ApiResponse.success(List.of()));
        }
        int capped = Math.max(1, Math.min(limit, 50));
        return ResponseEntity.ok(ApiResponse.success(
                routeRepository.searchByName(query, PageRequest.of(0, capped))));
    }

    /**
     * A single route with its ordered stops - the STATIC view a passenger sees on
     * selecting a route, whether or not any bus is currently live. Live buses come
     * separately from {@code /active-buses} and the {@code /topic/route_*} stream.
     */
    @GetMapping("/{routeId}")
    @Transactional(readOnly = true)
    public ResponseEntity<ApiResponse<RouteDetailDto>> getRoute(@PathVariable Long routeId) {
        Route route = routeRepository.findByIdWithStops(routeId)
                .orElseThrow(() -> new ResourceNotFoundException("Route not found"));
        List<RouteStop> ordered = new ArrayList<>(
                route.getRouteStops() != null ? route.getRouteStops() : List.of());
        ordered.sort(Comparator.comparing(
                RouteStop::getStopOrder, Comparator.nullsLast(Comparator.naturalOrder())));
        List<RouteDetailDto.StopDto> stops = new ArrayList<>(ordered.size());
        for (RouteStop rs : ordered) {
            stops.add(RouteDetailDto.StopDto.builder()
                    .id(rs.getStop().getId())
                    .name(rs.getStop().getName())
                    .stopOrder(rs.getStopOrder())
                    .lat(rs.getStop().getLatitude())
                    .lon(rs.getStop().getLongitude())
                    .build());
        }
        return ResponseEntity.ok(ApiResponse.success(RouteDetailDto.builder()
                .id(route.getId())
                .name(route.getName())
                .stops(stops)
                .build()));
    }

    /**
     * Every bus currently running this route, with its latest known position,
     * current stop, occupancy and ETA - the snapshot a passenger loads when they
     * search a route, before live updates start arriving over STOMP.
     *
     * <p>Only trips whose status is "active" are returned; completed trips are
     * excluded. Readable by guests, matching the existing public GET rules for
     * {@code /api/routes/**}.</p>
     */
    @GetMapping("/{routeId}/active-buses")
    @Transactional(readOnly = true)
    public ResponseEntity<ApiResponse<List<LiveTripStateDto>>> getActiveBuses(@PathVariable Long routeId) {
        List<Trip> trips = tripRepository.findByRouteIdAndStatusWithBusAndRoute(routeId, "active");
        List<LiveTripStateDto> live = new ArrayList<>(trips.size());
        for (Trip trip : trips) {
            live.add(locationService.getCurrentState(trip));
        }
        return ResponseEntity.ok(ApiResponse.success(live));
    }
}
