package com.busgo.server.entity;

import jakarta.persistence.*;
import lombok.*;

/**
 * A single training row for the occupancy model.
 *
 * <p>This is a dedicated feature table (not the dormant {@code OccupancyHistory},
 * whose {@code @CreationTimestamp} column cannot carry a back-dated hour/day).
 * Every row already stores the exact features the model consumes, so synthetic
 * bootstrap rows and real-time captured rows share one training path.</p>
 */
@Entity
@Table(name = "occupancy_samples")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class OccupancySample {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long routeId;

    @Column(nullable = false)
    private Long stopId;

    @Column(nullable = false)
    private Integer stopOrder;

    @Column(nullable = false)
    private Integer hourOfDay; // 0-23

    @Column(nullable = false)
    private Integer dayOfWeek; // 1=Mon .. 7=Sun (java.time.DayOfWeek#getValue)

    /** The label: observed number of passengers on board at this stop. */
    @Column(nullable = false)
    private Integer occupancy;

    /** True for synthetic bootstrap rows, false for rows captured from real trips. */
    @Column(nullable = false)
    private Boolean synthetic;
}
