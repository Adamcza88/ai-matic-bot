import { useState } from "react";
import { TradingMode } from "./types";
import { useTradingBot } from "./hooks/useTradingBot";
import Dashboard from "./components/Dashboard";

export default function App() {
  const [mode, setMode] = useState<TradingMode>(TradingMode.OFF);
  const [useTestnet, setUseTestnet] = useState(true);

  const bot = useTradingBot(mode, useTestnet);

  return (
    <Dashboard
      mode={mode}
      setMode={setMode}
      useTestnet={useTestnet}
      setUseTestnet={setUseTestnet}
      bot={bot}
    />
  );
}