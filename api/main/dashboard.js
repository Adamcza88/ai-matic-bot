import { fetchDashboardSnapshot } from "../shared/dashboardSnapshot.js";
import { getUserApiKeys, getUserFromToken } from "../../server/userCredentials.js";
import { extractRequestToken } from "../../server/requestAuth.js";

function normalizeQueryValue(value) {
  if (Array.isArray(value)) return value[0] ?? undefined;
  return value;
}

function readQuery(req) {
  if (req?.query && typeof req.query === "object") {
    const normalized = {};
    for (const [key, value] of Object.entries(req.query)) {
      normalized[key] = normalizeQueryValue(value);
    }
    return normalized;
  }

  try {
    const url = new URL(req?.url ?? "", "http://localhost");
    return Object.fromEntries(url.searchParams.entries());
  } catch (_) {
    return {};
  }
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Auth-Token");
}

function resolveErrorMessage(err) {
  const upstream = err?.response?.data;
  if (upstream?.retMsg) return String(upstream.retMsg);
  if (upstream?.message) return String(upstream.message);
  if (typeof upstream === "string" && upstream.trim()) return upstream;
  if (err?.message) return String(err.message);
  return "Unknown error";
}

function resolveErrorStatus(err, message) {
  const upstreamStatus = Number(err?.status ?? err?.response?.status);
  if (Number.isFinite(upstreamStatus) && upstreamStatus >= 400 && upstreamStatus < 600) {
    return upstreamStatus;
  }

  const text = String(message ?? "").toLowerCase();
  if (
    text.includes("missing authorization header") ||
    text.includes("missing auth token") ||
    text.includes("failed to validate user token") ||
    text.includes("user not found for provided token") ||
    text.includes("jwt")
  ) {
    return 401;
  }
  if (
    text.includes("missing testnet api keys") ||
    text.includes("missing mainnet api keys") ||
    text.includes("api key/secret not configured")
  ) {
    return 400;
  }
  return 500;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const query = readQuery(req);
    const useTestnet = query.net === "testnet";
    const token = extractRequestToken(req);

    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing auth token" });
    }

    const user = await getUserFromToken(token);
    const keys = await getUserApiKeys(user.id, useTestnet ? "testnet" : "mainnet");
    const apiKey = keys.apiKey;
    const apiSecret = keys.apiSecret;

    if (!apiKey || !apiSecret) {
      return res.status(400).json({
        ok: false,
        error: useTestnet
          ? "Bybit TESTNET API key/secret not configured for this user"
          : "Bybit MAINNET API key/secret not configured for this user",
      });
    }

    const data = await fetchDashboardSnapshot({
      userId: user.id,
      env: useTestnet ? "testnet" : "mainnet",
      apiKey,
      apiSecret,
      useTestnet,
      scope: query.scope,
      riskMode: query.riskMode,
      symbols: query.symbols,
      ordersLimit: query.ordersLimit,
      executionsLimit: query.executionsLimit,
      pnlLimit: query.pnlLimit,
    });

    return res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/main/dashboard error:", err);
    const errorMessage = resolveErrorMessage(err);
    const status = resolveErrorStatus(err, errorMessage);
    return res.status(status).json({
      ok: false,
      error: errorMessage,
    });
  }
}
