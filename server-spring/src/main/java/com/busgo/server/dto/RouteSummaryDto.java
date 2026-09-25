package com.busgo.server.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Lightweight route search result: id + name only, no nested stops. Used by
 * {@code GET /api/routes/search} so the passenger autocomplete never pulls the
 * full network (thousands of routes with their stops) into the browser.
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class RouteSummaryDto {
    private Long id;
    private String name;
}
