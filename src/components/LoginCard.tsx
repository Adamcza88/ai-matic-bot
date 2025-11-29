type Props = {
  onLogin: () => void;
  isAuthenticating: boolean;
  error?: string;
};

export default function LoginCard({ onLogin, isAuthenticating, error }: Props) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(145deg, #0b1224, #0f172a)",
        color: "white",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "16px",
          padding: "28px 32px",
          boxShadow: "0 16px 60px rgba(0,0,0,0.45)",
        }}
      >
        <h1 style={{ fontSize: "26px", marginBottom: "8px" }}>
          Welcome back
        </h1>
        <p style={{ color: "rgba(255,255,255,0.75)", marginBottom: "20px" }}>
          Sign in with your allowlisted Google account to continue.
        </p>
        <button
          style={{
            width: "100%",
            background: "#22c55e",
            color: "#0b0f1a",
            border: "none",
            borderRadius: "10px",
            padding: "12px",
            fontSize: "16px",
            fontWeight: 600,
            cursor: "pointer",
            opacity: isAuthenticating ? 0.8 : 1,
          }}
          onClick={onLogin}
          disabled={isAuthenticating}
        >
          {isAuthenticating ? "Redirecting..." : "Continue with Google"}
        </button>
        {error && (
          <p
            style={{
              marginTop: "14px",
              color: "#f97316",
              fontSize: "14px",
            }}
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
