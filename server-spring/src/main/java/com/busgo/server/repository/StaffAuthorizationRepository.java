package com.busgo.server.repository;

import com.busgo.server.entity.StaffAuthorization;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface StaffAuthorizationRepository extends JpaRepository<StaffAuthorization, Long> {
    Optional<StaffAuthorization> findByEmailIgnoreCase(String email);
    boolean existsByEmailIgnoreCase(String email);
}
