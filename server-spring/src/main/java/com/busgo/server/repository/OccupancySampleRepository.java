package com.busgo.server.repository;

import com.busgo.server.entity.OccupancySample;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface OccupancySampleRepository extends JpaRepository<OccupancySample, Long> {
}
