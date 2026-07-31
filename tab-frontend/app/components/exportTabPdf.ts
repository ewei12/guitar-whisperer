import jsPDF from "jspdf";
import { ChordEvent, TAB_NAMES } from "./chordTypes";

export function exportTabAsPDF(
  events: ChordEvent[],
  getEffectiveFrets: (ev: ChordEvent, index: number) => Record<string, number | null>,
) {
  if (events.length === 0) return;

  const cols = events.map((ev, i) => getEffectiveFrets(ev, i));
  const widths = cols.map((col) =>
    Math.max(...[1, 2, 3, 4, 5, 6].map((s) => String(col[String(s)] ?? "-").length)),
  );
  const header = events
    .map((ev, i) => (ev.chord_name && ev.chord_name !== events[i - 1]?.chord_name ? ev.chord_name : ""))
    .filter(Boolean)
    .join("  ");

  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const marginX = 40;
  const pageWidth = doc.internal.pageSize.getWidth() - marginX * 2;
  const fontSize = 10;
  doc.setFont("courier", "normal");
  doc.setFontSize(fontSize);

  const charWidth = doc.getTextWidth("0");
  const prefixChars = 2;
  const usableChars = Math.floor(pageWidth / charWidth) - prefixChars;

  const chunks: number[][] = [];
  let current: number[] = [];
  let currentWidth = 0;
  cols.forEach((_, i) => {
    const colChars = widths[i] + 1;
    if (currentWidth + colChars > usableChars && current.length > 0) {
      chunks.push(current);
      current = [];
      currentWidth = 0;
    }
    current.push(i);
    currentWidth += colChars;
  });
  if (current.length > 0) chunks.push(current);

  let y = 50;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(header || "Fretwork Tab", marginX, y);
  y += 24;

  doc.setFont("courier", "normal");
  doc.setFontSize(fontSize);
  const lineHeight = fontSize * 1.4;

  chunks.forEach((chunkIndices) => {
    if (y + lineHeight * 6 > doc.internal.pageSize.getHeight() - 40) {
      doc.addPage();
      y = 50;
    }
    [1, 2, 3, 4, 5, 6].forEach((s) => {
      const cells = chunkIndices.map((i) => String(cols[i][String(s)] ?? "-").padEnd(widths[i], "-"));
      const line = TAB_NAMES[s] + "|-" + cells.join("-") + "-|";
      doc.text(line, marginX, y);
      y += lineHeight;
    });
    y += lineHeight;
  });

  doc.save("fretwork-tab.pdf");
}