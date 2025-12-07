import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export default function NotReleased({ message }) {
    return (_jsx("div", { style: {
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "radial-gradient(circle at 20% 20%, #0f172a, #020617)",
            color: "white",
            textAlign: "center",
            padding: "24px",
        }, children: _jsxs("div", { style: {
                maxWidth: "520px",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "16px",
                padding: "28px 32px",
                boxShadow: "0 20px 80px rgba(0,0,0,0.45)",
            }, children: [_jsx("h1", { style: { fontSize: "28px", marginBottom: "12px" }, children: "Not yet publicly released" }), _jsx("p", { style: { color: "rgba(255,255,255,0.8)" }, children: "Access is limited to the allowlisted testers right now." }), message && (_jsx("p", { style: { color: "#fbbf24", marginTop: "12px", fontSize: "14px" }, children: message }))] }) }));
}
