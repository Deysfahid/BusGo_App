package com.busgo.server.repository;

import com.busgo.server.entity.OccupancyHistory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface OccupancyHistoryRepository extends JpaRepository<OccupancyHistory, Long> {
    List<OccupancyHistory> findByTripIdOrderByTimestampAsc(Long tripId);
}
