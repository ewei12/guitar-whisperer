export function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      className="mx-auto mb-8 flex items-start gap-3 px-5 py-4"
      style={{
        maxWidth: "460px",
        background: "#FBEAE3",
        border: "2px solid #8A342A",
        borderRadius: 8,
        boxShadow: "3px 3px 0 #8A342A",
      }}
    >
      <img src="/warning.png" alt="Warning" style={{ width: 20, height: 20, flexShrink: 0, marginTop: 1 }} />
      <div className="min-w-0">
        <p className="handwrite" style={{ fontSize: 14, fontWeight: 700, color: "#8A342A", marginBottom: 2 }}>
          can't use this file
        </p>
        <p style={{ fontSize: 13, color: "#7A3527" }}>{message}</p>
      </div>
      <button
        onClick={onDismiss}
        style={{
          marginLeft: "auto", background: "none", border: "none", color: "#8A342A",
          cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0, flexShrink: 0,
        }}
        aria-label="dismiss error"
      >
        ×
      </button>
    </div>
  );
}