package com.busgo.server.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;

import java.time.LocalDateTime;

@Entity
@Table(name = "occupancy_history")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class OccupancyHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne
    @JoinColumn(name = "trip_id", nullable = false)
    private Trip trip;

    @Column(nullable = false)
    private Long stopId;

    @Column(nullable = false)
    private Integer occupancyCount;

    @CreationTimestamp
    private LocalDateTime timestamp;
}
