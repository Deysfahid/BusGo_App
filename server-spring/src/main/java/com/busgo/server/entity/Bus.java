package com.busgo.server.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.time.LocalDateTime;
import java.util.List;

@Entity
@Table(name = "buses")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Bus {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false)
    private String busNumber;

    @Column(nullable = false)
    @Builder.Default
    private Integer capacity = 50;

    @OneToOne
    @JoinColumn(name = "conductor_id", referencedColumnName = "id", unique = true)
    @JsonIgnoreProperties("assignedBus")
    private User conductor;

    private String routeName;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "bus_stops", joinColumns = @JoinColumn(name = "bus_id"))
    @Column(name = "stop")
    private List<String> stops;

    @OneToMany(mappedBy = "bus")
    @com.fasterxml.jackson.annotation.JsonIgnore
    private List<Trip> trips;

    @CreationTimestamp
    private LocalDateTime createdAt;

    @UpdateTimestamp
    private LocalDateTime updatedAt;
}
