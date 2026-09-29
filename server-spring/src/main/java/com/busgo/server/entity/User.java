package com.busgo.server.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.time.LocalDateTime;
import java.util.List;

@Entity
@Table(name = "users")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;

    @Column(unique = true, nullable = false)
    private String email;

    /**
     * BCrypt hash for local (email/password) accounts. Nullable because a
     * Google/Firebase-only account has no local password. Existing LOCAL users
     * keep their hash unchanged.
     */
    @Column(nullable = true)
    private String password;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Role role;

    /** Firebase UID for accounts that signed in with Google; null for LOCAL accounts. */
    @Column(unique = true)
    private String firebaseUid;

    /** How this account authenticates: LOCAL (email/password) or GOOGLE (Firebase). */
    @Enumerated(EnumType.STRING)
    @Column(nullable = true)
    @Builder.Default
    private AuthProvider authProvider = AuthProvider.LOCAL;

    /**
     * Whether the account may access the app. Deactivating a staff member sets
     * this false; {@code JwtAuthenticationFilter} then rejects even an unexpired
     * JWT because it re-loads the user every request.
     */
    @Column(nullable = false)
    @Builder.Default
    private boolean active = true;

    @OneToMany(mappedBy = "issuedBy")
    @JsonIgnoreProperties("issuedBy")
    private List<Ticket> ticketsIssued;

    @OneToOne(mappedBy = "conductor")
    @JsonIgnoreProperties("conductor")
    private Bus assignedBus;

    @CreationTimestamp
    private LocalDateTime createdAt;

    @UpdateTimestamp
    private LocalDateTime updatedAt;
}
