package com.busgo.server.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.time.LocalDateTime;

@Entity
@Table(name = "tickets")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Ticket {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne
    @JoinColumn(name = "trip_id", nullable = false)
    @com.fasterxml.jackson.annotation.JsonIgnore
    private Trip trip;

    @Column(nullable = false)
    private Long fromStopId;

    @Column(nullable = false)
    private Long toStopId;

    @Column(nullable = false)
    @Builder.Default
    private Integer passengerCount = 1;

    @ManyToOne
    @JoinColumn(name = "issued_by_id")
    @JsonIgnoreProperties("ticketsIssued")
    private User issuedBy;

    @CreationTimestamp
    private LocalDateTime createdAt;

    @Column(nullable = false)
    @Builder.Default
    private String status = "ACTIVE"; // ACTIVE, COMPLETED
}
