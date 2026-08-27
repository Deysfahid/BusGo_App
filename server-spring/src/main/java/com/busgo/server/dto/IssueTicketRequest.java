package com.busgo.server.dto;

import lombok.Data;

@Data
public class IssueTicketRequest {
    private Long tripId;
    private Long fromStopId;
    private Long toStopId;
    private Integer passengerCount;
}
