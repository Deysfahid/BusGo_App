package com.busgo.server.controller;

import com.busgo.server.dto.ApiResponse;
import com.busgo.server.dto.LiveTripStateDto;
import com.busgo.server.entity.Route;
import com.busgo.server.entity.Trip;
import com.busgo.server.repository.RouteRepository;
import com.busgo.server.repository.TripRepository;
import com.busgo.server.service.LocationService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
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
