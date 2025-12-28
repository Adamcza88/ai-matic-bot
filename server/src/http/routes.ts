import express from "express";
import { TradeIntent, Symbol } from "../domain/types";
import { handleIntent, killSwitch } from "../execution/executionRouter";

export function makeRoutes(ctx: any) {
  const r = express.Router();

  r.get("/state", (_req, res) => res.json(ctx.state));

  r.post("/intent", async (req, res) => {
    const intent = req.body as TradeIntent;
    await handleIntent(ctx, intent);
    res.json({ ok: true, intentId: intent.intentId });
  });

  r.post("/kill", async (req, res) => {
    const { symbol } = req.body as { symbol: Symbol };
    await killSwitch(ctx, symbol);
    res.json({ ok: true });
  });

  return r;
}
