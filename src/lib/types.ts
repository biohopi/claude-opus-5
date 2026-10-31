export type Team = "alpha" | "bravo";
export type Stance = 0 | 1 | 2; // stand | crouch | prone

export interface NetState {
  id: string;
  name: string;
  team: Team;
  bot: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  stance: Stance;
  speed: number;
  aiming: boolean;
  firing: boolean;
  health: number;
  alive: boolean;
  weapon: string;
  kills: number;
  deaths: number;
  t: number;
}

export interface MatchEvent {
  id: number;
  type: string;
  payload: Record<string, unknown>;
}

export interface LobbyPlayer {
  playerId: string;
  name: string;
  team: Team;
  isHost: boolean;
  kills: number;
  deaths: number;
  alive: boolean;
}

export interface RoomInfo {
  code: string;
  name: string;
  hostId: string;
  status: "lobby" | "playing" | "ended";
  mapSeed: number;
  maxPerTeam: number;
  botsAlpha: number;
  botsBravo: number;
  players: LobbyPlayer[];
}

export interface SyncResponse {
  ok: boolean;
  status: RoomInfo["status"];
  mapSeed: number;
  serverTime: number;
  states: NetState[];
  events: MatchEvent[];
  lastEventId: number;
  scores: { alpha: number; bravo: number };
}
