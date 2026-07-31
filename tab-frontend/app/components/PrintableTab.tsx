import { ChordEvent, TAB_NAMES } from "./chordTypes";
export function PrintableTab({ events, getFrets }: { events: ChordEvent[]; getFrets: (ev: ChordEvent, i: number) => Record<string, number | null> }) {
  if (events.length === 0) return null;

  const cols = events.map((ev, i) => getFrets(ev, i));
  const widths = cols.map((col) =>
    Math.max(...[1, 2, 3, 4, 5, 6].map((s) => String(col[String(s)] ?? "-").length)),
  );

  const header = events
    .map((ev, i) => (ev.chord_name && ev.chord_name !== events[i - 1]?.chord_name ? ev.chord_name : ""))
    .filter(Boolean)
    .join("  ");

  const FONT_SIZE = 12;
  const CHAR_WIDTH = FONT_SIZE * 0.6;
  const PAGE_WIDTH_IN = 8.5 - 1.5;
  const USABLE_PX = PAGE_WIDTH_IN * 96; 
  const PREFIX_CHARS = 2;
  const usableChars = Math.floor(USABLE_PX / CHAR_WIDTH) - PREFIX_CHARS;

  const chunks: number[][] = [];
  let current: number[] = [];
  let currentWidth = 0;
  cols.forEach((_, i) => {
    const colChars = widths[i] + 1; // +1 for the separating dash
    if (currentWidth + colChars > usableChars && current.length > 0) {
      chunks.push(current);
      current = [];
      currentWidth = 0;
    }
    current.push(i);
    currentWidth += colChars;
  });
  if (current.length > 0) chunks.push(current);

  return (
    <div className="print-only-tab">
      <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 16 }}>{header}</h2>
      {chunks.map((chunkIndices, chunkIdx) => (
        <pre
          key={chunkIdx}
          style={{
            fontFamily: "monospace",
            fontSize: FONT_SIZE,
            lineHeight: 1.6,
            whiteSpace: "pre",
            marginBottom: 16,
          }}
        >
          {[1, 2, 3, 4, 5, 6]
            .map((s) => {
              const cells = chunkIndices.map((i) => String(cols[i][String(s)] ?? "-").padEnd(widths[i], "-"));
              return TAB_NAMES[s] + "|-" + cells.join("-") + "-|";
            })
            .join("\n")}
        </pre>
      ))}
    </div>
  );
}