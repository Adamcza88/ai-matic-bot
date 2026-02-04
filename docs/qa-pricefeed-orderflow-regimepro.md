**Scope**
- Realtime pipeline: Bybit WS/REST ingestion, candle buffering, orderflow state, regime metrics, decision callback.
- Source files: `src/engine/priceFeed.ts`, `src/engine/orderflow.ts`, `src/engine/regimePro.ts`, `src/constants/symbols.ts`, `src/hooks/useTradingBot.ts`, UI: `src/components/dashboard/StatusBar.tsx`.

**Definition Of Done (DoD)**
- Feed start/stop is deterministic and idempotent per env and symbol list.
- WS subscription includes kline, tickers, and orderflow topics when enabled.
- REST backfill completes or fails with explicit error state without blocking live WS.
- Candle buffer length is capped and merge is stable under duplicates and out-of-order rows.
- Decision callback fires only with valid candle data and correct symbol mapping.
- Orderflow state updates from orderbook snapshots/deltas and trades without throwing on malformed rows.
- Regime outputs are stable under short data windows and NaN conditions.
- UI rule: no dead buttons. Environment and execution toggles always produce an effect or are disabled with a visible reason.
- Test DoD: unit coverage for pure functions and state transitions; integration for WS+REST+decision callback; e2e for UI feed connectivity and stale feed recovery.
- Stability DoD: handle None/empty data, malformed rows, mismatched timeframe, API errors, WS disconnects, timeouts, and reconnection without crashing the UI.

**Error Handling Standard**
- Categories: Validation, System, External Dependency.
- Validation errors: malformed WS row, NaN price/size, invalid symbol. UI message: "Data ignored: invalid market data". Log includes `error_type=validation` and payload metadata.
- System errors: JSON parse failure, internal exceptions. UI message: "System error while processing feed". Log includes stack trace and `error_type=system`.
- External dependency errors: WS disconnects, REST backfill failure, rate limits. UI message: "Market data unavailable. Reconnecting." Log includes `error_type=external`, HTTP status, WS close code.
- Log format standard fields: `ts`, `event`, `error_type`, `symbol`, `topic`, `env`, `request_id`, `correlation_id`, `payload_meta`, `message`.
- PII: none captured. Strip API keys, user identifiers, IPs.

**Telemetry / Logging + Audit Trail**
- Events: `feed_connect`, `feed_subscribe`, `feed_backfill_start`, `feed_backfill_finish`, `feed_backfill_fail`, `ws_message_drop`, `orderflow_update`, `regime_compute`, `decision_emit`, `ws_error`, `ws_close`, `feed_stale`, `feed_reconnect`.
- Metrics: `feed_latency_ms`, `ws_message_rate`, `drop_count`, `backfill_duration_ms`, `buffer_size`, `decision_rate_per_min`, `orderflow_freshness_ms`, `regime_compute_ms`.
- Audit fields: `actor`, `action`, `timestamp`, `env`, `symbols`, `timeframe`, `mode`, `result`, `reason`.
- Correlation strategy: `correlation_id` per feed session and `request_id` per REST call.

Event schema example:
```json
{
  "ts": "2026-02-04T12:00:00.000Z",
  "event": "feed_subscribe",
  "env": "testnet",
  "symbols": ["BTCUSDT"],
  "timeframe": "1",
  "correlation_id": "feed-<uuid>",
  "result": "ok",
  "meta": {"topics": 3}
}
```

**UI Function Map**
| UI Action | Validation | Expected Result | Error States | Telemetry/Audit | Disabled State + Reason |
| --- | --- | --- | --- | --- | --- |
| Environment: DEMO | No active trade execution or user acknowledges demo mode | Feed connects to testnet endpoints | WS connect fail, REST fail | `feed_connect`, `feed_subscribe`, audit `env=testnet` | Disabled if missing demo API keys |
| Environment: MAINNET | User has mainnet keys and confirms environment | Feed connects to mainnet endpoints | WS connect fail, REST fail | `feed_connect`, `feed_subscribe`, audit `env=mainnet` | Disabled if missing mainnet API keys |
| Execution: Manual | Always | Engine paused, feed may still run for signals | None | `engine_mode_change` | Disabled if system state locked |
| Execution: Auto | Valid auth token and strategy config | Engine running and decisions emitted | Missing auth, invalid config, stale feed | `engine_mode_change`, `decision_emit` | Disabled if no auth or invalid config |
| Refresh Orders | Network available | Orders refreshed | API errors, timeouts | `orders_refresh` | Disabled if no auth |

Předpoklad: start/stop feed is implicit on mode/environment changes in `useTradingBot.ts` rather than a dedicated UI button. Riziko: user cannot force reconnect without toggling environment or mode.

**Test Plan**
- Unit P0: `computeHurst`, `computeChop`, `normalizeWsKline`, `normalizeRestKline`, `mergeCandles`.
- Unit P0: `updateOrderbook`, `updateTrades`, `updateOpenInterest`, `updateLiquidations`, `getOrderFlowSnapshot`.
- Unit P1: HMM update cadence in `regimePro.ts`, NaN handling, VPIN gating, shock/manip flags.
- Integration P0: WS subscribe flow, message routing by topic, decision callback frequency, backfill merge into buffer.
- Integration P1: orderflow enabled path with trades and orderbook, OI updates via ticker.
- E2E P0: start feed on testnet, log shows connected, decisions emitted, stale feed recovery log.
- E2E P1: toggle environment, verify reconnect and state reset.
- Test data: WS fixtures for kline, trades, orderbook snapshot/delta, ticker OI; REST kline list fixture with mixed valid/invalid rows.

**Automated Tests**
- Unit framework: Node test runner currently used in `tests/*.test.*`. Add TS tests via `node --test` or adopt Vitest for TS-first DX.
- Integration tests: mock WebSocket and fetch. Use deterministic clock via fake timers. No sleeps.
- E2E UI: Playwright recommended for Vite React. Use `data-testid` on Environment and Execution buttons and feed status badges.
- Smoke suite (CI gating): unit tests for priceFeed/orderflow/regimePro + one e2e smoke (connect testnet, check log entry and feed age update).

**Regression Protection / CI**
- On every PR: `npm run lint`, unit suite, integration suite, e2e smoke.
- Gating: fail PR on any P0 test failure.
- Flaky handling: quarantine tag, max 1 retry, auto-create ticket with logs and traces.
- Artifacts: e2e video, screenshots on failure, WS message log excerpt.

**Copy / Terminology Fixes**
- Standardize "Price feed" vs "Feed" and "Mainnet" vs "Demo" across UI labels and logs.
- Error microcopy:
  - "Price feed stale — reconnecting" instead of raw timing only.
  - "Market data unavailable. Reconnecting." for WS/REST failures.
  - "Invalid market data ignored" for malformed WS rows.
- Empty state microcopy for signals: "No signals yet. Waiting for live data.".

**Notes For Implementation**
- Add `data-testid` to DEMO/MAINNET buttons and Execution mode toggles in `src/components/dashboard/StatusBar.tsx` for stable e2e selectors.
- Add structured logging wrapper for feed events in `src/engine/priceFeed.ts` and `src/hooks/useTradingBot.ts` to emit correlation IDs.
