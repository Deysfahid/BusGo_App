package com.busgo.server.entity;

import jakarta.persistence.*;
import lombok.*;

/**
 * A single training row for the dynamic-ETA (segment travel-time) model.
 *
 * <p>Records how long the bus actually took to travel one route segment
 * (fromStop -> toStop) at a given time of day. Populated by the synthetic
 * bootstrap seeder and by real segment timings captured in {@code TripService}.</p>
 */
@Entity
@Table(name = "travel_samples")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class TravelSample {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long routeId;

    @Column(nullable = false)
    private Long fromStopId;

    @Column(nullable = false)
    private Long toStopId;

    /** Great-circle distance of the segment in km (a strong predictor of travel time). */
    @Column(nullable = false)
    private Double distanceKm;

    @Column(nullable = false)
    private Integer hourOfDay; // 0-23

    @Column(nullable = false)
    private Integer dayOfWeek; // 1=Mon .. 7=Sun

    /** The label: observed travel time for this segment, in seconds. */
    @Column(nullable = false)
    private Integer travelSeconds;

    @Column(nullable = false)
    private Boolean synthetic;
}
