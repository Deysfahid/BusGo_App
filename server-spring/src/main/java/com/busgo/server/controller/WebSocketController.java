package com.busgo.server.controller;

import com.busgo.server.dto.LiveTripStateDto;
import com.busgo.server.dto.LocationUpdateDto;
import com.busgo.server.security.StompAuthChannelInterceptor;
import com.busgo.server.service.LocationService;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.security.Principal;

@Controller
@RequiredArgsConstructor
public class WebSocketController {

    private static final Logger log = LoggerFactory.getLogger(WebSocketController.class);

    private final SimpMessagingTemplate messagingTemplate;
    private final LocationService locationService;

    @MessageMapping("/update_location")
    public void updateLocation(@Payload LocationUpdateDto locationUpdate, Principal principal) {
        log.info("[WS] Location from '{}': bus={} trip={} lat={} lon={} accuracy={}m",
                principal != null ? principal.getName() : "anonymous",
                locationUpdate.getBusId(), locationUpdate.getTripId(),
                locationUpdate.getLatitude(), locationUpdate.getLongitude(),
                locationUpdate.getAccuracy());

        if (locationUpdate.getBusId() == null
                || locationUpdate.getLatitude() == null
                || locationUpdate.getLongitude() == null
                || locationUpdate.getTripId() == null) {
            log.warn("[WS] Dropping incomplete location update: {}", locationUpdate);
            return;
        }

        try {
            // Persisting the ping, geofencing and the automatic stop advance all
            // happen inside one transaction owned by the service.
            LiveTripStateDto enrichedState = locationService.handleLocationUpdate(
                    locationUpdate.getTripId(),
                    locationUpdate.getLatitude(),
                    locationUpdate.getLongitude(),
                    locationUpdate.getAccuracy(),
                    principal != null ? principal.getName() : null,
                    StompAuthChannelInterceptor.isAdmin(principal)
            );

            if (enrichedState == null) {
                return; // rejected, unknown trip, or trip no longer active
            }

            // Per-bus topic for the conductor, plus the fleet-wide topic that the
            // passenger and admin views follow.
            messagingTemplate.convertAndSend("/topic/bus_" + locationUpdate.getBusId(), enrichedState);
            messagingTemplate.convertAndSend("/topic/bus-updates", enrichedState);
        } catch (Exception e) {
            // Without this the messaging layer swallows the failure and the bus
            // silently stops advancing through its stops.
            log.error("[WS] Failed to process location update for trip {}: {}",
                    locationUpdate.getTripId(), e.getMessage(), e);
        }
    }
}
