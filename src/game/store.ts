export interface Blip {
  x: number;
  z: number;
  team: "alpha" | "bravo";
  bot: boolean;
  self?: boolean;
}

export interface HudState {
  health: number;
  alive: boolean;
  respawnIn: number;
  stance: 0 | 1 | 2;
  aiming: boolean;
  sprinting: boolean;
  weaponName: string;
  weaponClass: string;
  ammo: number;
  reserve: number;
  reloading: boolean;
  slot: 0 | 1;
  slots: { name: string; ammo: number; reserve: number }[];
  kills: number;
  deaths: number;
  scoreAlpha: number;
  scoreBravo: number;
  alivePlayers: number;
  killFeed: { id: number; text: string; team: string }[];
  backpack: { name: string; kind: string; count: number }[];
  prompt: string | null;
  fps: number;
  heading: number;
  blips: Blip[];
  playerX: number;
  playerZ: number;
  playerYaw: number;
  hitMarker: number;
  damageFlash: number;
  connection: string;
  loading: number;
}

export const initialHud: HudState = {
  health: 100,
  alive: true,
  respawnIn: 0,
  stance: 0,
  aiming: false,
  sprinting: false,
  weaponName: "M416",
  weaponClass: "AR",
  ammo: 30,
  reserve: 180,
  reloading: false,
  slot: 0,
  slots: [],
  kills: 0,
  deaths: 0,
  scoreAlpha: 0,
  scoreBravo: 0,
  alivePlayers: 0,
  killFeed: [],
  backpack: [],
  prompt: null,
  fps: 60,
  heading: 0,
  blips: [],
  playerX: 0,
  playerZ: 0,
  playerYaw: 0,
  hitMarker: 0,
  damageFlash: 0,
  connection: "offline",
  loading: 0,
};

export class HudStore {
  private state: HudState = { ...initialHud };
  private listeners = new Set<() => void>();

  getSnapshot = () => this.state;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  set(patch: Partial<HudState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  reset() {
    this.state = { ...initialHud };
    this.listeners.forEach((l) => l());
  }
}

export const hudStore = new HudStore();
