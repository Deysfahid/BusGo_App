package com.busgo.server.dto;

import lombok.Data;

@Data
public class CreateTripRequest {
    private Long busId;
    private Long routeId;
}
