package com.busgo.server.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.time.LocalDateTime;
import java.util.List;

@Entity
@Table(name = "trips")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Trip {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne
    @JoinColumn(name = "bus_id", nullable = false)
    @JsonIgnoreProperties("trips")
    private Bus bus;

    @ManyToOne
    @JoinColumn(name = "route_id", nullable = false)
    @JsonIgnoreProperties("trips")
    private Route route;

    @CreationTimestamp
    private LocalDateTime startTime;

    private LocalDateTime endTime;

    @Column(nullable = false)
    @Builder.Default
    private String status = "active"; // active, completed

    private Long currentStopId;

    @Builder.Default
    private Integer currentOccupancy = 0;

    @Builder.Default
    private Double revenue = 0.0;

    @OneToMany(mappedBy = "trip")
    @JsonIgnoreProperties("trip")
    private List<Ticket> tickets;

    @OneToMany(mappedBy = "trip")
    @com.fasterxml.jackson.annotation.JsonIgnore
    private List<BusLocation> locations;

    @OneToMany(mappedBy = "trip")
    @com.fasterxml.jackson.annotation.JsonIgnore
    private List<OccupancyHistory> occupancyHistory;
}
