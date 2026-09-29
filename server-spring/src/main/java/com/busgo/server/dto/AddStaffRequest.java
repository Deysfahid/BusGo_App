package com.busgo.server.dto;

import lombok.Data;

/** Body of POST /api/admin/staff: authorize an email as ADMIN or CONDUCTOR. */
@Data
public class AddStaffRequest {
    private String email;
    private String role; // "ADMIN" or "CONDUCTOR"
}
