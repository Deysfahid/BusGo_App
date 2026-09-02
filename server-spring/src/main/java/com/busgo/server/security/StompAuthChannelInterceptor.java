package com.busgo.server.security;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Lazy;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.stereotype.Component;

/**
 * Authenticates STOMP frames with the same JWTs the REST API uses.
 *
 * <p>Reading is public: guests and passengers CONNECT anonymously and SUBSCRIBE to
 * {@code /topic/**} to follow buses. Writing is not: any SEND to {@code /app/**} -
 * which is how a bus's live position is published - requires a valid token
 * belonging to a conductor or an admin. Without this, anyone able to reach the
 * socket could publish a fake position for any bus.</p>
 *
 * <p>Per-trip ownership (is this the conductor of <em>this</em> bus?) is checked
 * further in, in {@code LocationService}, where the trip is already loaded.</p>
 */
@Component
@RequiredArgsConstructor
public class StompAuthChannelInterceptor implements ChannelInterceptor {

    private static final Logger log = LoggerFactory.getLogger(StompAuthChannelInterceptor.class);

    private final JwtUtils jwtUtils;

    // Lazy: the details service sits behind the security config that builds this bean.
    @Lazy
    private final CustomUserDetailsService userDetailsService;

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor =
                MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null) {
            return message;
        }

        if (StompCommand.CONNECT.equals(accessor.getCommand())) {
            authenticate(accessor);
            return message;
        }

        if (StompCommand.SEND.equals(accessor.getCommand())) {
            String destination = accessor.getDestination();
            if (destination != null && destination.startsWith("/app/")) {
                if (accessor.getUser() == null) {
                    log.warn("[WS-AUTH] Rejected unauthenticated SEND to {}", destination);
                    throw new IllegalArgumentException(
                            "Authentication required to publish to " + destination);
                }
                if (!hasStaffRole(accessor)) {
                    log.warn("[WS-AUTH] Rejected SEND to {} from '{}' - not a conductor or admin",
                            destination, accessor.getUser().getName());
                    throw new IllegalArgumentException("Conductor or admin role required");
                }
            }
        }

        return message;
    }

    /** Reads "Authorization: Bearer ..." from the CONNECT frame; anonymous if absent. */
    private void authenticate(StompHeaderAccessor accessor) {
        String header = accessor.getFirstNativeHeader("Authorization");
        if (header == null || !header.startsWith("Bearer ")) {
            return; // guests may still connect and subscribe to public topics
        }
        String token = header.substring(7);
        try {
            String username = jwtUtils.getUsernameFromToken(token);
            if (username == null) {
                return;
            }
            UserDetails userDetails = userDetailsService.loadUserByUsername(username);
            if (!jwtUtils.validateToken(token, userDetails)) {
                log.warn("[WS-AUTH] CONNECT presented an invalid token for '{}'", username);
                return;
            }
            UsernamePasswordAuthenticationToken authentication =
                    new UsernamePasswordAuthenticationToken(
                            userDetails, null, userDetails.getAuthorities());
            accessor.setUser(authentication);
            log.info("[WS-AUTH] STOMP session authenticated as '{}'", username);
        } catch (Exception e) {
            log.warn("[WS-AUTH] Could not authenticate STOMP CONNECT: {}", e.getMessage());
        }
    }

    private boolean hasStaffRole(StompHeaderAccessor accessor) {
        if (!(accessor.getUser() instanceof UsernamePasswordAuthenticationToken auth)) {
            return false;
        }
        return auth.getAuthorities().stream()
                .map(a -> a.getAuthority())
                .anyMatch(r -> "ROLE_CONDUCTOR".equals(r) || "ROLE_ADMIN".equals(r));
    }

    /** True when the authenticated STOMP principal holds the admin role. */
    public static boolean isAdmin(java.security.Principal principal) {
        return principal instanceof UsernamePasswordAuthenticationToken auth
                && auth.getAuthorities().stream()
                        .anyMatch(a -> "ROLE_ADMIN".equals(a.getAuthority()));
    }
}
