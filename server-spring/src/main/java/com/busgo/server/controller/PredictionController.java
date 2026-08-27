package com.busgo.server.controller;

import com.busgo.server.dto.ApiResponse;
import com.busgo.server.service.PredictionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/predictions")
@RequiredArgsConstructor
public class PredictionController {

    private final PredictionService predictionService;

    @GetMapping("/occupancy/{tripId}/{stopId}")
    public ResponseEntity<ApiResponse<Integer>> getPredictedOccupancy(@PathVariable Long tripId, @PathVariable Long stopId) {
        // Deprecated: Crowd level is broadcast via WebSockets
        return ResponseEntity.ok(ApiResponse.success(null));
    }
}
