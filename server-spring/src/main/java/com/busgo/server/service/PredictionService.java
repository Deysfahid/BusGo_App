package com.busgo.server.service;

import com.busgo.server.entity.Trip;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;

@Service
public class PredictionService {

    /**
     * Calculates the predicted crowd level based on multiple factors.
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
}
