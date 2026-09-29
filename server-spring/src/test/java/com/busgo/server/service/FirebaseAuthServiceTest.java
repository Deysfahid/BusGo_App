package com.busgo.server.service;

import com.busgo.server.dto.AuthResponse;
import com.busgo.server.dto.RegisterRequest;
import com.busgo.server.dto.UserDto;
import com.busgo.server.entity.AuthProvider;
import com.busgo.server.entity.Role;
import com.busgo.server.entity.StaffAuthorization;
import com.busgo.server.entity.User;
import com.busgo.server.mapper.UserMapper;
import com.busgo.server.repository.StaffAuthorizationRepository;
import com.busgo.server.repository.UserRepository;
import com.busgo.server.security.JwtUtils;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/**
 * Verifies Google/Firebase sign-in role resolution and the closed public-register
 * hole, without any Spring context or real Firebase. The token verifier is mocked
 * to return a chosen verified identity; role decisions come from the DB/env only.
 */
class FirebaseAuthServiceTest {

    private static final String ADMIN_EMAIL = "syedfahid2005@gmail.com";

    private final List<User> users = new ArrayList<>();
    private final List<StaffAuthorization> staffRows = new ArrayList<>();

    private UserRepository userRepository;
    private StaffAuthorizationRepository staffRepo;
    private FirebaseTokenVerifierService verifier;
    private AuthService authService;

    @BeforeEach
    void setUp() {
        userRepository = Mockito.mock(UserRepository.class);
        when(userRepository.findByEmail(anyString())).thenAnswer(inv ->
                users.stream().filter(u -> u.getEmail().equalsIgnoreCase(inv.getArgument(0))).findFirst());
        when(userRepository.save(any(User.class))).thenAnswer(inv -> {
            User u = inv.getArgument(0);
            if (u.getId() == null) u.setId((long) (users.size() + 1));
            users.removeIf(x -> x.getEmail().equalsIgnoreCase(u.getEmail()));
            users.add(u);
            return u;
        });

        staffRepo = Mockito.mock(StaffAuthorizationRepository.class);
        when(staffRepo.findByEmailIgnoreCase(anyString())).thenAnswer(inv ->
                staffRows.stream().filter(s -> s.getEmail().equalsIgnoreCase(inv.getArgument(0))).findFirst());

        StaffAuthorizationService staffService = new StaffAuthorizationService(staffRepo, userRepository);

        verifier = Mockito.mock(FirebaseTokenVerifierService.class);

        PasswordEncoder encoder = Mockito.mock(PasswordEncoder.class);
        when(encoder.encode(any())).thenReturn("HASH");
        JwtUtils jwt = Mockito.mock(JwtUtils.class);
        when(jwt.generateToken(any())).thenReturn("jwt-token");
        UserMapper mapper = Mockito.mock(UserMapper.class);
        when(mapper.toDto(any())).thenAnswer(inv -> {
            User u = inv.getArgument(0);
            UserDto d = new UserDto();
            d.setEmail(u.getEmail());
            d.setRole(u.getRole().name());
            return d;
        });

        authService = new AuthService(userRepository, encoder,
                Mockito.mock(AuthenticationManager.class), jwt, mapper, verifier, staffService);
        ReflectionTestUtils.setField(authService, "initialAdminEmail", ADMIN_EMAIL);
    }

    private void mockVerified(String email) {
        when(verifier.verify(anyString()))
                .thenReturn(new FirebaseTokenVerifierService.VerifiedIdentity("uid-" + email, email, true, "Name"));
    }

    private void authorize(String email, Role role, boolean active) {
        staffRows.add(StaffAuthorization.builder().id((long) (staffRows.size() + 1))
                .email(email).role(role).active(active).build());
    }

    @Test
    void initialAdminEmail_becomesAdmin() {
        mockVerified(ADMIN_EMAIL);
        AuthResponse r = authService.firebaseLogin("token");
        assertEquals("ADMIN", r.getUser().getRole());
    }

    @Test
    void unauthorizedGoogleUser_becomesPassenger_neverStaff() {
        mockVerified("random@gmail.com");
        AuthResponse r = authService.firebaseLogin("token");
        assertEquals("PASSENGER", r.getUser().getRole());
    }

    @Test
    void authorizedConductor_firstSignup_becomesConductor() {
        authorize("driver@gmail.com", Role.CONDUCTOR, true);
        mockVerified("driver@gmail.com");
        AuthResponse r = authService.firebaseLogin("token");
        assertEquals("CONDUCTOR", r.getUser().getRole());
        // Second login reuses the same account (one-time signup).
        AuthResponse again = authService.firebaseLogin("token");
        assertEquals("CONDUCTOR", again.getUser().getRole());
        assertEquals(1, users.size());
    }

    @Test
    void additionalAdmin_authorized_becomesAdmin() {
        authorize("another@gmail.com", Role.ADMIN, true);
        mockVerified("another@gmail.com");
        assertEquals("ADMIN", authService.firebaseLogin("token").getUser().getRole());
    }

    @Test
    void deactivatedStaff_firstSignup_isRejected() {
        authorize("gone@gmail.com", Role.CONDUCTOR, false);
        mockVerified("gone@gmail.com");
        assertThrows(SecurityException.class, () -> authService.firebaseLogin("token"));
    }

    @Test
    void existingButDeactivatedUser_isRejected() {
        users.add(User.builder().id(1L).email("x@gmail.com").role(Role.CONDUCTOR)
                .authProvider(AuthProvider.GOOGLE).active(false).build());
        mockVerified("x@gmail.com");
        assertThrows(SecurityException.class, () -> authService.firebaseLogin("token"));
    }

    @Test
    void publicRegister_ignoresRequestedRole_forcesPassenger() {
        RegisterRequest req = new RegisterRequest();
        req.setName("Sneaky"); req.setEmail("sneaky@x.com");
        req.setPassword("pw"); req.setRole("ADMIN"); // must be ignored
        AuthResponse r = authService.register(req);
        assertEquals("PASSENGER", r.getUser().getRole());
        assertEquals(AuthProvider.LOCAL, users.get(0).getAuthProvider());
    }

    @Test
    void googleAccount_isCreatedWithNullPasswordAndGoogleProvider() {
        mockVerified("newby@gmail.com");
        authService.firebaseLogin("token");
        User created = users.get(0);
        assertNull(created.getPassword());
        assertEquals(AuthProvider.GOOGLE, created.getAuthProvider());
        assertEquals("uid-newby@gmail.com", created.getFirebaseUid());
    }

    @Test
    void existingUser_staleDisplayName_isRefreshedFromGoogleToken_roleUnchanged() {
        // Reproduces the reported bug: a CONDUCTOR whose stored name is a stale,
        // unrelated value ("admin@busgo.ai") should show their real Google identity.
        users.add(User.builder().id(2L).name("admin@busgo.ai").email("fahidsyed23@gmail.com")
                .role(Role.CONDUCTOR).authProvider(AuthProvider.GOOGLE).active(true).build());
        mockVerified("fahidsyed23@gmail.com"); // token carries name "Name"

        AuthResponse r = authService.firebaseLogin("token");

        User updated = users.stream().filter(u -> u.getEmail().equals("fahidsyed23@gmail.com")).findFirst().orElseThrow();
        assertEquals("Name", updated.getName(), "display name should refresh from the verified Google profile");
        assertEquals(Role.CONDUCTOR, updated.getRole(), "role must be unchanged");
        assertEquals("CONDUCTOR", r.getUser().getRole());
    }

    @Test
    void existingUser_tokenWithoutName_fallsBackToEmail_notStaleValue() {
        users.add(User.builder().id(3L).name("admin@busgo.ai").email("noname@gmail.com")
                .role(Role.CONDUCTOR).authProvider(AuthProvider.GOOGLE).active(true).build());
        when(verifier.verify(anyString()))
                .thenReturn(new FirebaseTokenVerifierService.VerifiedIdentity("uid-x", "noname@gmail.com", true, null));

        authService.firebaseLogin("token");

        User updated = users.stream().filter(u -> u.getEmail().equals("noname@gmail.com")).findFirst().orElseThrow();
        assertEquals("noname@gmail.com", updated.getName(), "with no token name, fall back to email, never the stale value");
    }
}
