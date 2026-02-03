import { computeATR } from "./botEngine";

type HMMModel = {
  pi: number[];
  a: number[][];
  means: number[][];
  vars: number[][];
  lastTrainedIndex: number;
};

const hmmBySymbol = new Map<string, HMMModel>();

function logSumExp(arr: number[]) {
  const max = Math.max(...arr);
  const sum = arr.reduce((acc, v) => acc + Math.exp(v - max), 0);
  return max + Math.log(sum);
}

function gaussianLogPdf(x: number, mean: number, variance: number) {
  const v = variance > 1e-8 ? variance : 1e-8;
  const diff = x - mean;
  return -0.5 * (Math.log(2 * Math.PI * v) + (diff * diff) / v);
}

function initHMM(obs: number[][], states = 3) {
  const dims = obs[0].length;
  const returns = obs.map((o) => o[0]).slice().sort((a, b) => a - b);
  const q1 = returns[Math.floor(returns.length * 0.2)] ?? 0;
  const q2 = returns[Math.floor(returns.length * 0.5)] ?? 0;
  const q3 = returns[Math.floor(returns.length * 0.8)] ?? 0;
  const means = [
    [q1, 0, 0],
    [q2, 0, 0],
    [q3, 0, 0],
  ].slice(0, states);
  const vars = Array.from({ length: states }, () =>
    Array.from({ length: dims }, () => 1)
  );
  return {
    pi: Array.from({ length: states }, () => 1 / states),
    a: Array.from({ length: states }, () =>
      Array.from({ length: states }, () => 1 / states)
    ),
    means,
    vars,
    lastTrainedIndex: 0,
  };
}

function baumWelch(obs: number[][], model: HMMModel, iterations = 5) {
  const T = obs.length;
  const N = model.pi.length;
  const D = obs[0].length;
  let pi = model.pi.slice();
  let a = model.a.map((row) => row.slice());
  let means = model.means.map((row) => row.slice());
  let vars = model.vars.map((row) => row.slice());

  for (let iter = 0; iter < iterations; iter++) {
    const logB = Array.from({ length: T }, () => Array(N).fill(0));
    for (let t = 0; t < T; t++) {
      for (let i = 0; i < N; i++) {
        let lp = 0;
        for (let d = 0; d < D; d++) {
          lp += gaussianLogPdf(obs[t][d], means[i][d], vars[i][d]);
        }
        logB[t][i] = lp;
      }
    }

    const logAlpha = Array.from({ length: T }, () => Array(N).fill(0));
    for (let i = 0; i < N; i++) {
      logAlpha[0][i] = Math.log(pi[i]) + logB[0][i];
    }
    for (let t = 1; t < T; t++) {
      for (let j = 0; j < N; j++) {
        const prev = logAlpha[t - 1].map((v, i) => v + Math.log(a[i][j]));
        logAlpha[t][j] = logB[t][j] + logSumExp(prev);
      }
    }

    const logBeta = Array.from({ length: T }, () => Array(N).fill(0));
    for (let t = T - 2; t >= 0; t--) {
      for (let i = 0; i < N; i++) {
        const vals = [];
        for (let j = 0; j < N; j++) {
          vals.push(Math.log(a[i][j]) + logB[t + 1][j] + logBeta[t + 1][j]);
        }
        logBeta[t][i] = logSumExp(vals);
      }
    }

    const logGamma = Array.from({ length: T }, () => Array(N).fill(0));
    const logXi = Array.from({ length: T - 1 }, () =>
      Array.from({ length: N }, () => Array(N).fill(0))
    );
    for (let t = 0; t < T; t++) {
      const denom = logSumExp(
        logAlpha[t].map((v, i) => v + logBeta[t][i])
      );
      for (let i = 0; i < N; i++) {
        logGamma[t][i] = logAlpha[t][i] + logBeta[t][i] - denom;
      }
    }
    for (let t = 0; t < T - 1; t++) {
      const denom = logSumExp(
        Array.from({ length: N * N }, (_, k) => {
          const i = Math.floor(k / N);
          const j = k % N;
          return (
            logAlpha[t][i] +
            Math.log(a[i][j]) +
            logB[t + 1][j] +
            logBeta[t + 1][j]
          );
        })
      );
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          logXi[t][i][j] =
            logAlpha[t][i] +
            Math.log(a[i][j]) +
            logB[t + 1][j] +
            logBeta[t + 1][j] -
            denom;
        }
      }
    }

    const gamma = logGamma.map((row) => row.map((v) => Math.exp(v)));
    const xi = logXi.map((row) =>
      row.map((col) => col.map((v) => Math.exp(v)))
    );

    pi = gamma[0].slice();
    for (let i = 0; i < N; i++) {
      const denom =
        gamma.slice(0, T - 1).reduce((s, g) => s + g[i], 0) || 1e-8;
      for (let j = 0; j < N; j++) {
        const numer = xi.reduce((s, m) => s + m[i][j], 0);
        a[i][j] = numer / denom;
      }
    }
    for (let i = 0; i < N; i++) {
      const weight = gamma.reduce((s, g) => s + g[i], 0) || 1e-8;
      for (let d = 0; d < D; d++) {
        let num = 0;
        for (let t = 0; t < T; t++) num += gamma[t][i] * obs[t][d];
        means[i][d] = num / weight;
      }
      for (let d = 0; d < D; d++) {
        let num = 0;
        for (let t = 0; t < T; t++) {
          const diff = obs[t][d] - means[i][d];
          num += gamma[t][i] * diff * diff;
        }
        vars[i][d] = num / weight;
      }
    }
  }

  return { pi, a, means, vars };
}

function normalizeStateByVol(means: number[][]) {
  const scores = means.map((m) => Math.abs(m[0]));
  const order = scores
    .map((v, i) => ({ v, i }))
    .sort((a, b) => a.v - b.v)
    .map((x) => x.i);
  return order;
}

export function computeHurst(closes: number[], window = 100) {
  if (closes.length < window) return Number.NaN;
  const slice = closes.slice(-window);
  const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
  let cum = 0;
  let min = 0;
  let max = 0;
  for (const v of slice) {
    cum += v - mean;
    min = Math.min(min, cum);
    max = Math.max(max, cum);
  }
  const range = max - min;
  const variance =
    slice.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / slice.length;
  const std = Math.sqrt(variance);
  if (!Number.isFinite(range) || !Number.isFinite(std) || std === 0) {
    return Number.NaN;
  }
  return Math.log(range / std) / Math.log(window);
}

export function computeChop(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
) {
  if (closes.length < period + 1) return Number.NaN;
  const tr: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const high = highs[i];
    const low = lows[i];
    const prevClose = closes[i - 1];
    const range = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    tr.push(range);
  }
  const trSlice = tr.slice(-period);
  const sumTr = trSlice.reduce((s, v) => s + v, 0);
  const highMax = Math.max(...highs.slice(-period));
  const lowMin = Math.min(...lows.slice(-period));
  const denom = highMax - lowMin;
  if (!Number.isFinite(sumTr) || !Number.isFinite(denom) || denom <= 0) {
    return Number.NaN;
  }
  return (100 * Math.log10(sumTr / denom)) / Math.log10(period);
}

export function analyzeRegimePro(args: {
  symbol: string;
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  hurstWindow?: number;
  chopPeriod?: number;
  hmmUpdateEvery?: number;
  vpin: number;
  ofi: number;
  delta: number;
}) {
  const {
    symbol,
    closes,
    highs,
    lows,
    volumes,
    hurstWindow = 100,
    chopPeriod = 14,
    hmmUpdateEvery = 50,
    vpin,
    ofi,
    delta,
  } = args;
  const hurst = computeHurst(closes, hurstWindow);
  const chop = computeChop(highs, lows, closes, chopPeriod);
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const atrArr = computeATR(highs, lows, closes, 14);
  const atr = atrArr.length ? atrArr[atrArr.length - 1] : Number.NaN;
  const atrPct = Number.isFinite(atr) && closes.length
    ? atr / closes[closes.length - 1]
    : Number.NaN;
  const volSlice = volumes.slice(-30);
  const volAvg =
    volSlice.reduce((s, v) => s + v, 0) / Math.max(1, volSlice.length);
  const volChange =
    volAvg > 0 ? (volumes[volumes.length - 1] - volAvg) / volAvg : 0;

  const obsWindow = Math.min(100, returns.length);
  const obs: number[][] = [];
  for (let i = returns.length - obsWindow; i < returns.length; i++) {
    if (i <= 0) continue;
    obs.push([
      returns[i],
      Number.isFinite(atrPct) ? atrPct : 0,
      volChange,
    ]);
  }
  let model = hmmBySymbol.get(symbol);
  if (!model && obs.length >= 20) {
    model = initHMM(obs, 3);
  }
  if (model && obs.length >= 20) {
    const needsUpdate =
      obs.length - model.lastTrainedIndex >= hmmUpdateEvery;
    if (needsUpdate) {
      const fitted = baumWelch(obs, model, 5);
      model = {
        ...model,
        pi: fitted.pi,
        a: fitted.a,
        means: fitted.means,
        vars: fitted.vars,
        lastTrainedIndex: obs.length,
      };
    }
    hmmBySymbol.set(symbol, model);
  }

  let hmmProb = 0;
  let hmmState = 0;
  let shock = false;
  if (model && obs.length >= 5) {
    const last = obs[obs.length - 1];
    const N = model.pi.length;
    const logProb = [];
    for (let i = 0; i < N; i++) {
      let lp = Math.log(model.pi[i]);
      for (let d = 0; d < last.length; d++) {
        lp += gaussianLogPdf(last[d], model.means[i][d], model.vars[i][d]);
      }
      logProb.push(lp);
    }
    const norm = logSumExp(logProb);
    const probs = logProb.map((v) => Math.exp(v - norm));
    const order = normalizeStateByVol(model.means);
    const lowVolIdx = order[0];
    const highVolIdx = order[order.length - 1];
    hmmProb = probs[lowVolIdx];
    hmmState = lowVolIdx;
    shock = probs[highVolIdx] >= 0.7;
  }

  const regimeOk =
    Number.isFinite(hurst) &&
    hurst < 0.45 &&
    Number.isFinite(chop) &&
    chop > 60 &&
    hmmProb >= 0.7 &&
    vpin < 0.8;

  return { hurst, chop, hmmProb, hmmState, regimeOk, shock, vpin, ofi, delta };
}

