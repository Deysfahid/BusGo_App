package com.busgo.server.repository;

import com.busgo.server.entity.BusLocation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface BusLocationRepository extends JpaRepository<BusLocation, Long> {
    List<BusLocation> findByTripIdOrderByTimestampDesc(Long tripId);

    /**
     * Newest recorded position for a trip. Used so a passenger opening the app
     * sees the bus straight away, instead of an empty map until the conductor's
     * next ping (and even after a backend restart clears the in-memory cache).
     */
    Optional<BusLocation> findTopByTripIdOrderByTimestampDesc(Long tripId);
}
