package com.tentamus.lims.dashboard.domain;

import java.util.List;

/**
 * The arithmetic of the K-1 KPI widgets (0.37.0): the Lab Score and the swing flag on a test's monthly orders.
 * Mirrors Node's labScoreFor and W.top_tests number for number (Math.round half up, sample standard deviation).
 */
public final class LabKpis {
    private LabKpis() {}

    /** Alex, 2026-10-28: samples on time 60 %, revenue against the budget forecast 10 %, against the monthly forecast 30 %. */
    public static final int W_ON_TIME = 60, W_BUDGET = 10, W_FORECAST = 30;

    /** A month's score; parts rounded to one decimal, the score to a whole number, null when nothing could be judged. */
    public record Score(Double score, Double onTime, Double budget, Double forecast, boolean partial) {}

    /**
     * ok and n: samples completed on time and in all; rev: revenue in the month; bud and fc: the month's plans (null when none typed);
     * frac: the share of the month gone (1 for a past month). Attainment counts up to 100 % of the plan.
     */
    public static Score score(double ok, double n, double rev, Double bud, Double fc, double frac) {
        Double onTime = n != 0 ? (100 * ok) / n : null;
        Double budget = attainment(rev, bud, frac), forecast = attainment(rev, fc, frac);
        double wsum = 0, sum = 0;
        if (onTime != null) { wsum += W_ON_TIME; sum += W_ON_TIME * onTime; }
        if (budget != null) { wsum += W_BUDGET; sum += W_BUDGET * budget; }
        if (forecast != null) { wsum += W_FORECAST; sum += W_FORECAST * forecast; }
        return new Score(wsum != 0 ? (double) Math.round(sum / wsum) : null, r1(onTime), r1(budget), r1(forecast), wsum != 0 && wsum < 100);
    }

    private static Double attainment(double rev, Double plan, double frac) {
        return plan == null || plan == 0 ? null : Math.min(100, (100 * rev) / (plan * frac));
    }

    private static Double r1(Double v) { return v == null ? null : Math.round(v * 10) / 10.0; }

    /** The swing of last month's orders against the 12 months before it: "high" or "low" outside 2 SD, else "". */
    public record Swing(double mean, double sd, double last, String flag) {}

    /** months: 13 monthly counts, oldest first; the last is last month. */
    public static Swing swing(List<Double> months) {
        List<Double> base = months.subList(0, 12);
        double last = months.get(12);
        // plain left-to-right sums as JavaScript's reduce (DoubleStream.sum compensates and can differ in the last bit)
        double total = 0;
        for (double b : base) total += b;
        double mean = total / base.size();
        double sq = 0;
        for (double b : base) sq += (b - mean) * (b - mean);
        double sd = Math.sqrt(sq / (base.size() - 1));
        String flag = last > mean + 2 * sd && last != mean ? "high" : last < mean - 2 * sd && last != mean ? "low" : "";
        return new Swing(mean, sd, last, flag);
    }
}
