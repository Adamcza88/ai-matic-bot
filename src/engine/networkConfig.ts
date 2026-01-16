// src/engine/networkConfig.ts

/**
 * Returns the Backend API prefix based on the network mode.
 * Enforces strict boolean check and logs the selection.
 */
export function getApiBase(useTestnet: boolean): string {
  // Strict validation: Must be explicitly true/false, not truthy/falsy
  if (useTestnet !== true && useTestnet !== false) {
    console.error(`[CRITICAL] Invalid useTestnet value: ${useTestnet}`);
    // Default to safer demo if unknown
    return "/api/demo";
  }

  const base = useTestnet === true ? "/api/demo" : "/api/main";
  console.info("[API ROUTE]", { useTestnet, base });
  return base;
}

export function useNetworkConfig(useTestnet: boolean) {
  const httpBase = useTestnet
    ? "https://api-demo.bybit.com"
    : "https://api.bybit.com";

  const wsBase = useTestnet
    ? "wss://stream.bybit.com/v5/public/linear"
    : "wss://stream.bybit.com/v5/public/linear";

  return {
    httpBase,
    wsBase,
  };
}
