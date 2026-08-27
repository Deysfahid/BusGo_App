package com.busgo.server.dto;

import lombok.Data;

@Data
public class BusDto {
    private Long id;
    private String busNumber;
    private Integer capacity;
    private Long conductorId;
    private String routeName;
    private java.util.List<String> stops;
}
