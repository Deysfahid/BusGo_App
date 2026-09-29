package com.busgo.server.dto;

import com.busgo.server.entity.Role;
import com.busgo.server.entity.StaffAuthorization;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/** A staff-authorization row plus whether a linked account has actually signed up. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class StaffAuthorizationDto {
    private Long id;
    private String email;
    private Role role;
    private boolean active;
    private boolean accountExists;   // true once the person has signed in and a User row exists
    private String authorizedBy;
    private LocalDateTime createdAt;

    public static StaffAuthorizationDto from(StaffAuthorization s, boolean accountExists) {
        return StaffAuthorizationDto.builder()
                .id(s.getId()).email(s.getEmail()).role(s.getRole())
                .active(s.isActive()).accountExists(accountExists)
                .authorizedBy(s.getAuthorizedBy()).createdAt(s.getCreatedAt())
                .build();
    }
}
