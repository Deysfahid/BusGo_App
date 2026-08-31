package com.busgo.server.controller;

import com.busgo.server.dto.ApiResponse;
import com.busgo.server.entity.RouteStop;
import com.busgo.server.entity.Trip;
import com.busgo.server.exception.ResourceNotFoundException;
import com.busgo.server.repository.RouteStopRepository;
import com.busgo.server.repository.TripRepository;
import com.busgo.server.service.PredictionService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/predictions")
@RequiredArgsConstructor
public class PredictionController {

    private final PredictionService predictionService;
    private final TripRepository tripRepository;
    private final RouteStopRepository routeStopRepository;

    /**
     * Phase 8: returns the ML-predicted occupancy + crowd level for a given
     * upcoming stop of a trip, evaluated at the current time. When the model is
     * not yet trained, {@code modelActive} is false and the prediction is null
     * (clients then rely on the live values pushed over WebSocket).
     */
    @GetMapping("/occupancy/{tripId}/{stopId}")
    public ResponseEntity<ApiResponse<Map<String, Object>>> getPredictedOccupancy(
            @PathVariable Long tripId, @PathVariable Long stopId) {
        Trip trip = tripRepository.findById(tripId)
                .orElseThrow(() -> new ResourceNotFoundException("Trip not found"));

        long routeId = trip.getRoute().getId();
        int stopOrder = routeStopRepository.findByRouteIdAndStopId(routeId, stopId)
                .map(RouteStop::getStopOrder).orElse(0);
        int maxCapacity = (trip.getBus() != null && trip.getBus().getCapacity() != null)
                ? trip.getBus().getCapacity() : 0;

        LocalDateTime now = LocalDateTime.now();
        Integer predictedOccupancy = predictionService.predictOccupancy(
                routeId, stopId, stopOrder, now.getHour(), now.getDayOfWeek().getValue(), maxCapacity);

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("tripId", tripId);
        body.put("stopId", stopId);
        body.put("predictedOccupancy", predictedOccupancy);
        body.put("crowdLevel", predictedOccupancy != null
                ? predictionService.crowdLevelFromOccupancy(predictedOccupancy, maxCapacity)
                : null);
        body.put("modelActive", predictionService.isModelActive());

        return ResponseEntity.ok(ApiResponse.success(body));
    }
}
