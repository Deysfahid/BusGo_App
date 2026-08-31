package com.busgo.server.service;

import com.busgo.server.entity.Trip;
import com.busgo.server.service.ml.OccupancyModel;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

@Service
@RequiredArgsConstructor
public class PredictionService {

    private final OccupancyModel occupancyModel;

    /**
     * Calculates the LIVE crowd level based on current occupancy plus simple
     * time-of-day / day-of-week heuristics. This is the always-available baseline
     * (also the fallback when the ML model is cold).
     * @param trip the current trip
     * @param availableSeats the current available seats
     * @param maxCapacity the maximum capacity of the bus
     * @return A string representing the crowd level: LOW, MEDIUM, HIGH, FULL
     */
    public String predictCrowdLevel(Trip trip, int availableSeats, int maxCapacity) {
        if (maxCapacity == 0) return "UNKNOWN";
        
        double currentOccupancyRate = (double) trip.getCurrentOccupancy() / maxCapacity;
        
        // Base prediction on current occupancy
        double predictedRate = currentOccupancyRate;
        
        // Time of day modifier (rush hours: 8-10 AM, 5-7 PM)
        LocalDateTime now = LocalDateTime.now();
        int hour = now.getHour();
        if ((hour >= 8 && hour <= 10) || (hour >= 17 && hour <= 19)) {
            predictedRate += 0.2; // 20% bump in predicted crowd
        }
        
        // Day of week modifier (Weekends usually have less commuter traffic, but maybe more leisure)
        // This is a simple heuristic for demonstration.
        int dayOfWeek = now.getDayOfWeek().getValue();
        if (dayOfWeek == 6 || dayOfWeek == 7) {
            predictedRate -= 0.1; 
        }
        
        // In a real system, we would query historical synthetic data here based on route and current stop.
        // For MVP, we cap the predicted rate.
        if (predictedRate > 1.0) predictedRate = 1.0;
        if (predictedRate < 0.0) predictedRate = 0.0;
        
        if (predictedRate >= 0.9) return "FULL";
        if (predictedRate >= 0.6) return "HIGH";
        if (predictedRate >= 0.3) return "MEDIUM";
        return "LOW";
    }

    /**
     * Phase 8 — forward-looking, ML-backed occupancy prediction for a specific
     * upcoming stop at a given time. Returns {@code null} when the model is not
     * yet trained (caller then omits the predicted value / uses the heuristic).
     */
    public Integer predictOccupancy(long routeId, long stopId, int stopOrder,
                                    int hourOfDay, int dayOfWeek, int maxCapacity) {
        double pred = occupancyModel.predict(routeId, stopId, stopOrder, hourOfDay, dayOfWeek);
        if (Double.isNaN(pred)) {
            return null;
        }
        int v = (int) Math.round(pred);
        if (v < 0) v = 0;
        if (maxCapacity > 0 && v > maxCapacity) v = maxCapacity;
        return v;
    }

    /** Bucket an occupancy count into the same LOW/MEDIUM/HIGH/FULL scale used live. */
    public String crowdLevelFromOccupancy(int occupancy, int maxCapacity) {
        if (maxCapacity <= 0) return "UNKNOWN";
        double rate = (double) occupancy / maxCapacity;
        if (rate >= 0.9) return "FULL";
        if (rate >= 0.6) return "HIGH";
        if (rate >= 0.3) return "MEDIUM";
        return "LOW";
    }

    /** True once the occupancy model has been trained at least once. */
    public boolean isModelActive() {
        return occupancyModel.isReady();
    }
}
