package com.busgo.server.entity;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "predictions")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Prediction {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long routeId;

    @Column(nullable = false)
    private String timeOfDay; // e.g., '08:00', '17:00'

    @Column(nullable = false)
    private Integer dayOfWeek; // 0 = Sunday, 1 = Monday, etc.

    @Column(nullable = false)
    private Integer expectedOccupancy;
}
