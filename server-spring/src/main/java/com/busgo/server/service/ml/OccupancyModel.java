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
 * Occupancy predictor: a Smile {@link RandomForest} regression that learns
 * expected passenger occupancy for a (route, stop, stopOrder, time) tuple.
 *
 * <p>Feature order (must match training rows and prediction tuples):
 * {@code [routeId, stopId, stopOrder, hourOfDay, dayOfWeek, isWeekend, isRushHour, occupancy]}
 * where {@code occupancy} is the regression label (last column).</p>
 *
 * <p>Thread-safe: the trained forest + its schema are held in {@code volatile}
 * fields and swapped atomically after each (re)train, so live prediction calls
 * never see a half-built model. Until the first successful train, {@link #isReady()}
 * is {@code false} and callers fall back to the heuristic.</p>
 */
@Component
public class OccupancyModel {

    private static final Logger log = LoggerFactory.getLogger(OccupancyModel.class);

    static final String[] COLUMNS =
            {"routeId", "stopId", "stopOrder", "hourOfDay", "dayOfWeek", "isWeekend", "isRushHour", "occupancy"};
    private static final Formula FORMULA = Formula.lhs("occupancy");

    private volatile RandomForest model;
    private volatile StructType schema;
    private volatile int sampleCount;
    private volatile double rmse;

    /**
     * Train (or retrain) the forest from feature rows. Each row must have the
     * {@link #COLUMNS} layout. A new forest is built off to the side and only
     * swapped in once complete.
     */
    public void train(double[][] rows, int trees) {
        if (rows == null || rows.length < 10) {
            log.warn("OccupancyModel: not enough rows to train ({}). Keeping previous/heuristic.",
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
            // Property name / overload mismatch -> fall back to defaults.
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
        log.info("OccupancyModel trained on {} rows (train RMSE = {} passengers).",
                rows.length, String.format("%.2f", trainedRmse));
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
     * Predict expected occupancy. Returns {@link Double#NaN} when the model is
     * not yet trained (caller falls back to the heuristic).
     */
    public double predict(long routeId, long stopId, int stopOrder, int hourOfDay, int dayOfWeek) {
        RandomForest m = this.model;
        StructType s = this.schema;
        if (m == null || s == null) {
            return Double.NaN;
        }
        boolean weekend = dayOfWeek == 6 || dayOfWeek == 7;
        boolean rush = (hourOfDay >= 8 && hourOfDay <= 10) || (hourOfDay >= 17 && hourOfDay <= 19);
        double[] row = {
                routeId, stopId, stopOrder, hourOfDay, dayOfWeek,
                weekend ? 1.0 : 0.0, rush ? 1.0 : 0.0, 0.0 /* dummy label */
        };
        double y = m.predict(Tuple.of(row, s));
        return y < 0 ? 0 : y;
    }
}
