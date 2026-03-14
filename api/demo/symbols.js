import { getUserFromToken } from "../../server/userCredentials.js";
import { extractRequestToken } from "../../server/requestAuth.js";
import { getSymbolCatalog } from "../../server/symbolCatalog.js";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Auth-Token");
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
    const useTestnet = req.query.net !== "mainnet";
    const token = extractRequestToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing auth token" });
    }
    await getUserFromToken(token);
    const data = await getSymbolCatalog(useTestnet);
    return res.status(200).json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err?.response?.data || err?.message || "Unknown error",
    });
  }
}
