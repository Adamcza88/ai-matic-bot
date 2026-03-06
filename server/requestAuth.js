function firstNonEmpty(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim()) return item;
      }
      continue;
    }
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function readHeader(req, name) {
  const headers = req?.headers;
  if (!headers) return "";

  if (typeof headers.get === "function") {
    return firstNonEmpty(
      headers.get(name),
      headers.get(name.toLowerCase()),
      headers.get(name.toUpperCase())
    );
  }

  return firstNonEmpty(
    headers[name],
    headers[name.toLowerCase()],
    headers[name.toUpperCase()]
  );
}

function normalizeToken(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const bearer = /^Bearer\s+(.+)$/i.exec(trimmed);
  if (bearer) {
    const extracted = bearer[1]?.trim();
    return extracted || null;
  }

  return trimmed;
}

export function extractRequestToken(req) {
  const fromAuthorization = normalizeToken(readHeader(req, "authorization"));
  if (fromAuthorization) return fromAuthorization;

  const fromCustomHeader = normalizeToken(readHeader(req, "x-auth-token"));
  if (fromCustomHeader) return fromCustomHeader;

  return null;
}
