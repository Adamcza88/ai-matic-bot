// server/index.js
import express from "express";
import cors from "cors";
import {
  ensureConfigured,
  createDemoOrder,
  getDemoPositions,
} from "./bybitClient.js";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

/**
 * CREATE DEMO ORDER (+ případné SL/TP/TS pokud je bybitClient umí)
 *
 * očekávané body z frontendu:
 * {
 *   symbol: "ADAUSDT",
 *   side: "Buy" | "Sell",
 *   qty: number,
 *   price?: number,
 *   sl?: number,          // target SL price
 *   tp?: number,          // target TP price
 *   trailingStop?: number // trailing distance (ne procenta)
 * }
 */
app.post("/api/demo/order", async (req, res) => {
  try {
    ensureConfigured();

    const {
      symbol,
      side,
      qty,
      price,
      sl,
      tp,
      trailingStop, // může být undefined
    } = req.body || {};

    if (!symbol || !side || !qty) {
      return res.status(400).json({
        ok: false,
        error: "Missing symbol/side/qty in request body",
      });
    }

    // předáme všechna pole do bybitClient.createDemoOrder,
    // ten si s nimi naloží podle své implementace
    const orderResult = await createDemoOrder({
      symbol,
      side,
      qty,
      price,
      sl,
      tp,
      trailingStop,
    });

    return res.json({
      ok: true,
      order: orderResult,
    });
  } catch (err) {
    console.error("POST /api/demo/order error:", err);
    return res.status(500).json({
      ok: false,
      error: err?.response?.data || err.message || "Unknown error",
    });
  }
});

/**
 * Přehled DEMO pozic z Bybit testnetu
 */
app.get("/api/demo/positions", async (req, res) => {
  try {
    ensureConfigured();
    const data = await getDemoPositions();
    res.json({ ok: true, data });
  } catch (err) {
    console.error("GET /api/demo/positions error:", err);
    res.status(500).json({
      ok: false,
      error: err?.response?.data || err.message || "Unknown error",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});