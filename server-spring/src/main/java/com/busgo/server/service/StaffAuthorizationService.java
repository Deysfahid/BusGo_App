package com.busgo.server.service;

import com.busgo.server.dto.StaffAuthorizationDto;
import com.busgo.server.entity.Role;
import com.busgo.server.entity.StaffAuthorization;
import com.busgo.server.entity.User;
import com.busgo.server.exception.ResourceNotFoundException;
import com.busgo.server.repository.StaffAuthorizationRepository;
import com.busgo.server.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Locale;

/**
 * Admin-controlled staff allowlist. This is the ONLY way an email becomes eligible
 * for ADMIN or CONDUCTOR (besides the env-configured initial admin). Nothing here
 * trusts the client: callers are already restricted to ADMIN by the controller.
 */
@Service
@RequiredArgsConstructor
public class StaffAuthorizationService {

    private static final Logger log = LoggerFactory.getLogger(StaffAuthorizationService.class);

    private final StaffAuthorizationRepository staffRepo;
    private final UserRepository userRepository;

    private static String norm(String email) {
        return email == null ? null : email.trim().toLowerCase(Locale.ROOT);
    }

    @Transactional(readOnly = true)
    public List<StaffAuthorizationDto> list() {
        return staffRepo.findAll().stream()
                .map(s -> StaffAuthorizationDto.from(s, userRepository.findByEmail(s.getEmail()).isPresent()))
                .toList();
    }

    /** Authorize (or re-activate/retarget) an email as ADMIN or CONDUCTOR. */
    @Transactional
    public StaffAuthorizationDto authorize(String rawEmail, String rawRole, String authorizedBy) {
        String email = norm(rawEmail);
        if (email == null || email.isBlank() || !email.contains("@")) {
            throw new IllegalArgumentException("A valid email is required");
        }
        Role role;
        try {
            role = Role.valueOf(rawRole == null ? "" : rawRole.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Role must be ADMIN or CONDUCTOR");
        }
        if (role == Role.PASSENGER) {
            throw new IllegalArgumentException("Only ADMIN or CONDUCTOR can be authorized as staff");
        }

        StaffAuthorization auth = staffRepo.findByEmailIgnoreCase(email).orElseGet(StaffAuthorization::new);
        auth.setEmail(email);
        auth.setRole(role);
        auth.setActive(true);
        if (auth.getAuthorizedBy() == null) {
            auth.setAuthorizedBy(authorizedBy);
        }
        auth = staffRepo.save(auth);

        // If the person has ALREADY signed in before (existing User), reflect the new
        // role/active state on their account so it takes effect immediately.
        userRepository.findByEmail(email).ifPresent(u -> {
            u.setRole(role);
            u.setActive(true);
            userRepository.save(u);
        });
        log.info("[STAFF] Authorized {} as {} (by {})", email, role, authorizedBy);
        return StaffAuthorizationDto.from(auth, userRepository.findByEmail(email).isPresent());
    }

    @Transactional
    public StaffAuthorizationDto setActive(Long id, boolean active) {
        StaffAuthorization auth = staffRepo.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Staff authorization not found"));
        auth.setActive(active);
        staffRepo.save(auth);
        // Enforce on the linked account too: a deactivated staff member is locked out
        // even with an unexpired JWT (JwtAuthenticationFilter re-checks User.active).
        userRepository.findByEmail(auth.getEmail()).ifPresent(u -> {
            u.setActive(active);
            userRepository.save(u);
        });
        log.info("[STAFF] {} {}", active ? "Reactivated" : "Deactivated", auth.getEmail());
        return StaffAuthorizationDto.from(auth, userRepository.findByEmail(auth.getEmail()).isPresent());
    }

    /**
     * The role a verified email should get on Google sign-in: an active staff row's
     * role, otherwise null (caller then treats them as a normal PASSENGER). Returns
     * a signal for deactivated staff so login can be refused.
     */
    @Transactional(readOnly = true)
    public Role resolveStaffRole(String email) {
        return staffRepo.findByEmailIgnoreCase(norm(email))
                .filter(StaffAuthorization::isActive)
                .map(StaffAuthorization::getRole)
                .orElse(null);
    }

    @Transactional(readOnly = true)
    public boolean isDeactivatedStaff(String email) {
        return staffRepo.findByEmailIgnoreCase(norm(email))
                .map(s -> !s.isActive())
                .orElse(false);
    }

    /** Idempotently ensure an email is an active ADMIN authorization (initial-admin bootstrap). */
    @Transactional
    public void ensureAdmin(String rawEmail, String authorizedBy) {
        String email = norm(rawEmail);
        if (email == null || email.isBlank()) return;
        StaffAuthorization auth = staffRepo.findByEmailIgnoreCase(email).orElseGet(StaffAuthorization::new);
        auth.setEmail(email);
        auth.setRole(Role.ADMIN);
        auth.setActive(true);
        if (auth.getAuthorizedBy() == null) auth.setAuthorizedBy(authorizedBy);
        staffRepo.save(auth);
    }
}
