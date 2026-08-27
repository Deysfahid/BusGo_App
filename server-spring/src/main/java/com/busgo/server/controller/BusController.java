package com.busgo.server.controller;

import com.busgo.server.dto.ApiResponse;
import com.busgo.server.dto.BusDto;
import com.busgo.server.service.BusService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/buses")
@RequiredArgsConstructor
public class BusController {

    private final BusService busService;

    @GetMapping
    public ResponseEntity<ApiResponse<List<BusDto>>> getAllBuses() {
        return ResponseEntity.ok(ApiResponse.success(busService.getAllBuses()));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<BusDto>> getBusById(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.success(busService.getBusById(id)));
    }

    @PostMapping("/{busId}/assign-conductor/{conductorId}")
    public ResponseEntity<ApiResponse<BusDto>> assignConductor(@PathVariable Long busId, @PathVariable Long conductorId) {
        return ResponseEntity.ok(ApiResponse.success("Conductor assigned", busService.assignConductor(busId, conductorId)));
    }
}
