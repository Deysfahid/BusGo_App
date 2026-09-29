package com.busgo.server.dto;

import lombok.Data;

/** Body of POST /api/auth/firebase: the Firebase ID token obtained by the frontend. */
@Data
public class FirebaseLoginRequest {
    private String idToken;
}
