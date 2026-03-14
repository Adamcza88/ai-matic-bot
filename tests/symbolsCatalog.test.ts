import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SELECTED_SYMBOLS,
  filterSupportedSymbols,
  normalizeSymbolInput,
  resolveSelectedSymbols,
} from "../src/constants/symbols.ts";

test("normalizes ticker inputs to USDT symbols", () => {
  assert.equal(normalizeSymbolInput("btc"), "BTCUSDT");
  assert.equal(normalizeSymbolInput("LINKUSDT"), "LINKUSDT");
});

test("rejects invalid ticker inputs", () => {
  assert.equal(normalizeSymbolInput("BTCUSDC"), null);
  assert.equal(normalizeSymbolInput("BTC-USDT"), null);
});

test("filters selected symbols by allowed subset", () => {
  const allowed = ["BTCUSDT", "LINKUSDT", "ETHUSDT"];
  const selected = filterSupportedSymbols(
    ["btc", "LINKUSDT", "ETH", "BTCUSDC", "bad-coin", "LINK"],
    allowed
  );
  assert.deepEqual(selected, ["BTCUSDT", "LINKUSDT", "ETHUSDT"]);
});

test("falls back to defaults when filtered selection is empty", () => {
  const allowed = ["BTCUSDT", "LINKUSDT", "ETHUSDT"];
  const selected = resolveSelectedSymbols(["BTCUSDC", "DOGE"], {
    allowedSymbols: allowed,
    fallbackSymbols: ["LINKUSDT"],
  });
  assert.deepEqual(selected, ["LINKUSDT"]);
});

test("supports LINK in user-selected flow and keeps legacy defaults", () => {
  const allowed = ["BTCUSDT", "LINKUSDT", "XAUTUSDT", "OPUSDT"];
  const selected = resolveSelectedSymbols(["LINK"], {
    allowedSymbols: allowed,
    fallbackSymbols: DEFAULT_SELECTED_SYMBOLS,
  });
  assert.deepEqual(selected, ["LINKUSDT"]);
  assert(DEFAULT_SELECTED_SYMBOLS.includes("XAUTUSDT"));
  assert(DEFAULT_SELECTED_SYMBOLS.includes("OPUSDT"));
});
