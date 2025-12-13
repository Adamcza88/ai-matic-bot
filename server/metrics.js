export function metric(name, labels = {}, value = 1) {
    try {
        const timestamp = new Date().toISOString();
        // In a real system, this would push to Prometheus/Datadog.
        // Here we just structured-log it for the user to see similar to the Bybit Audit Log.
        const logLine = JSON.stringify({
            type: "METRIC",
            name,
            labels,
            value,
            timestamp
        });
        console.log(`[METRIC] ${logLine}`);
    } catch (e) {
        // Metrics should never crash the app
        console.error(`[METRIC_FAIL] ${e.message}`);
    }
}
