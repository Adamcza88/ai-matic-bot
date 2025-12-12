// src/engine/networkConfig.ts
export function useNetworkConfig(useTestnet) {
    const httpBase = useTestnet
        ? "https://api-testnet.bybit.com"
        : "https://api.bybit.com";
    const wsBase = useTestnet
        ? "wss://stream-testnet.bybit.com/v5/public/linear"
        : "wss://stream.bybit.com/v5/public/linear";
    return {
        httpBase,
        wsBase,
    };
}
