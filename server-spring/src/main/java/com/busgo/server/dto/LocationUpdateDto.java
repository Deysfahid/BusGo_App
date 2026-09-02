package com.busgo.server.dto;

import lombok.Data;

@Data
public class LocationUpdateDto {
    private Long busId;
    private Long tripId;
    private Double latitude;
    private Double longitude;

    /**
     * Horizontal accuracy of the fix in metres, as reported by the browser's
     * Geolocation API. A very inaccurate fix still moves the map marker but is
     * not allowed to advance the trip's current stop.
     */
    private Double accuracy;

    /** Epoch millis of the fix on the device, for diagnostics. */
    private Long clientTimestamp;
}
