package com.busgo.server.repository;

import com.busgo.server.entity.TravelSample;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface TravelSampleRepository extends JpaRepository<TravelSample, Long> {
}
