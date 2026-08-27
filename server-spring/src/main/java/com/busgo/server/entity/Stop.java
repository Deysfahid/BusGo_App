package com.busgo.server.entity;

import jakarta.persistence.*;
import lombok.*;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

@Entity
@Table(name = "stops")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Stop {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false)
    private String name;

    private Double latitude;

    private Double longitude;

    @OneToMany(mappedBy = "stop")
    @com.fasterxml.jackson.annotation.JsonIgnore
    private List<RouteStop> routeStops;
}
