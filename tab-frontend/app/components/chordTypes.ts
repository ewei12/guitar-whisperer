export type ChordEvent = {
  time: number;
  end_time: number;
  chord_name: string | null;
  frets: Record<string, number | null>;
  alternatives?: Record<string, number | null>[];
};

export const STRING_COLORS: Record<number, string> = {
  1: "#C98B3C",
  2: "#B7792C",
  3: "#8F5B24",
  4: "#65401C",
  5: "#3D2915",
  6: "#161616",
};

export const TAB_ROW_HEIGHT = 26; // base px at zoom = 1

export const TAB_NAMES: Record<number, string> = {
  1: "e",
  2: "B",
  3: "G",
  4: "D",
  5: "A",
  6: "E",
};