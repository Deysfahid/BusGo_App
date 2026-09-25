package com.busgo.server.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * A single route with its ordered stops - the STATIC network view a passenger
 * sees after selecting a route, independent of whether any bus is live. Live bus
 * positions still come separately from {@code /active-buses} + the STOMP topic.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RouteDetailDto {
    private Long id;
    private String name;
    private List<StopDto> stops;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class StopDto {
        private Long id;
        private String name;
        private Integer stopOrder;
        private Double lat;
        private Double lon;
    }
}
