import { db } from "@/db";
import { rooms, roomPlayers } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { loadRoom, roomInfo } from "@/lib/server/room";
import type { Team } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { code } = await ctx.params;
  const upper = code.toUpperCase();
  const body = (await req.json()) as { playerId: string; name?: string; team?: Team };
  if (!body.playerId) return Response.json({ error: "playerId required" }, { status: 400 });

  const room = await loadRoom(upper);
  if (!room) return Response.json({ error: "room not found" }, { status: 404 });
  if (room.status === "ended") return Response.json({ error: "room closed" }, { status: 410 });

  const members = await db.select().from(roomPlayers).where(eq(roomPlayers.roomCode, upper));
  const existing = members.find((m) => m.playerId === body.playerId);

  if (!existing) {
    const alpha = members.filter((m) => m.team === "alpha").length;
    const bravo = members.filter((m) => m.team === "bravo").length;
    let team: Team = body.team ?? (alpha <= bravo ? "alpha" : "bravo");
    if (team === "alpha" && alpha >= room.maxPerTeam) team = "bravo";
    else if (team === "bravo" && bravo >= room.maxPerTeam) team = "alpha";
    const teamCount = team === "alpha" ? alpha : bravo;
    if (teamCount >= room.maxPerTeam) return Response.json({ error: "room full" }, { status: 409 });

    await db.insert(roomPlayers).values({
      roomCode: upper,
      playerId: body.playerId,
      name: (body.name || "Operator").slice(0, 18),
      team,
      isHost: false,
    });
  } else {
    await db
      .update(roomPlayers)
      .set({ lastSeen: new Date(), name: (body.name || existing.name).slice(0, 18) })
      .where(and(eq(roomPlayers.roomCode, upper), eq(roomPlayers.playerId, body.playerId)));
  }

  await db.update(rooms).set({ updatedAt: new Date() }).where(eq(rooms.code, upper));
  return Response.json(await roomInfo(upper));
}
