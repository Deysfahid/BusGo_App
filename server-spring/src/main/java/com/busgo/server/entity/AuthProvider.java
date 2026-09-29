package com.busgo.server.entity;

/** How a BusGo account authenticates. */
public enum AuthProvider {
    LOCAL,   // email + password (existing accounts)
    GOOGLE   // Google Sign-In via Firebase
}
