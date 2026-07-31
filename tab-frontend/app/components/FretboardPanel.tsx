import { FretDiagram } from "./FretDiagram";
import { ChordEvent } from "./chordTypes";

export function FretboardPanel({
  event,
  zoom,
}: {
  event: ChordEvent | undefined;
  zoom: number;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center flex-shrink-0 p-6"
      style={{ borderRight: "1px solid #D8C4A0" }}
    >
      <FretDiagram event={event} zoom={zoom} />
      <p className="text-2xl font-black mt-3" style={{ color: "#D94827" }}>
        {event?.chord_name || ""}
      </p>
    </div>
  );
}