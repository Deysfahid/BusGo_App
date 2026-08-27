package com.busgo.server.repository;

import com.busgo.server.entity.Prediction;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface PredictionRepository extends JpaRepository<Prediction, Long> {
    List<Prediction> findByRouteIdAndDayOfWeekAndTimeOfDay(Long routeId, Integer dayOfWeek, String timeOfDay);
}
