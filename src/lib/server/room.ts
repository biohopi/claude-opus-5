import { db } from "@/db";
import { rooms, roomPlayers } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { RoomInfo, Team } from "@/lib/types";

export async function loadRoom(code: string) {
  const [room] = await db.select().from(rooms).where(eq(rooms.code, code)).limit(1);
  return room ?? null;
}

export async function roomInfo(code: string): Promise<RoomInfo | null> {
  const room = await loadRoom(code);
  if (!room) return null;
  const members = await db.select().from(roomPlayers).where(eq(roomPlayers.roomCode, code));
  return {
    code: room.code,
    name: room.name,
    hostId: room.hostId,
    status: room.status as RoomInfo["status"],
    mapSeed: room.mapSeed,
    maxPerTeam: room.maxPerTeam,
    botsAlpha: room.botsAlpha,
    botsBravo: room.botsBravo,
    players: members
      .sort((a, b) => a.id - b.id)
      .map((m) => ({
        playerId: m.playerId,
        name: m.name,
        team: m.team as Team,
        isHost: m.isHost,
        kills: m.kills,
        deaths: m.deaths,
        alive: m.alive,
      })),
  };
}
