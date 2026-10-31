import { db } from "@/db";
import { rooms, roomPlayers } from "@/db/schema";
import { and, desc, eq, gt, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function GET() {
  const since = new Date(Date.now() - 1000 * 60 * 30);
  const list = await db
    .select()
    .from(rooms)
    .where(and(inArray(rooms.status, ["lobby", "playing"]), gt(rooms.updatedAt, since)))
    .orderBy(desc(rooms.updatedAt))
    .limit(30);

  const codes = list.map((r) => r.code);
  const members = codes.length
    ? await db.select().from(roomPlayers).where(inArray(roomPlayers.roomCode, codes))
    : [];

  return Response.json({
    rooms: list.map((r) => ({
      code: r.code,
      name: r.name,
      status: r.status,
      maxPerTeam: r.maxPerTeam,
      botsAlpha: r.botsAlpha,
      botsBravo: r.botsBravo,
      count: members.filter((m) => m.roomCode === r.code).length,
    })),
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    name?: string;
    playerId?: string;
    playerName?: string;
    maxPerTeam?: number;
    botsAlpha?: number;
    botsBravo?: number;
  };
  if (!body.playerId) return Response.json({ error: "playerId required" }, { status: 400 });

  let code = makeCode();
  for (let i = 0; i < 5; i++) {
    const existing = await db.select().from(rooms).where(eq(rooms.code, code)).limit(1);
    if (existing.length === 0) break;
    code = makeCode();
  }

  const seed = Math.floor(Math.random() * 100000);
  await db.insert(rooms).values({
    code,
    name: (body.name || "Operator Lobby").slice(0, 40),
    hostId: body.playerId,
    mapSeed: seed,
    maxPerTeam: Math.min(10, Math.max(1, body.maxPerTeam ?? 5)),
    botsAlpha: Math.min(12, Math.max(0, body.botsAlpha ?? 4)),
    botsBravo: Math.min(12, Math.max(0, body.botsBravo ?? 4)),
  });

  await db.insert(roomPlayers).values({
    roomCode: code,
    playerId: body.playerId,
    name: (body.playerName || "Host").slice(0, 18),
    team: "alpha",
    isHost: true,
  });

  return Response.json({ code, seed });
}
