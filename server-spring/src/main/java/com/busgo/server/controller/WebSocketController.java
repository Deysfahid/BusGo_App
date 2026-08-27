package com.busgo.server.controller;

import com.busgo.server.dto.LocationUpdateDto;
import com.busgo.server.dto.LiveTripStateDto;
import com.busgo.server.entity.BusLocation;
import com.busgo.server.repository.BusLocationRepository;
import com.busgo.server.repository.TripRepository;
import com.busgo.server.service.LocationService;
import lombok.RequiredArgsConstructor;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

import java.time.LocalDateTime;

@Controller
@RequiredArgsConstructor
public class WebSocketController {

    private final SimpMessagingTemplate messagingTemplate;
    private final BusLocationRepository busLocationRepository;
    private final TripRepository tripRepository;
    private final LocationService locationService;

    @MessageMapping("/update_location")
    public void updateLocation(@Payload LocationUpdateDto locationUpdate) {
        System.out.println("WebSocket Received: Bus " + locationUpdate.getBusId() + " at " + locationUpdate.getLatitude() + ", " + locationUpdate.getLongitude());
        if (locationUpdate.getBusId() != null && locationUpdate.getLatitude() != null && locationUpdate.getLongitude() != null) {
            
            if (locationUpdate.getTripId() != null) {
                tripRepository.findById(locationUpdate.getTripId()).ifPresent(trip -> {
                    // Save to database
                    BusLocation busLocation = BusLocation.builder()
                            .trip(trip)
                            .latitude(locationUpdate.getLatitude())
                            .longitude(locationUpdate.getLongitude())
                            .timestamp(LocalDateTime.now())
                            .build();
                    busLocationRepository.save(busLocation);

                    // Process geofencing and get enriched state
                    LiveTripStateDto enrichedState = locationService.processLocationUpdate(
                            trip, 
                            locationUpdate.getLatitude(), 
                            locationUpdate.getLongitude()
                    );
                    
                    // Broadcast enriched state to passengers on both topics
                    messagingTemplate.convertAndSend("/topic/bus_" + locationUpdate.getBusId(), enrichedState);
                    messagingTemplate.convertAndSend("/topic/bus-updates", enrichedState);
                });
            } else {
                // If no trip, just broadcast raw coordinates
                messagingTemplate.convertAndSend("/topic/bus_" + locationUpdate.getBusId(), locationUpdate);
            }
        }
    }
}
