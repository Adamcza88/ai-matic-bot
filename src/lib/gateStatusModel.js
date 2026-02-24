const isWaitingContext = (diag) => {
    if (!diag)
        return true;
    if (diag.relayState === "WAITING")
        return true;
    if (diag.executionAllowed == null)
        return true;
    if (diag.signalActive === false)
        return true;
    return false;
};
export const resolveGateDisplayStatus = ({ gate, enabled, diag, }) => {
    if (!enabled)
        return "DISABLED";
    if ((gate?.ok) === true)
        return "ALLOWED";
    if ((gate?.ok) === false)
        return "BLOCKED";
    if (isWaitingContext(diag))
        return "WAITING";
    return "WAITING";
};
export const buildGateDisplayRows = ({ diag, profileGateNames, checklistEnabled, waitingDetail = "čeká na vyhodnocení gate", noDetail = "bez detailu", }) => {
    const gateMap = new Map();
    const diagGates = Array.isArray(diag?.gates) ? diag.gates : [];
    for (const gate of diagGates) {
        if (!gate?.name)
            continue;
        gateMap.set(gate.name, gate);
    }
    return profileGateNames.map((name) => {
        const enabled = checklistEnabled[name] ?? true;
        const gate = gateMap.get(name);
        const status = resolveGateDisplayStatus({ gate, enabled, diag });
        const detail = gate?.detail?.trim() || (status === "WAITING" ? waitingDetail : noDetail);
        return {
            name,
            status,
            detail,
            enabled,
        };
    });
};
