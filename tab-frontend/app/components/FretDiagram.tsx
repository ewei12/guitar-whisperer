import { ChordEvent, STRING_COLORS, TAB_ROW_HEIGHT } from "./chordTypes";
export function FretDiagram({
  event,
  zoom = 1,
}: {
  event: ChordEvent | undefined;
  zoom?: number;
}) {
  const width = 230;
  const rightMargin = 14;
  const nutX = 46;
  const numFretsShown = 4;
  const stringOrder = [1, 2, 3, 4, 5, 6];
  const INLAY_FRETS = [3, 5, 7, 9, 12, 15];

  const stringGap = TAB_ROW_HEIGHT * zoom;
  const topMargin = 22 * zoom + stringGap / 2;
  const bottomMargin = 24;
  const markerMargin = 22;
  const height =
    topMargin + stringGap * (stringOrder.length - 1) + bottomMargin;

  const fretGap = (width - nutX - rightMargin) / numFretsShown;

  const frets = event?.frets;
  const fretValues = frets
    ? (Object.values(frets).filter((f) => f !== null && f > 0) as number[])
    : [];
  const maxFret = fretValues.length ? Math.max(...fretValues) : 0;
  const baseFret = maxFret > numFretsShown ? Math.min(...fretValues) - 1 : 0;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {INLAY_FRETS.map((f) => {
        const rel = f - baseFret;
        if (rel < 1 || rel > numFretsShown) return null;
        const x = nutX + fretGap * (rel - 0.5);
        const midY = topMargin + (height - topMargin - bottomMargin) / 2;
        if (f === 12 || f === 24) {
          return (
            <g key={f}>
              <circle
                cx={x}
                cy={midY - 12}
                r={3.5}
                fill="#B89568"
                opacity={0.6}
              />
              <circle
                cx={x}
                cy={midY + 12}
                r={3.5}
                fill="#B89568"
                opacity={0.6}
              />
            </g>
          );
        }
        return (
          <circle
            key={f}
            cx={x}
            cy={midY}
            r={3.5}
            fill="#B89568"
            opacity={0.6}
          />
        );
      })}

      <line
        x1={nutX}
        y1={topMargin}
        x2={nutX}
        y2={height - bottomMargin}
        stroke="#2A1B10"
        strokeWidth={baseFret === 0 ? 5 : 1.5}
      />
      {Array.from({ length: numFretsShown }).map((_, i) => (
        <line
          key={i}
          x1={nutX + fretGap * (i + 1)}
          y1={topMargin}
          x2={nutX + fretGap * (i + 1)}
          y2={height - bottomMargin}
          stroke="#A88356"
          strokeWidth={1.5}
        />
      ))}

      {stringOrder.map((s, idx) => {
        const y = topMargin + idx * stringGap;
        return (
          <line
            key={s}
            x1={nutX}
            y1={y}
            x2={width - rightMargin}
            y2={y}
            stroke={STRING_COLORS[s]}
            strokeWidth={idx > 2 ? 2.6 : 1.6}
          />
        );
      })}

      {frets &&
        stringOrder.map((s, idx) => {
          const y = topMargin + idx * stringGap;
          const fret = frets[String(s)];
          if (fret === null || fret === undefined) {
            return (
              <text
                key={`m-${s}`}
                x={markerMargin}
                y={y + 4}
                textAnchor="middle"
                fontSize={13}
                fill="#8A342A"
              >
                ×
              </text>
            );
          }
          if (fret === 0) {
            return (
              <circle
                key={`o-${s}`}
                cx={markerMargin}
                cy={y}
                r={5}
                fill="none"
                stroke="#2A1B10"
                strokeWidth={1.5}
              />
            );
          }
          const relFret = fret - baseFret;
          const x = nutX + fretGap * (relFret - 0.5);
          return (
            <g key={`d-${s}`}>
              <circle cx={x} cy={y} r={9} fill={STRING_COLORS[s]} />
              <text
                x={x}
                y={y + 3.5}
                textAnchor="middle"
                fontSize={9}
                fill="#fff"
                fontWeight={600}
              >
                {fret}
              </text>
            </g>
          );
        })}

      {baseFret > 0 && (
        <text
          x={nutX + fretGap * 0.5}
          y={height - 12}
          textAnchor="middle"
          fontSize={11}
          fill="#7A6A56"
        >
          {baseFret + 1}fr
        </text>
      )}
    </svg>
  );
}