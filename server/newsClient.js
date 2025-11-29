// server/newsClient.js
import axios from "axios";
import "dotenv/config";

const CP_API_KEY = process.env.CRYPTOPANIC_API_KEY;

export function ensureNewsConfigured() {
  if (!CP_API_KEY) {
    throw new Error("Missing CRYPTOPANIC_API_KEY in .env");
  }
}

export async function fetchLatestNews() {
  ensureNewsConfigured();

  const url = "https://cryptopanic.com/api/v1/posts/";
  const params = {
    auth_token: CP_API_KEY,
    filter: "hot",
    kind: "news",
    public: true,
  };

  const res = await axios.get(url, { params });
  const data = res.data || {};
  const results = Array.isArray(data.results) ? data.results : [];

  // normalizace do jednoduchého formátu pro frontend
  const items = results.slice(0, 20).map((item) => {
    const votes = item.votes || {};
    let sentiment = "neutral";
    if (votes.positive > votes.negative) sentiment = "positive";
    else if (votes.negative > votes.positive) sentiment = "negative";

    return {
      id: String(item.id || item.url || item.published_at || Math.random()),
      headline: item.title || "Untitled",
      source: item.source?.title || "CryptoPanic",
      time: item.published_at || new Date().toISOString(),
      sentiment,
      url: item.url || "",
    };
  });

  return items;
}