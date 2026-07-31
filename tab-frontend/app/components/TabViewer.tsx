import { FretboardPanel } from "./FretboardPanel";
import { ChordEvent, STRING_COLORS, TAB_ROW_HEIGHT, TAB_NAMES } from "./chordTypes";

export function TabViewer({
  events,
  activeEvent,
  activeIndex,
  zoom,
  editMode,
  editedFrets,
  selectedAlt,
  editingCell,
  setEditingCell,
  getEffectiveFrets,
  commitFretEdit,
  cycleAlternative,
  handleColumnClick,
  tabScrollRef,
  columnRefs,
}: {
  events: ChordEvent[];
  activeEvent: ChordEvent | undefined;
  activeIndex: number;
  zoom: number;
  editMode: boolean;
  editedFrets: Record<number, Record<string, number | null>>;
  selectedAlt: Record<number, number>;
  editingCell: { index: number; string: number } | null;
  setEditingCell: (cell: { index: number; string: number } | null) => void;
  getEffectiveFrets: (ev: ChordEvent, index: number) => Record<string, number | null>;
  commitFretEdit: (index: number, stringNum: number, raw: string) => void;
  cycleAlternative: (index: number, altCount: number) => void;
  handleColumnClick: (ev: ChordEvent, e: React.MouseEvent) => void;
  tabScrollRef: React.RefObject<HTMLDivElement | null>;
  columnRefs: React.MutableRefObject<Record<number, HTMLDivElement | null>>;
}) {
  return (
    <div
      className="flex items-stretch mb-8 print-hide"
      style={{
        width: "100vw",
        marginLeft: "calc(50% - 50vw)",
        padding: "0 24px",
        boxSizing: "border-box",
      }}
    >
      <div
        className="flex items-stretch w-full"
        style={{
          background: "#FBF6EC",
          border: "2px solid #111",
          borderRadius: 8,
          boxShadow: "5px 5px 0 #111",
          overflow: "hidden",
        }}
      >
        <FretboardPanel event={activeEvent} zoom={zoom} />

        <div ref={tabScrollRef} className="p-6 relative overflow-x-auto flex-1 min-w-0">
          <div className="flex" style={{ minWidth: "max-content", position: "relative" }}>
            <div className="flex flex-col items-center px-2 py-1 mr-2">
              <div style={{ height: 22 * zoom }} />
              {[1, 2, 3, 4, 5, 6].map((s) => (
                <div
                  key={s}
                  className="handwrite text-lg flex items-center justify-center"
                  style={{ color: STRING_COLORS[s], height: TAB_ROW_HEIGHT * zoom }}
                >
                  {TAB_NAMES[s]}
                </div>
              ))}
            </div>

            {events.map((ev, i) => {
              const effectiveFrets = getEffectiveFrets(ev, i);
              const showLabel = !!ev.chord_name && ev.chord_name !== events[i - 1]?.chord_name;
              const altCount = ev.alternatives?.length ?? 1;

              return (
                <div
                  key={i}
                  ref={(el) => {
                    columnRefs.current[i] = el;
                  }}
                  className="flex flex-col items-center px-2 py-1 mx-0.5"
                  style={{ position: "relative" }}
                >
                  <div
                    className="handwrite"
                    style={{
                      height: 22 * zoom,
                      lineHeight: `${22 * zoom}px`,
                      fontSize: 16 * zoom,
                      color: "#8A342A",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {showLabel ? ev.chord_name : ""}
                  </div>

                  <button
                    onClick={(e) => handleColumnClick(ev, e)}
                    className="flex flex-col items-center"
                    style={{
                      position: "relative",
                      background: i === activeIndex ? "rgba(217,72,39,0.15)" : "transparent",
                      cursor: "pointer",
                      borderRadius: 4,
                      padding: "4px 8px",
                      margin: "0 -8px",
                    }}
                    title={ev.chord_name || undefined}
                  >
                    {[1, 2, 3, 4, 5, 6].map((s) => {
                      const val = effectiveFrets[String(s)];
                      const isEditing = editingCell?.index === i && editingCell?.string === s;

                      if (editMode && isEditing) {
                        return (
                          <input
                            key={s}
                            autoFocus
                            defaultValue={val === null || val === undefined ? "" : String(val)}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={(e) => commitFretEdit(i, s, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              if (e.key === "Escape") setEditingCell(null);
                            }}
                            style={{
                              width: 22,
                              height: TAB_ROW_HEIGHT * zoom,
                              fontSize: 12 * zoom,
                              textAlign: "center",
                              border: "1px solid #D94827",
                            }}
                          />
                        );
                      }

                      const isEdited = editedFrets[i]?.[String(s)] !== undefined;

                      return (
                        <div
                          key={s}
                          onClick={(e) => {
                            if (editMode) {
                              e.stopPropagation();
                              setEditingCell({ index: i, string: s });
                            }
                          }}
                          className="text-sm flex items-center justify-center"
                          style={{
                            fontFamily: "'SF Mono', Menlo, Consolas, monospace",
                            color: isEdited ? "#1D7A46" : STRING_COLORS[s],
                            height: TAB_ROW_HEIGHT * zoom,
                            fontSize: 13 * zoom,
                            cursor: editMode ? "text" : "pointer",
                            textDecoration: editMode ? "underline dotted" : "none",
                          }}
                        >
                          {val ?? "-"}
                        </div>
                      );
                    })}
                  </button>

                  {altCount > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        cycleAlternative(i, altCount);
                      }}
                      title={`voicing ${(selectedAlt[i] ?? 0) + 1}/${altCount} — click to cycle`}
                      className="mt-1"
                      style={{
                        color: "#9A8567",
                        background: "#F3EADC",
                        border: "1px solid #D8C4A0",
                        borderRadius: 4,
                        cursor: "pointer",
                        padding: "3px 5px",
                        display: "inline-flex",
                        alignItems: "center",
                        flexShrink: 0,
                        flexGrow: 0,
                        opacity: 0.75,
                        transition: "opacity 0.15s ease",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                      onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.75")}
                    >
                      <img
                        src="/swap.svg"
                        width={11}
                        height={11}
                        style={{ width: 11, height: 11, flexShrink: 0, opacity: 0.7 }}
                        alt="Cycle voicing"
                      />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}