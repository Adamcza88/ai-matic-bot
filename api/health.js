import { getPersistentAggregatorHealth } from "../server/persistentAggregator.js";

export default function handler(req, res) {
    res.json({
        ok: true,
        ts: new Date().toISOString(),
        aggregator: getPersistentAggregatorHealth(),
    });
}
