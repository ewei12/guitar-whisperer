export function DropOverlay({ isDragging }: { isDragging: boolean }) {
  if (!isDragging) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "#e3c3bc",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          background: "#fffbf7",
          border: "3px solid #111",
          padding: "24px 40px",
          fontFamily: "var(--font-stack-notch)",
          fontSize: 24,
          fontWeight: 800,
          color: "#111",
        }}
      >
        drop your audio file
      </div>
    </div>
  );
}