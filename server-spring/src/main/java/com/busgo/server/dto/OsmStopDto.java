package com.busgo.server.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A candidate bus stop discovered in OpenStreetMap.
 *
 * <p>Static reference data only - name and surveyed coordinates. Live bus
 * positions continue to come from the conductor's device via STOMP; nothing in
 * this class or its importer participates in that path.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class OsmStopDto {
    private String name;
    private Double latitude;
    private Double longitude;
    /** Distance from the search centre, metres - lets the UI list nearest first. */
    private Integer distanceMeters;
    /** True when a stop with this name is already stored, so it would be skipped. */
    private Boolean alreadyExists;
}
