package com.busgo.server.controller;

import com.busgo.server.dto.ApiResponse;
import com.busgo.server.dto.CreateTripRequest;
import com.busgo.server.entity.Trip;
import com.busgo.server.service.TripService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/trips")
@RequiredArgsConstructor
public class TripController {

    private final TripService tripService;

    @GetMapping
    public ResponseEntity<ApiResponse<List<Trip>>> getAllTrips() {
        return ResponseEntity.ok(ApiResponse.success(tripService.getAllTrips()));
    }

    @GetMapping("/active")
    public ResponseEntity<ApiResponse<List<Trip>>> getActiveTrips() {
        return ResponseEntity.ok(ApiResponse.success(tripService.getActiveTrips()));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<Trip>> createTrip(@RequestBody CreateTripRequest request) {
        return ResponseEntity.ok(ApiResponse.success(tripService.createTrip(request.getBusId(), request.getRouteId())));
    }

    @PostMapping("/{tripId}/start")
    public ResponseEntity<ApiResponse<Trip>> startTrip(@PathVariable Long tripId) {
        return ResponseEntity.ok(ApiResponse.success(tripService.startTrip(tripId)));
    }

    @PostMapping("/{tripId}/end")
    public ResponseEntity<ApiResponse<Trip>> endTrip(@PathVariable Long tripId) {
        return ResponseEntity.ok(ApiResponse.success(tripService.endTrip(tripId)));
    }

    @PostMapping("/{tripId}/next-stop")
    public ResponseEntity<ApiResponse<Trip>> nextStop(@PathVariable Long tripId) {
        return ResponseEntity.ok(ApiResponse.success(tripService.nextStop(tripId)));
    }

}
