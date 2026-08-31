package com.busgo.server.service.ml;

import com.busgo.server.entity.OccupancySample;
import com.busgo.server.entity.TravelSample;
import com.busgo.server.repository.OccupancySampleRepository;
import com.busgo.server.repository.TravelSampleRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;

/**
 * Owns the lifecycle of the two Smile models: trains them once the app is ready
 * (after {@code MlDataSeeder} has bootstrapped synthetic history) and retrains
 * on a fixed schedule so real captured samples progressively improve the models.
 *
 * <p>When {@code busgo.ml.enabled=false} the whole layer is inert — no training
 * runs, both models stay cold, and every consumer falls back to the original
 * heuristics, so the app behaves exactly as it did before Phase 8.</p>
 */
@Service
@RequiredArgsConstructor
public class ModelTrainingService {

    private static final Logger log = LoggerFactory.getLogger(ModelTrainingService.class);

    private final OccupancySampleRepository occupancySampleRepository;
    private final TravelSampleRepository travelSampleRepository;
    private final OccupancyModel occupancyModel;
    private final EtaModel etaModel;

    @Value("${busgo.ml.enabled:true}")
    private boolean mlEnabled;

    @Value("${busgo.ml.randomforest.trees:100}")
    private int trees;

    private volatile Instant lastTrainedAt;

    @EventListener(ApplicationReadyEvent.class)
    public void trainOnStartup() {
        if (!mlEnabled) {
            log.info("busgo.ml.enabled=false -> ML layer disabled; using heuristic ETA/crowd only.");
            return;
        }
        trainAll("startup");
    }

    @Scheduled(fixedDelayString = "${busgo.ml.retrain-interval-ms:1800000}",
               initialDelayString = "${busgo.ml.retrain-interval-ms:1800000}")
    public void trainOnSchedule() {
        if (!mlEnabled) {
            return;
        }
        trainAll("scheduled retrain");
    }

    /** Force a retrain now (used after large data changes / admin trigger if needed). */
    public synchronized void trainAll(String reason) {
        try {
            List<OccupancySample> occ = occupancySampleRepository.findAll();
            double[][] occRows = toOccupancyRows(occ);
            occupancyModel.train(occRows, trees);

            List<TravelSample> trav = travelSampleRepository.findAll();
            double[][] travRows = toTravelRows(trav);
            etaModel.train(travRows, trees);

            lastTrainedAt = Instant.now();
            log.info("ML training complete ({}). occupancySamples={}, travelSamples={}.",
                    reason, occ.size(), trav.size());
        } catch (Exception e) {
            // Never let a training failure take down the app or the request path.
            log.error("ML training failed ({}). Continuing with previous models / heuristic fallback.", reason, e);
        }
    }

    private double[][] toOccupancyRows(List<OccupancySample> samples) {
        double[][] rows = new double[samples.size()][OccupancyModel.COLUMNS.length];
        for (int i = 0; i < samples.size(); i++) {
            OccupancySample s = samples.get(i);
            boolean weekend = s.getDayOfWeek() == 6 || s.getDayOfWeek() == 7;
            boolean rush = (s.getHourOfDay() >= 8 && s.getHourOfDay() <= 10)
                    || (s.getHourOfDay() >= 17 && s.getHourOfDay() <= 19);
            rows[i] = new double[]{
                    s.getRouteId(), s.getStopId(), s.getStopOrder(), s.getHourOfDay(), s.getDayOfWeek(),
                    weekend ? 1.0 : 0.0, rush ? 1.0 : 0.0, s.getOccupancy()
            };
        }
        return rows;
    }

    private double[][] toTravelRows(List<TravelSample> samples) {
        double[][] rows = new double[samples.size()][EtaModel.COLUMNS.length];
        for (int i = 0; i < samples.size(); i++) {
            TravelSample s = samples.get(i);
            boolean rush = (s.getHourOfDay() >= 8 && s.getHourOfDay() <= 10)
                    || (s.getHourOfDay() >= 17 && s.getHourOfDay() <= 19);
            rows[i] = new double[]{
                    s.getRouteId(), s.getFromStopId(), s.getToStopId(), s.getDistanceKm(),
                    s.getHourOfDay(), s.getDayOfWeek(), rush ? 1.0 : 0.0, s.getTravelSeconds()
            };
        }
        return rows;
    }

    public Instant getLastTrainedAt() {
        return lastTrainedAt;
    }
}
