import { getPersistentDashboardSnapshot } from "../../server/persistentAggregator.js";

export async function fetchDashboardSnapshot({
  userId,
  env,
  apiKey,
  apiSecret,
  useTestnet,
  scope,
  riskMode,
  symbols,
  ordersLimit,
  executionsLimit,
  pnlLimit,
}) {
  return getPersistentDashboardSnapshot({
    userId,
    env,
    apiKey,
    apiSecret,
    useTestnet,
    scope,
    riskMode,
    symbols,
    ordersLimit,
    executionsLimit,
    pnlLimit,
  });
}
