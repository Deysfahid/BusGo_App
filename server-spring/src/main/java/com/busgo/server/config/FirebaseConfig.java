package com.busgo.server.config;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

import java.io.ByteArrayInputStream;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Initializes the Firebase Admin SDK once, from a service-account credential the
 * operator supplies. The credential is a SECRET and never lives in Git.
 *
 * <p><b>Graceful when unconfigured:</b> if no credential is provided the app still
 * boots normally and every existing feature works; only Google Sign-In is
 * unavailable (the verifier returns a clear error). This keeps local dev, tests,
 * and email/password login working without any Firebase setup.</p>
 *
 * <p>Credential resolution order:
 * <ol>
 *   <li>{@code FIREBASE_SERVICE_ACCOUNT_JSON} — the raw JSON as an env value;</li>
 *   <li>{@code firebase.credentials-path} / {@code GOOGLE_APPLICATION_CREDENTIALS} — a file path;</li>
 *   <li>Application Default Credentials, if present.</li>
 * </ol></p>
 */
@Configuration
public class FirebaseConfig {

    private static final Logger log = LoggerFactory.getLogger(FirebaseConfig.class);

    @Value("${firebase.credentials-json:${FIREBASE_SERVICE_ACCOUNT_JSON:}}")
    private String credentialsJson;

    @Value("${firebase.credentials-path:${GOOGLE_APPLICATION_CREDENTIALS:}}")
    private String credentialsPath;

    @Value("${firebase.project-id:${FIREBASE_PROJECT_ID:}}")
    private String projectId;

    @PostConstruct
    public void init() {
        if (!FirebaseApp.getApps().isEmpty()) {
            return; // already initialized
        }
        try {
            GoogleCredentials credentials = resolveCredentials();
            if (credentials == null) {
                log.warn("[FIREBASE] No service-account credential configured. Google Sign-In is "
                        + "DISABLED; email/password login and all other features are unaffected. "
                        + "Set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS to enable it.");
                return;
            }
            FirebaseOptions.Builder options = FirebaseOptions.builder().setCredentials(credentials);
            if (projectId != null && !projectId.isBlank()) {
                options.setProjectId(projectId.trim());
            }
            FirebaseApp.initializeApp(options.build());
            log.info("[FIREBASE] Admin SDK initialized (project '{}'). Google Sign-In enabled.",
                    projectId == null || projectId.isBlank() ? "from credential" : projectId.trim());
        } catch (Exception e) {
            // Never let a Firebase misconfiguration stop the app from booting.
            log.error("[FIREBASE] Could not initialize Admin SDK: {}. Google Sign-In is DISABLED; "
                    + "everything else works normally.", e.getMessage());
        }
    }

    private GoogleCredentials resolveCredentials() throws Exception {
        if (credentialsJson != null && !credentialsJson.isBlank()) {
            try (InputStream in = new ByteArrayInputStream(credentialsJson.getBytes(StandardCharsets.UTF_8))) {
                return GoogleCredentials.fromStream(in);
            }
        }
        if (credentialsPath != null && !credentialsPath.isBlank()) {
            try (InputStream in = new FileInputStream(credentialsPath.trim())) {
                return GoogleCredentials.fromStream(in);
            }
        }
        try {
            return GoogleCredentials.getApplicationDefault();
        } catch (Exception ignored) {
            return null; // none configured
        }
    }
}
