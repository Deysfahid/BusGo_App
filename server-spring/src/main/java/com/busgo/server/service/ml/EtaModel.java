package com.busgo.server.service.ml;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import smile.data.DataFrame;
import smile.data.Tuple;
import smile.data.formula.Formula;
import smile.data.type.StructType;
import smile.regression.RandomForest;

import java.util.Properties;

/**
 * Dynamic-ETA predictor: a Smile {@link RandomForest} regression that learns
 * per-segment travel time (seconds) from historical segment timings.
 *
 * <p>Feature order (must match training rows and prediction tuples):
 * {@code [routeId, fromStopId, toStopId, distanceKm, hourOfDay, dayOfWeek, isRushHour, travelSeconds]}
 * where {@code travelSeconds} is the regression label (last column).</p>
 *
 * <p>Same thread-safety/cold-start contract as {@link OccupancyModel}.</p>
 */
@Component
public class EtaModel {

    private static final Logger log = LoggerFactory.getLogger(EtaModel.class);

    static final String[] COLUMNS =
            {"routeId", "fromStopId", "toStopId", "distanceKm", "hourOfDay", "dayOfWeek", "isRushHour", "travelSeconds"};
    private static final Formula FORMULA = Formula.lhs("travelSeconds");

    private volatile RandomForest model;
    private volatile StructType schema;
    private volatile int sampleCount;
    private volatile double rmse;

    public void train(double[][] rows, int trees) {
        if (rows == null || rows.length < 10) {
            log.warn("EtaModel: not enough rows to train ({}). Keeping previous/heuristic.",
                    rows == null ? 0 : rows.length);
            return;
        }
        DataFrame df = DataFrame.of(rows, COLUMNS);
        RandomForest rf;
        try {
            Properties props = new Properties();
            props.setProperty("smile.random.forest.trees", String.valueOf(trees));
            rf = RandomForest.fit(FORMULA, df, props);
        } catch (Exception e) {
            rf = RandomForest.fit(FORMULA, df);
        }

        StructType s = df.schema();
        double se = 0.0;
        for (double[] r : rows) {
            double pred = rf.predict(Tuple.of(r, s));
            double err = pred - r[r.length - 1];
            se += err * err;
        }
        double trainedRmse = Math.sqrt(se / rows.length);

        this.schema = s;
        this.model = rf;
        this.sampleCount = rows.length;
        this.rmse = trainedRmse;
        log.info("EtaModel trained on {} rows (train RMSE = {} seconds).",
                rows.length, String.format("%.1f", trainedRmse));
    }

    public boolean isReady() {
        return model != null && schema != null;
    }

    public int getSampleCount() {
        return sampleCount;
    }

    public double getRmse() {
        return rmse;
    }

    /**
     * Predict segment travel time in seconds. Returns {@link Double#NaN} when
     * the model is not yet trained (caller falls back to the fixed-speed heuristic).
     */
    public double predictSeconds(long routeId, long fromStopId, long toStopId,
                                 double distanceKm, int hourOfDay, int dayOfWeek) {
        RandomForest m = this.model;
        StructType s = this.schema;
        if (m == null || s == null) {
            return Double.NaN;
        }
        boolean rush = (hourOfDay >= 8 && hourOfDay <= 10) || (hourOfDay >= 17 && hourOfDay <= 19);
        double[] row = {
                routeId, fromStopId, toStopId, distanceKm, hourOfDay, dayOfWeek,
                rush ? 1.0 : 0.0, 0.0 /* dummy label */
        };
        double y = m.predict(Tuple.of(row, s));
        return y < 0 ? 0 : y;
    }
}
