type Props = {
  message?: string;
};

export default function NotReleased({ message }: Props) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(circle at 20% 20%, #0f172a, #020617)",
        color: "white",
        textAlign: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          maxWidth: "520px",
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "16px",
          padding: "28px 32px",
          boxShadow: "0 20px 80px rgba(0,0,0,0.45)",
        }}
      >
        <h1 style={{ fontSize: "28px", marginBottom: "12px" }}>
          Not yet publicly released
        </h1>
        <p style={{ color: "rgba(255,255,255,0.8)" }}>
          Access is limited to the allowlisted testers right now.
        </p>
        {message && (
          <p style={{ color: "#fbbf24", marginTop: "12px", fontSize: "14px" }}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
