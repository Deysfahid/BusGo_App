package com.busgo.server.dto;

import lombok.Data;

@Data
public class LocationUpdateDto {
    private Long busId;
    private Long tripId;
    private Double latitude;
    private Double longitude;
}
