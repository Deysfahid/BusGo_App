package com.busgo.server.controller;

import com.busgo.server.dto.ApiResponse;
import com.busgo.server.dto.AuthRequest;
import com.busgo.server.dto.AuthResponse;
import com.busgo.server.dto.FirebaseLoginRequest;
import com.busgo.server.dto.RegisterRequest;
import com.busgo.server.service.AuthService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    @PostMapping("/register")
    public ResponseEntity<ApiResponse<AuthResponse>> register(@Valid @RequestBody RegisterRequest request) {
        return ResponseEntity.ok(ApiResponse.success("User registered successfully", authService.register(request)));
    }

    @PostMapping("/login")
    public ResponseEntity<ApiResponse<AuthResponse>> login(@Valid @RequestBody AuthRequest request) {
        return ResponseEntity.ok(ApiResponse.success("Login successful", authService.login(request)));
    }

    /**
     * Google Sign-In (via Firebase). The frontend sends the Firebase ID token; the
     * backend verifies it, resolves the BusGo role from the database, and returns the
     * existing BusGo JWT. No email or role from the client is trusted.
     */
    @PostMapping("/firebase")
    public ResponseEntity<ApiResponse<AuthResponse>> firebase(@RequestBody FirebaseLoginRequest request) {
        return ResponseEntity.ok(ApiResponse.success("Login successful",
                authService.firebaseLogin(request.getIdToken())));
    }
}
