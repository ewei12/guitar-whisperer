export function ShortcutsHint() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mb-4 px-1 print-hide" style={{ rowGap: 6 }}>
      <span className="flex items-center gap-1.5 text-xs whitespace-nowrap" style={{ color: "#8A7B63" }}>
        <kbd>Space</kbd> play / pause song
      </span>
      <span className="flex items-center gap-1.5 text-xs whitespace-nowrap" style={{ color: "#8A7B63" }}>
        <kbd>←</kbd>
        <kbd>→</kbd> chord
      </span>
      <span className="flex items-center gap-1.5 text-xs whitespace-nowrap" style={{ color: "#8A7B63" }}>
        <kbd>-</kbd>
        <kbd>+</kbd>
        zoom
      </span>
    </div>
  );
}