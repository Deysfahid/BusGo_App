package com.busgo.server.entity;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.LocalDateTime;

/**
 * Admin-managed allowlist deciding which Google emails may become staff.
 *
 * <p>This is the authorization source of truth, separate from {@link User}: an
 * email can be authorized here BEFORE that person has ever signed in. On Google
 * sign-in the backend looks the verified email up here to decide the role. A
 * plain Google account with no active row here can only ever be a PASSENGER.</p>
 */
@Entity
@Table(name = "staff_authorizations")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class StaffAuthorization {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false)
    private String email;

    /** ADMIN or CONDUCTOR. PASSENGER is never stored here (it is the default for everyone else). */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Role role;

    @Column(nullable = false)
    @Builder.Default
    private boolean active = true;

    /** Email of the admin who created this authorization (audit trail). */
    private String authorizedBy;

    @CreationTimestamp
    private LocalDateTime createdAt;

    @UpdateTimestamp
    private LocalDateTime updatedAt;
}
