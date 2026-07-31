import { useState } from "react";

export function TabControls({
  zoom,
  setZoom,
  editMode,
  setEditMode,
  hasEdits,
  onResetEdits,
  onExportPDF,
}: {
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  editMode: boolean;
  setEditMode: React.Dispatch<React.SetStateAction<boolean>>;
  hasEdits: boolean;
  onResetEdits: () => void;
  onExportPDF: () => void;
}) {
  const [confirmingReset, setConfirmingReset] = useState(false);

  return (
    <div
      className="p-4 mb-4 flex flex-wrap items-center gap-4 rounded-lg print-hide"
      style={{ background: "#FFFFFF" }}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-widest" style={{ color: "#666" }}>
          Zoom
        </span>
        <button
          onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.1) * 100) / 100))}
          style={{ border: "1px solid #111", background: "#fff", width: 24, cursor: "pointer" }}
        >
          -
        </button>
        <span className="text-xs" style={{ minWidth: 36, textAlign: "center" }}>
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 100) / 100))}
          style={{ border: "1px solid #111", background: "#fff", width: 24, cursor: "pointer" }}
        >
          +
        </button>
      </div>

      <button
        onClick={() => setEditMode((v) => !v)}
        className="text-xs px-2 py-1"
        style={{
          background: editMode ? "#1D7A46" : "#fff",
          color: editMode ? "#fff" : "#111",
          border: "1px solid #111",
          cursor: "pointer",
        }}
      >
        {editMode ? "editing tab" : "edit tab"}
      </button>

      {hasEdits && (
        <div style={{ minWidth: 96, display: "flex", alignItems: "center" }}>
          {!confirmingReset ? (
            <button
              onClick={() => setConfirmingReset(true)}
              className="text-xs px-2 py-1"
              style={{ border: "1px solid #8A342A", background: "#fff", color: "#8A342A", cursor: "pointer" }}
            >
              reset edits
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <span className="text-xs" style={{ color: "#8A342A" }}>sure?</span>
              <button
                onClick={() => {
                  onResetEdits();
                  setEditMode(false);
                  setConfirmingReset(false);
                }}
                aria-label="confirm discard"
                className="text-xs px-1.5 py-1"
                style={{ border: "1px solid #8A342A", background: "#8A342A", color: "#fff", cursor: "pointer" }}
              >
                ✓
              </button>
              <button
                onClick={() => setConfirmingReset(false)}
                aria-label="cancel"
                className="text-xs px-1.5 py-1"
                style={{ border: "1px solid #8A342A", background: "#fff", color: "#8A342A", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 ml-auto">
        <button
          onClick={onExportPDF}
          className="text-xs px-2 py-1"
          style={{ border: "1px solid #111", background: "#fff", cursor: "pointer" }}
        >
          export as pdf
        </button>
      </div>
    </div>
  );
}