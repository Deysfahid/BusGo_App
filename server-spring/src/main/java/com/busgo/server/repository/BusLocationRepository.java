package com.busgo.server.repository;

import com.busgo.server.entity.BusLocation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface BusLocationRepository extends JpaRepository<BusLocation, Long> {
    List<BusLocation> findByTripIdOrderByTimestampDesc(Long tripId);
}
