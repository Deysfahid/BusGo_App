package com.busgo.server.entity;

import jakarta.persistence.*;
import lombok.*;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@Entity
@Table(name = "route_stops", uniqueConstraints = {
        @UniqueConstraint(columnNames = {"route_id", "stop_id"})
})
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RouteStop {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne
    @JoinColumn(name = "route_id", nullable = false)
    @com.fasterxml.jackson.annotation.JsonIgnore
    private Route route;

    @ManyToOne
    @JoinColumn(name = "stop_id", nullable = false)
    @JsonIgnoreProperties("routeStops")
    private Stop stop;

    @Column(nullable = false)
    private Integer stopOrder;
}
