package com.busgo.server.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class LiveTripStateDto {
    private Long tripId;
    private Long busId;
    private String routeName;
    private String status; // active, completed
    
    // Location
    private Double currentLat;
    private Double currentLon;
    
    // Stops
    private Long currentStopId;
    private String currentStopName;
    private Long nextStopId;
    private String nextStopName;
    
    // Capacity & Occupancy
    private Integer maxCapacity;
    private Integer currentOccupancy;
    private Integer availableSeats;
    
    // Prediction & Crowd
    private String crowdLevel; // LOW, MEDIUM, HIGH, FULL
    
    // ETA (for remaining stops)
    private List<StopEtaDto> remainingStopsEta;
    
    private Long timestamp;
    
    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class StopEtaDto {
        private Long stopId;
        private String stopName;
        private Integer estimatedMinutes;
    }
}
