import { RestClientV5, WebsocketClient } from "bybit-api";
import { AuditLog } from "../infra/audit";
import { WsHealth } from "../infra/wsHealth";
import { Symbol } from "../domain/types";

export type BybitEnv = "mainnet" | "testnet";

export type InstrumentSpec = {
  symbol: Symbol;
  qtyStep: number;
  minOrderQty: number;
};

export class BybitV5Client {
  public rest: RestClientV5;
  public ws: WebsocketClient;
  private audit: AuditLog;
  private health: WsHealth;

  private instrumentCache = new Map<Symbol, InstrumentSpec>();
  private lastPrice = new Map<Symbol, number>();

  constructor(args: {
    env: BybitEnv;
    apiKey: string;
    apiSecret: string;
    audit: AuditLog;
    health: WsHealth;
  }) {
    const testnet = args.env !== "mainnet";

    this.rest = new RestClientV5({
      key: args.apiKey,
      secret: args.apiSecret,
      testnet,
    });

    this.ws = new WebsocketClient({
      key: args.apiKey,
      secret: args.apiSecret,
      testnet,
      market: "v5",
      pingInterval: 10_000,
      pongTimeout: 2_000,
      reconnectTimeout: 500,
      recvWindow: 10_000,
    });

    this.audit = args.audit;
    this.health = args.health;

    this.wireWs();
  }

  private wireWs() {
    this.ws.on("open", (e: any) => this.audit.write("ws_open", e));
    this.ws.on("response", (e: any) => this.audit.write("ws_response", e));
    this.ws.on("reconnected", (e: any) => this.audit.write("ws_reconnected", e));
    this.ws.on("close", (e: any) => this.audit.write("ws_close", e));
    this.ws.on("error", (e: any) => this.audit.write("ws_error", String(e)));

    this.ws.on("update", (msg: any) => {
      // V5 payload typically includes "topic" and "data".
      const topic = String(msg?.topic ?? "");
      const data = msg?.data;

      // Private topics
      if (topic.startsWith("order") || topic === "order") this.health.markPrivate();
      if (topic.startsWith("execution") || topic === "execution") this.health.markPrivate();
      if (topic.startsWith("position") || topic === "position") this.health.markPrivate();

      // Public ticker (topic name depends on category/SDK)
      if (topic.includes("tickers")) {
        this.health.markMarket();
        const arr = Array.isArray(data) ? data : data ? [data] : [];
        for (const t of arr) {
          const sym = t?.symbol as Symbol | undefined;
          const lp = Number(t?.lastPrice ?? t?.lp ?? NaN);
          if (sym && Number.isFinite(lp)) this.lastPrice.set(sym, lp);
        }
      }
    });
  }

  startPrivateStreams() {
    this.ws.subscribeV5(["order", "execution", "position"], "linear");
  }

  startMarketStreams(symbols: Symbol[]) {
    const topics = symbols.map((s) => `tickers.${s}`);
    this.ws.subscribeV5(topics, "linear");
  }

  async getInstrument(symbol: Symbol): Promise<InstrumentSpec> {
    const cached = this.instrumentCache.get(symbol);
    if (cached) return cached;

    const res: any = await this.rest.getInstrumentsInfo({
      category: "linear",
      symbol,
    });
    const list = res?.result?.list ?? [];
    const row = list[0];

    const qtyStep = Number(row?.lotSizeFilter?.qtyStep ?? row?.qtyStep ?? NaN);
    const minOrderQty = Number(row?.lotSizeFilter?.minOrderQty ?? row?.minOrderQty ?? NaN);

    if (!Number.isFinite(qtyStep) || !Number.isFinite(minOrderQty)) {
      throw new Error("INSTRUMENT_PARSE_FAILED");
    }

    const spec: InstrumentSpec = { symbol, qtyStep, minOrderQty };
    this.instrumentCache.set(symbol, spec);
    return spec;
  }

  async getLastPrice(symbol: Symbol): Promise<number> {
    const wsPrice = this.lastPrice.get(symbol);
    if (wsPrice && Number.isFinite(wsPrice)) return wsPrice;

    const res: any = await this.rest.getTickers({ category: "linear", symbol });
    const row = res?.result?.list?.[0];
    const lp = Number(row?.lastPrice ?? NaN);
    if (!Number.isFinite(lp)) throw new Error("TICKER_FAILED");
    return lp;
  }
}
