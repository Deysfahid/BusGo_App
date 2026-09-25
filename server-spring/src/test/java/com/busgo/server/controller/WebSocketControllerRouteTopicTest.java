package com.busgo.server.controller;

import com.busgo.server.dto.LiveTripStateDto;
import com.busgo.server.dto.LocationUpdateDto;
import com.busgo.server.service.LocationService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * R2: a GPS ping must be mirrored to the per-route topic ({@code /topic/route_{id}})
 * IN ADDITION to the existing per-bus and fleet-wide topics, which must be preserved.
 */
class WebSocketControllerRouteTopicTest {

    private SimpMessagingTemplate messagingTemplate;
    private LocationService locationService;
    private WebSocketController controller;

    @BeforeEach
    void setUp() {
        messagingTemplate = Mockito.mock(SimpMessagingTemplate.class);
        locationService = Mockito.mock(LocationService.class);
        controller = new WebSocketController(messagingTemplate, locationService);
    }

    private LocationUpdateDto ping(long busId, long tripId) {
        LocationUpdateDto dto = new LocationUpdateDto();
        dto.setBusId(busId);
        dto.setTripId(tripId);
        dto.setLatitude(13.05);
        dto.setLongitude(77.52);
        dto.setAccuracy(10.0);
        return dto;
    }

    private LiveTripStateDto state(long tripId, long busId, Long routeId) {
        return LiveTripStateDto.builder().tripId(tripId).busId(busId).routeId(routeId).status("active").build();
    }

    @Test
    void gpsPingIsBroadcastToBusFleetAndRouteTopics() {
        when(locationService.handleLocationUpdate(anyLong(), anyDouble(), anyDouble(), any(), any(), anyBoolean()))
                .thenReturn(state(7L, 3L, 285L));

        controller.updateLocation(ping(3L, 7L), null);

        verify(messagingTemplate, times(1)).convertAndSend(eq("/topic/bus_3"), any(Object.class));
        verify(messagingTemplate, times(1)).convertAndSend(eq("/topic/bus-updates"), any(Object.class));
        verify(messagingTemplate, times(1)).convertAndSend(eq("/topic/route_285"), any(Object.class));
    }

    @Test
    void routeTopicUsesTheTripsActualRouteId() {
        when(locationService.handleLocationUpdate(anyLong(), anyDouble(), anyDouble(), any(), any(), anyBoolean()))
                .thenReturn(state(9L, 4L, 500L));

        controller.updateLocation(ping(4L, 9L), null);

        ArgumentCaptor<String> dest = ArgumentCaptor.forClass(String.class);
        verify(messagingTemplate, Mockito.atLeastOnce()).convertAndSend(dest.capture(), any(Object.class));
        assertEquals(true, dest.getAllValues().contains("/topic/route_500"));
        assertEquals(false, dest.getAllValues().contains("/topic/route_285"));
    }

    @Test
    void noRouteTopicWhenRouteIdIsNull_butExistingTopicsStillFire() {
        when(locationService.handleLocationUpdate(anyLong(), anyDouble(), anyDouble(), any(), any(), anyBoolean()))
                .thenReturn(state(1L, 1L, null));

        controller.updateLocation(ping(1L, 1L), null);

        verify(messagingTemplate, times(1)).convertAndSend(eq("/topic/bus_1"), any(Object.class));
        verify(messagingTemplate, times(1)).convertAndSend(eq("/topic/bus-updates"), any(Object.class));
        verify(messagingTemplate, never()).convertAndSend(Mockito.startsWith("/topic/route_"), any(Object.class));
    }

    @Test
    void rejectedUpdateBroadcastsNothing() {
        when(locationService.handleLocationUpdate(anyLong(), anyDouble(), anyDouble(), any(), isNull(), anyBoolean()))
                .thenReturn(null); // ownership rejected / inactive / unknown trip

        controller.updateLocation(ping(2L, 2L), null);

        verify(messagingTemplate, never()).convertAndSend(Mockito.anyString(), any(Object.class));
    }
}
