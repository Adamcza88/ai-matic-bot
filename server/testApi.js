// server/testApi.js
import fetch from "node-fetch";

const BASE = "http://localhost:4000";

async function call(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  const text = await res.text();
  console.log(`\n=== ${options.method || "GET"} ${path} ===`);
  console.log(text);
}

async function main() {
  try {
    // 1) Health check – ověří API klíče + spojení na Bybit time
    await call("/api/demo/health");

    // 2) Pozice – měl by vrátit prázdný list nebo aktuální pozice
    await call("/api/demo/positions");

    // 3) Testovací MARKET order na testnetu (nereálné peníze)
    //    – price necháváme prázdnou => skutečný market příkaz.
    await call("/api/demo/order", {
      method: "POST",
      body: JSON.stringify({
        symbol: "BTCUSDT",
        side: "Buy",
        qty: "0.001",
        // orderType, timeInForce, category necháme na výchozí logice serveru
      }),
    });

    console.log("\nTest hotov.");
  } catch (err) {
    console.error("\nTEST ERROR:");
    console.error(err);
  }
}

main();