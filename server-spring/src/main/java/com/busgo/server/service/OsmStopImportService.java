package com.busgo.server.service;

import com.busgo.server.dto.OsmStopDto;
import com.busgo.server.entity.Stop;
import com.busgo.server.repository.StopRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Imports STATIC bus-stop reference data (name + surveyed coordinates) from
 * OpenStreetMap into the existing {@code stops} table.
 *
 * <p>This is purely a data source for the stop catalogue. It has no involvement in
 * live tracking: the bus's position still comes from the conductor's device through
 * {@code LocationService}, and the geofence still runs against whatever coordinates
 * a stop holds. Better coordinates simply make that existing geofence more accurate.</p>
 */
@Service
@RequiredArgsConstructor
public class OsmStopImportService {

    private static final Logger log = LoggerFactory.getLogger(OsmStopImportService.class);

    private static final String USER_AGENT = "BusGoAI-stop-import/1.0";
    private static final int MAX_RESULTS = 300;

    private final StopRepository stopRepository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${busgo.osm.overpass-url:https://overpass-api.de/api/interpreter}")
    private String overpassUrl;

    private final HttpClient httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15))
            .build();

    /**
     * Finds bus stops around a point. Read-only: nothing is written until
     * {@link #importStops(List)} is called with the chosen entries.
     *
     * @param radiusMeters search radius, clamped to 10 km
     * @param nameFilter   optional case-insensitive substring on the stop name
     */
    public List<OsmStopDto> findNearby(double lat, double lon, int radiusMeters, String nameFilter) {
        int radius = Math.max(50, Math.min(radiusMeters, 10000));
        String query = String.format(Locale.ROOT,
                "[out:json][timeout:60];node[\"highway\"=\"bus_stop\"](around:%d,%f,%f);out body;",
                radius, lat, lon);

        JsonNode root = callOverpass(query);
        Set<String> existing = new HashSet<>();
        for (Stop s : stopRepository.findAll()) {
            existing.add(normalise(s.getName()));
        }

        List<OsmStopDto> results = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        String filter = (nameFilter == null || nameFilter.isBlank())
                ? null : nameFilter.toLowerCase(Locale.ROOT);

        for (JsonNode el : root.path("elements")) {
            String name = el.path("tags").path("name").asText(null);
            if (name == null || name.isBlank()) {
                continue; // unnamed stops are useless in a route builder
            }
            if (filter != null && !name.toLowerCase(Locale.ROOT).contains(filter)) {
                continue;
            }
            String key = normalise(name);
            if (!seen.add(key)) {
                continue; // OSM stores one node per direction; collapse to one entry
            }
            double stopLat = el.path("lat").asDouble();
            double stopLon = el.path("lon").asDouble();
            results.add(OsmStopDto.builder()
                    .name(name)
                    .latitude(round6(stopLat))
                    .longitude(round6(stopLon))
                    .distanceMeters((int) Math.round(haversineMeters(lat, lon, stopLat, stopLon)))
                    .alreadyExists(existing.contains(key))
                    .build());
        }

        results.sort(Comparator.comparingInt(OsmStopDto::getDistanceMeters));
        if (results.size() > MAX_RESULTS) {
            return new ArrayList<>(results.subList(0, MAX_RESULTS));
        }
        log.info("[OSM] {} stop(s) found within {}m of ({}, {})", results.size(), radius, lat, lon);
        return results;
    }

    /**
     * Creates the chosen stops. Existing stops are never modified or deleted -
     * a name that already exists is skipped, so re-running is safe.
     *
     * @return the stops actually created
     */
    @Transactional
    public List<Stop> importStops(List<OsmStopDto> chosen) {
        List<Stop> created = new ArrayList<>();
        for (OsmStopDto candidate : chosen) {
            if (candidate.getName() == null || candidate.getName().isBlank()
                    || candidate.getLatitude() == null || candidate.getLongitude() == null) {
                continue;
            }
            if (stopRepository.findByName(candidate.getName()).isPresent()) {
                continue; // additive only: never overwrite a stop already in use
            }
            created.add(stopRepository.save(Stop.builder()
                    .name(candidate.getName())
                    .latitude(candidate.getLatitude())
                    .longitude(candidate.getLongitude())
                    .build()));
        }
        log.info("[OSM] Imported {} new stop(s)", created.size());
        return created;
    }

    private JsonNode callOverpass(String query) {
        try {
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(overpassUrl))
                    .timeout(Duration.ofSeconds(90))
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .header("User-Agent", USER_AGENT)
                    .POST(HttpRequest.BodyPublishers.ofString(
                            "data=" + URLEncoder.encode(query, StandardCharsets.UTF_8)))
                    .build();

            HttpResponse<String> response =
                    httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() != 200 || !response.body().stripLeading().startsWith("{")) {
                // Overpass is a shared public service; 429/504 under load is normal.
                throw new IllegalStateException(
                        "OpenStreetMap search is busy (HTTP " + response.statusCode()
                                + "). Please try again in a moment.");
            }
            return objectMapper.readTree(response.body());
        } catch (IllegalStateException e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("OpenStreetMap search was interrupted");
        } catch (Exception e) {
            log.warn("[OSM] Overpass query failed: {}", e.getMessage());
            throw new IllegalStateException("Could not reach OpenStreetMap: " + e.getMessage());
        }
    }

    private static String normalise(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
    }

    private static double round6(double v) {
        return Math.round(v * 1_000_000d) / 1_000_000d;
    }

    /** Same formula the geofence uses, kept local so this class stays self-contained. */
    private static double haversineMeters(double lat1, double lon1, double lat2, double lon2) {
        final double R = 6_371_000;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
}
