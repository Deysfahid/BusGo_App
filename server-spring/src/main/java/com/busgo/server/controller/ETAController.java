package com.busgo.server.controller;

import com.busgo.server.dto.ApiResponse;
import com.busgo.server.service.ETAService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/eta")
@RequiredArgsConstructor
public class ETAController {

    private final ETAService etaService;

    @GetMapping("/{tripId}/{stopId}")
    public ResponseEntity<ApiResponse<Integer>> getETA(@PathVariable Long tripId, @PathVariable Long stopId) {
        // Deprecated: ETA is now broadcast via WebSockets with LiveTripStateDto
        return ResponseEntity.ok(ApiResponse.success(null));
    }
}
