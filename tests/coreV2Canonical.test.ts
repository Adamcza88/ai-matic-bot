import test from 'node:test';
import assert from 'node:assert/strict';
import type { Candle } from '../src/engine/botEngine';
import { computeCoreV2, resolveCoreV2Params } from '../src/engine/coreV2';

function buildCandles(count: number, tfMin: number, startMs = Date.UTC(2026, 0, 1)): Candle[] {
  const out: Candle[] = [];
  const tfMs = tfMin * 60_000;
  let price = 100;
  for (let i = 0; i < count; i += 1) {
    const drift = (i % 11 === 0 ? -0.18 : 0.22) + Math.sin(i / 20) * 0.03;
    const range = 0.35 + (i % 7) * 0.02;
    const open = price;
    const close = price + drift;
    const high = Math.max(open, close) + range;
    const low = Math.min(open, close) - range;
    const volume = 100 + (i % 50) * 3 + (i % 24 === 0 ? 40 : 0);
    out.push({
      openTime: startMs + i * tfMs,
      open,
      high,
      low,
      close,
      volume,
    });
    price = close;
  }
  return out;
}

test('coreV2 params map ai-matic-x to active mode timeframe', () => {
  const p = resolveCoreV2Params('ai-matic-x');
  assert.equal(p.ltfMin, 5);
  assert.equal(p.htfMin, 60);
});

test('coreV2 params map all strategy profiles to expected timeframe pairs', () => {
  const expected: Record<string, { ltf: number; htf: number }> = {
    'ai-matic': { ltf: 5, htf: 60 },
    'ai-matic-tree': { ltf: 5, htf: 60 },
    'ai-matic-amd': { ltf: 5, htf: 60 },
    'ai-matic-olikella': { ltf: 5, htf: 60 },
    'ai-matic-bbo': { ltf: 5, htf: 60 },
    'ai-matic-pro': { ltf: 5, htf: 60 },
    'ai-matic-scalp': { ltf: 3, htf: 60 },
  };
  for (const [riskMode, pair] of Object.entries(expected)) {
    const p = resolveCoreV2Params(riskMode as any);
    assert.deepEqual({ ltf: p.ltfMin, htf: p.htfMin }, pair);
    assert.equal(p.m15Min, 5);
  }
});

test('computeCoreV2 uses mapped timeframe in output snapshot', () => {
  const candles = buildCandles(10_000, 1);
  const x = computeCoreV2(candles, { riskMode: 'ai-matic-x' as any });
  const bbo = computeCoreV2(candles, { riskMode: 'ai-matic-bbo' as any });
  assert.equal(x.ltfTimeframeMin, 5);
  assert.equal(x.htfTimeframeMin, 60);
  assert.equal(bbo.ltfTimeframeMin, 5);
  assert.equal(bbo.htfTimeframeMin, 60);
});

test('computeCoreV2 builds ToD baseline without fallback when 20d slot history exists', () => {
  const candles = buildCandles(6000, 5);
  const last = candles[candles.length - 1];
  const core = computeCoreV2(candles, {
    riskMode: 'ai-matic' as any,
    nowMs: last.openTime + 5 * 60_000,
  });
  assert.equal(core.volumeTodFallback, false);
  assert.ok(core.volumeTodSampleCount >= 10);
  assert.ok(Number.isFinite(core.volumeTodRatio));
});

test('computeCoreV2 falls back ToD baseline when slot sample count is insufficient', () => {
  const candles = buildCandles(800, 5);
  const last = candles[candles.length - 1];
  const core = computeCoreV2(candles, {
    riskMode: 'ai-matic' as any,
    nowMs: last.openTime + 5 * 60_000,
  });
  assert.equal(core.volumeTodFallback, true);
  assert.ok(core.volumeTodSampleCount < 10);
  assert.ok(Number.isFinite(core.volumeTodRatio));
});
