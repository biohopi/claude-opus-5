export interface ControlConfig {
  id: string;
  label: string;
  x: number; // 0..1 of viewport width (center)
  y: number; // 0..1 of viewport height (center)
  size: number; // px
  opacity: number;
  visible: boolean;
  shape?: "round" | "square";
}

export const DEFAULT_LAYOUT: ControlConfig[] = [
  { id: "stick", label: "MOVE", x: 0.13, y: 0.72, size: 150, opacity: 0.45, visible: true, shape: "round" },
  { id: "fire", label: "FIRE", x: 0.88, y: 0.74, size: 110, opacity: 0.55, visible: true, shape: "round" },
  { id: "aim", label: "ADS", x: 0.74, y: 0.78, size: 78, opacity: 0.5, visible: true, shape: "round" },
  { id: "scope", label: "SCOPE", x: 0.955, y: 0.45, size: 64, opacity: 0.5, visible: true, shape: "round" },
  { id: "jump", label: "JUMP", x: 0.74, y: 0.55, size: 72, opacity: 0.5, visible: true, shape: "round" },
  { id: "crouch", label: "CRCH", x: 0.64, y: 0.78, size: 66, opacity: 0.5, visible: true, shape: "round" },
  { id: "prone", label: "PRONE", x: 0.57, y: 0.9, size: 66, opacity: 0.5, visible: true, shape: "round" },
  { id: "reload", label: "RELOAD", x: 0.88, y: 0.93, size: 74, opacity: 0.5, visible: true, shape: "round" },
  { id: "swap", label: "SWAP", x: 0.74, y: 0.93, size: 70, opacity: 0.5, visible: true, shape: "round" },
  { id: "heal", label: "HEAL", x: 0.955, y: 0.6, size: 64, opacity: 0.5, visible: true, shape: "round" },
  { id: "interact", label: "PICK", x: 0.5, y: 0.72, size: 72, opacity: 0.5, visible: true, shape: "round" },
  { id: "sprint", label: "RUN", x: 0.28, y: 0.55, size: 70, opacity: 0.45, visible: true, shape: "round" },
  { id: "leanL", label: "LEAN<", x: 0.33, y: 0.9, size: 58, opacity: 0.4, visible: true, shape: "square" },
  { id: "leanR", label: ">LEAN", x: 0.43, y: 0.9, size: 58, opacity: 0.4, visible: true, shape: "square" },
];

const KEY = "arena_hud_layout_v1";

export function loadLayout(): ControlConfig[] {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_LAYOUT.map((c) => ({ ...c }));
    const parsed = JSON.parse(raw) as ControlConfig[];
    return DEFAULT_LAYOUT.map((d) => {
      const found = parsed.find((p) => p.id === d.id);
      return found ? { ...d, ...found } : { ...d };
    });
  } catch {
    return DEFAULT_LAYOUT.map((c) => ({ ...c }));
  }
}

export function saveLayout(layout: ControlConfig[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    /* storage unavailable */
  }
}

export interface Settings {
  quality: "low" | "medium" | "high";
  sensitivity: number;
  showTouch: boolean;
  name: string;
}

const SKEY = "arena_settings_v1";

export function loadSettings(): Settings {
  const fallback: Settings = {
    quality: "high",
    sensitivity: 1,
    showTouch: typeof window !== "undefined" && "ontouchstart" in window,
    name: "",
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(SKEY);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<Settings>) } : fallback;
  } catch {
    return fallback;
  }
}

export function saveSettings(s: Settings) {
  try {
    window.localStorage.setItem(SKEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function getPlayerId() {
  if (typeof window === "undefined") return "anon";
  let id = window.localStorage.getItem("arena_player_id");
  if (!id) {
    id = "p_" + Math.random().toString(36).slice(2, 10);
    window.localStorage.setItem("arena_player_id", id);
  }
  return id;
}
