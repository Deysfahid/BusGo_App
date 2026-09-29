package com.busgo.server.service;

import com.busgo.server.dto.AuthRequest;
import com.busgo.server.dto.AuthResponse;
import com.busgo.server.dto.RegisterRequest;
import com.busgo.server.entity.AuthProvider;
import com.busgo.server.entity.Role;
import com.busgo.server.entity.User;
import com.busgo.server.mapper.UserMapper;
import com.busgo.server.repository.UserRepository;
import com.busgo.server.security.CustomUserDetails;
import com.busgo.server.security.JwtUtils;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Locale;

@Service
@RequiredArgsConstructor
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuthenticationManager authenticationManager;
    private final JwtUtils jwtUtils;
    private final UserMapper userMapper;
    private final FirebaseTokenVerifierService firebaseVerifier;
    private final StaffAuthorizationService staffService;

    @Value("${busgo.initial-admin-email:${BUSGO_INITIAL_ADMIN_EMAIL:}}")
    private String initialAdminEmail;

    public AuthResponse register(RegisterRequest request) {
        if (userRepository.findByEmail(request.getEmail()).isPresent()) {
            throw new IllegalArgumentException("Email is already in use");
        }

        // SECURITY: public self-registration can ONLY create a PASSENGER. A caller-
        // supplied role is ignored, so nobody can grant themselves ADMIN/CONDUCTOR.
        // Staff roles are issued only via Google sign-in against the admin allowlist.
        User user = User.builder()
                .name(request.getName())
                .email(request.getEmail())
                .password(passwordEncoder.encode(request.getPassword()))
                .role(Role.PASSENGER)
                .authProvider(AuthProvider.LOCAL)
                .active(true)
                .build();

        user = userRepository.save(user);

        String token = jwtUtils.generateToken(new CustomUserDetails(user));
        return AuthResponse.builder()
                .token(token)
                .user(userMapper.toDto(user))
                .build();
    }

    /**
     * Google Sign-In via Firebase. The ID token is verified server-side; the role
     * comes from the DB (initial-admin env, then the staff allowlist, else PASSENGER)
     * and NEVER from the client. On success the existing BusGo JWT is issued, so the
     * rest of the app is unchanged.
     */
    @Transactional
    public AuthResponse firebaseLogin(String idToken) {
        FirebaseTokenVerifierService.VerifiedIdentity id = firebaseVerifier.verify(idToken);
        String email = id.email().toLowerCase(Locale.ROOT);

        User user = userRepository.findByEmail(email).orElse(null);

        if (user != null) {
            // Existing account (one-time signup already done). Block if deactivated.
            if (!user.isActive()) {
                throw new SecurityException("This account has been deactivated");
            }
            // Keep the role in sync with the current authorization (e.g. promoted/kept).
            Role resolved = resolveRole(email);
            if (resolved != null && resolved != user.getRole()) {
                user.setRole(resolved);
            }
            if (user.getFirebaseUid() == null) {
                user.setFirebaseUid(id.uid());
                user.setAuthProvider(AuthProvider.GOOGLE);
            }
            // Refresh the display name from the verified Google profile, so the
            // sidebar shows the authenticated account rather than a stale value
            // carried on the row. Falls back to the email when the token has no name.
            String displayName = (id.name() != null && !id.name().isBlank()) ? id.name() : email;
            if (!displayName.equals(user.getName())) {
                user.setName(displayName);
            }
            user = userRepository.save(user);
        } else {
            // First-time sign-in: refuse if the email was authorized as staff but
            // then deactivated; otherwise create with the resolved role.
            if (staffService.isDeactivatedStaff(email)) {
                throw new SecurityException("This staff account has been deactivated");
            }
            Role role = resolveRole(email);
            if (role == null) {
                role = Role.PASSENGER;
            }
            user = userRepository.save(User.builder()
                    .name(id.name() != null ? id.name() : email)
                    .email(email)
                    .password(null)              // Google-only account: no local password
                    .role(role)
                    .firebaseUid(id.uid())
                    .authProvider(AuthProvider.GOOGLE)
                    .active(true)
                    .build());
            log.info("[AUTH] Created Google account {} as {}", email, role);
        }

        String token = jwtUtils.generateToken(new CustomUserDetails(user));
        return AuthResponse.builder().token(token).user(userMapper.toDto(user)).build();
    }

    /** Initial-admin env wins; otherwise the active staff allowlist; else null (PASSENGER). */
    private Role resolveRole(String email) {
        if (initialAdminEmail != null && !initialAdminEmail.isBlank()
                && email.equalsIgnoreCase(initialAdminEmail.trim())) {
            return Role.ADMIN;
        }
        return staffService.resolveStaffRole(email);
    }

    public AuthResponse login(AuthRequest request) {
        Authentication authentication = authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(request.getEmail(), request.getPassword())
        );

        CustomUserDetails userDetails = (CustomUserDetails) authentication.getPrincipal();
        String token = jwtUtils.generateToken(userDetails);

        return AuthResponse.builder()
                .token(token)
                .user(userMapper.toDto(userDetails.getUser()))
                .build();
    }
}
