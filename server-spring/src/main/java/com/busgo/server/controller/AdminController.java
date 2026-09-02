package com.busgo.server.controller;

import com.busgo.server.dto.ApiResponse;
import com.busgo.server.dto.OsmStopDto;
import com.busgo.server.entity.Bus;
import com.busgo.server.entity.Role;
import com.busgo.server.entity.Route;
import com.busgo.server.entity.RouteStop;
import com.busgo.server.entity.Stop;
import com.busgo.server.entity.User;
import com.busgo.server.repository.BusRepository;
import com.busgo.server.repository.RouteRepository;
import com.busgo.server.repository.RouteStopRepository;
import com.busgo.server.repository.StopRepository;
import com.busgo.server.repository.UserRepository;
import com.busgo.server.service.AdminService;
import com.busgo.server.service.OsmStopImportService;
import com.busgo.server.exception.ResourceNotFoundException;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/admin")
@PreAuthorize("hasRole('ADMIN')")
@RequiredArgsConstructor
public class AdminController {

    private final AdminService adminService;
    private final BusRepository busRepository;
    private final RouteRepository routeRepository;
    private final RouteStopRepository routeStopRepository;
    private final StopRepository stopRepository;
    private final UserRepository userRepository;
    private final OsmStopImportService osmStopImportService;

    // --- DASHBOARD STATS ---
    @GetMapping("/stats")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getDashboardStats() {
        return ResponseEntity.ok(ApiResponse.success(adminService.getDashboardStats()));
    }

    @GetMapping("/reports")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getAnalyticsReports() {
        return ResponseEntity.ok(ApiResponse.success(adminService.getAnalyticsReports()));
    }

    // --- PHASE 8: ML PREDICTIONS SUMMARY ---
    @GetMapping("/predictions/summary")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getPredictionsSummary() {
        return ResponseEntity.ok(ApiResponse.success(adminService.getPredictionsSummary()));
    }

    // --- BUSES CRUD ---
    @GetMapping("/buses")
    public ResponseEntity<ApiResponse<List<Bus>>> getAllBuses() {
        return ResponseEntity.ok(ApiResponse.success(busRepository.findAll()));
    }

    @PostMapping("/buses")
    public ResponseEntity<ApiResponse<Bus>> createBus(@RequestBody Bus bus) {
        return ResponseEntity.ok(ApiResponse.success(busRepository.save(bus)));
    }

    // --- ROUTES CRUD ---
    @GetMapping("/routes")
    public ResponseEntity<ApiResponse<List<Route>>> getAllRoutes() {
        return ResponseEntity.ok(ApiResponse.success(routeRepository.findAll()));
    }

    @PostMapping("/routes")
    public ResponseEntity<ApiResponse<Route>> createRoute(@RequestBody Route route) {
        return ResponseEntity.ok(ApiResponse.success(routeRepository.save(route)));
    }

    @PostMapping("/routes/{routeId}/stops")
    public ResponseEntity<ApiResponse<RouteStop>> addStopToRoute(
            @PathVariable Long routeId,
            @RequestBody Map<String, Long> body) {
        Long stopId = body.get("stopId");
        Integer order = body.containsKey("stopOrder") ? body.get("stopOrder").intValue() : null;
        Route route = routeRepository.findById(routeId)
                .orElseThrow(() -> new ResourceNotFoundException("Route not found"));
        Stop stop = stopRepository.findById(stopId)
                .orElseThrow(() -> new ResourceNotFoundException("Stop not found"));
        if (order == null) {
            int count = routeStopRepository.findByRouteIdOrderByStopOrderAsc(routeId).size();
            order = count + 1;
        }
        RouteStop rs = RouteStop.builder().route(route).stop(stop).stopOrder(order).build();
        return ResponseEntity.ok(ApiResponse.success(routeStopRepository.save(rs)));
    }

    @DeleteMapping("/routes/{routeId}/stops/{stopId}")
    public ResponseEntity<ApiResponse<String>> removeStopFromRoute(
            @PathVariable Long routeId, @PathVariable Long stopId) {
        routeStopRepository.findByRouteIdAndStopId(routeId, stopId)
                .ifPresent(routeStopRepository::delete);
        // Re-number remaining stops sequentially
        List<RouteStop> remaining = routeStopRepository.findByRouteIdOrderByStopOrderAsc(routeId);
        for (int i = 0; i < remaining.size(); i++) {
            remaining.get(i).setStopOrder(i + 1);
        }
        routeStopRepository.saveAll(remaining);
        return ResponseEntity.ok(ApiResponse.success("Stop removed from route"));
    }

    @PostMapping("/routes/{routeId}/stops/reorder")
    public ResponseEntity<ApiResponse<String>> reorderStop(
            @PathVariable Long routeId,
            @RequestBody Map<String, Long> body) {
        Long routeStopId = body.get("routeStopId");
        String direction = body.get("direction") != null ? (body.get("direction") == 1L ? "up" : "down") : "up";
        // Use int from body
        int dir = body.getOrDefault("direction", 1L).intValue(); // 1 = up (decrease order), -1 = down (increase order)
        List<RouteStop> stops = routeStopRepository.findByRouteIdOrderByStopOrderAsc(routeId);
        int idx = -1;
        for (int i = 0; i < stops.size(); i++) {
            if (stops.get(i).getId().equals(routeStopId)) { idx = i; break; }
        }
        int swapIdx = idx + (dir == 1 ? -1 : 1);
        if (idx < 0 || swapIdx < 0 || swapIdx >= stops.size()) {
            return ResponseEntity.ok(ApiResponse.success("No change"));
        }
        int tmpOrder = stops.get(idx).getStopOrder();
        stops.get(idx).setStopOrder(stops.get(swapIdx).getStopOrder());
        stops.get(swapIdx).setStopOrder(tmpOrder);
        routeStopRepository.save(stops.get(idx));
        routeStopRepository.save(stops.get(swapIdx));
        return ResponseEntity.ok(ApiResponse.success("Reordered"));
    }

    // --- OPENSTREETMAP STOP IMPORT (static reference data only) ---

    /**
     * Searches OpenStreetMap for real bus stops near a point. Read-only preview:
     * nothing is written until the admin posts a selection to /stops/osm-import.
     * Live bus tracking is untouched by this - it only supplies stop coordinates.
     */
    @GetMapping("/stops/osm-search")
    public ResponseEntity<ApiResponse<List<OsmStopDto>>> searchOsmStops(
            @RequestParam double lat,
            @RequestParam double lon,
            @RequestParam(defaultValue = "2000") int radiusMeters,
            @RequestParam(required = false) String filter) {
        return ResponseEntity.ok(ApiResponse.success(
                osmStopImportService.findNearby(lat, lon, radiusMeters, filter)));
    }

    /** Creates the selected OSM stops. Existing stops are skipped, never overwritten. */
    @PostMapping("/stops/osm-import")
    public ResponseEntity<ApiResponse<List<Stop>>> importOsmStops(@RequestBody List<OsmStopDto> stops) {
        List<Stop> created = osmStopImportService.importStops(stops);
        return ResponseEntity.ok(ApiResponse.success(
                created.size() + " stop(s) imported", created));
    }

    // --- STOPS CRUD ---
    @GetMapping("/stops")
    public ResponseEntity<ApiResponse<List<Stop>>> getAllStops() {
        return ResponseEntity.ok(ApiResponse.success(stopRepository.findAll()));
    }

    @PostMapping("/stops")
    public ResponseEntity<ApiResponse<Stop>> createStop(@RequestBody Stop stop) {
        return ResponseEntity.ok(ApiResponse.success(stopRepository.save(stop)));
    }

    // --- CONDUCTORS CRUD ---
    @GetMapping("/conductors")
    public ResponseEntity<ApiResponse<List<User>>> getAllConductors() {
        List<User> conductors = userRepository.findAll().stream()
                .filter(u -> u.getRole() == Role.CONDUCTOR)
                .collect(Collectors.toList());
        return ResponseEntity.ok(ApiResponse.success(conductors));
    }

    @PostMapping("/conductors/{conductorId}/assign-bus/{busId}")
    public ResponseEntity<ApiResponse<String>> assignConductorToBus(
            @PathVariable Long conductorId, @PathVariable Long busId) {
        Bus bus = busRepository.findById(busId)
                .orElseThrow(() -> new ResourceNotFoundException("Bus not found"));
        bus.setConductor(userRepository.findById(conductorId)
                .orElseThrow(() -> new ResourceNotFoundException("Conductor not found")));
        busRepository.save(bus);
        return ResponseEntity.ok(ApiResponse.success("Conductor assigned to bus"));
    }

    // --- DELETES (guarded against foreign-key breakage) ---
    @DeleteMapping("/buses/{busId}")
    public ResponseEntity<ApiResponse<String>> deleteBus(@PathVariable Long busId) {
        adminService.deleteBus(busId);
        return ResponseEntity.ok(ApiResponse.success("Bus deleted"));
    }

    @DeleteMapping("/stops/{stopId}")
    public ResponseEntity<ApiResponse<String>> deleteStop(@PathVariable Long stopId) {
        adminService.deleteStop(stopId);
        return ResponseEntity.ok(ApiResponse.success("Stop deleted"));
    }

    @DeleteMapping("/conductors/{conductorId}")
    public ResponseEntity<ApiResponse<String>> deleteConductor(@PathVariable Long conductorId) {
        adminService.deleteConductor(conductorId);
        return ResponseEntity.ok(ApiResponse.success("Conductor deleted"));
    }
}
