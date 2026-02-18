const DASH = "—";

const CURRENCY_FORMATTERS: Record<string, Intl.NumberFormat> = {};

function getCurrencyFormatter(currency: string, locale = "cs-CZ") {
  const key = `${locale}:${currency}`;
  if (!CURRENCY_FORMATTERS[key]) {
    CURRENCY_FORMATTERS[key] = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return CURRENCY_FORMATTERS[key];
}

export function formatClock(value?: number | string | Date | null) {
  if (value == null) return DASH;
  const date =
    value instanceof Date
      ? value
      : typeof value === "number"
        ? new Date(value)
        : new Date(String(value));
  if (!Number.isFinite(date.getTime())) return DASH;
  return date.toLocaleTimeString("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatDate(value?: number | string | Date | null) {
  if (value == null) return DASH;
  const date =
    value instanceof Date
      ? value
      : typeof value === "number"
        ? new Date(value)
        : new Date(String(value));
  if (!Number.isFinite(date.getTime())) return DASH;
  return date.toLocaleDateString("cs-CZ");
}

export function formatMoney(value?: number, currency = "USD") {
  if (!Number.isFinite(value)) return DASH;
  return getCurrencyFormatter(currency).format(value as number);
}

export function formatSignedMoney(value?: number, currency = "USD") {
  if (!Number.isFinite(value)) return DASH;
  const amount = value as number;
  const sign = amount >= 0 ? "+" : "";
  return `${sign}${getCurrencyFormatter(currency).format(amount)}`;
}

export function formatPercentRatio(value?: number, fractionDigits = 2) {
  if (!Number.isFinite(value)) return DASH;
  return `${((value as number) * 100).toFixed(fractionDigits)} %`;
}

export function formatNumber(value?: number, fractionDigits = 2) {
  if (!Number.isFinite(value)) return DASH;
  return (value as number).toLocaleString("cs-CZ", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

export function formatMs(value?: number) {
  if (!Number.isFinite(value)) return DASH;
  return `${Math.round(value as number)} ms`;
}

