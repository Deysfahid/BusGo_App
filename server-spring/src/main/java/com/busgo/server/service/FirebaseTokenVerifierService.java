package com.busgo.server.service;

import com.google.firebase.FirebaseApp;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseToken;
import org.springframework.stereotype.Service;

/**
 * Verifies Firebase ID tokens server-side. The SDK checks the signature, the
 * project (issuer/audience) and expiry; we additionally require a verified email.
 *
 * <p>The frontend-supplied email and any role are NEVER trusted; only the fields
 * decoded from the verified token are used.</p>
 */
@Service
public class FirebaseTokenVerifierService {

    /** Verified identity extracted from a Firebase ID token. */
    public record VerifiedIdentity(String uid, String email, boolean emailVerified, String name) {}

    public boolean isConfigured() {
        return !FirebaseApp.getApps().isEmpty();
    }

    /**
     * @throws IllegalStateException if Google Sign-In is not configured on this server
     * @throws SecurityException     if the token is invalid or its email is unverified
     */
    public VerifiedIdentity verify(String idToken) {
        if (idToken == null || idToken.isBlank()) {
            throw new SecurityException("Missing Firebase ID token");
        }
        if (!isConfigured()) {
            throw new IllegalStateException("Google Sign-In is not configured on this server");
        }
        try {
            FirebaseToken decoded = FirebaseAuth.getInstance().verifyIdToken(idToken, true);
            Object verified = decoded.getClaims().get("email_verified");
            boolean emailVerified = Boolean.TRUE.equals(verified);
            String email = decoded.getEmail();
            if (email == null || email.isBlank() || !emailVerified) {
                throw new SecurityException("Google account email is not verified");
            }
            return new VerifiedIdentity(decoded.getUid(), email.toLowerCase(), true, decoded.getName());
        } catch (SecurityException e) {
            throw e;
        } catch (Exception e) {
            throw new SecurityException("Invalid Firebase ID token: " + e.getMessage());
        }
    }
}
