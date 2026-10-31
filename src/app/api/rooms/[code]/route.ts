import { db } from "@/db";
import { rooms, roomPlayers } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { loadRoom, roomInfo } from "@/lib/server/room";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { code } = await ctx.params;
  const info = await roomInfo(code.toUpperCase());
  if (!info) return Response.json({ error: "room not found" }, { status: 404 });
  return Response.json(info);
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { code } = await ctx.params;
  const upper = code.toUpperCase();
  const body = (await req.json()) as {
    playerId: string;
    team?: "alpha" | "bravo";
    maxPerTeam?: number;
    botsAlpha?: number;
    botsBravo?: number;
  };
  const room = await loadRoom(upper);
  if (!room) return Response.json({ error: "room not found" }, { status: 404 });

  if (body.team) {
    await db
      .update(roomPlayers)
      .set({ team: body.team })
      .where(and(eq(roomPlayers.roomCode, upper), eq(roomPlayers.playerId, body.playerId)));
  }

  if (room.hostId === body.playerId) {
    const patch: Record<string, number | Date> = { updatedAt: new Date() };
    if (typeof body.maxPerTeam === "number") patch.maxPerTeam = Math.min(10, Math.max(1, body.maxPerTeam));
    if (typeof body.botsAlpha === "number") patch.botsAlpha = Math.min(12, Math.max(0, body.botsAlpha));
    if (typeof body.botsBravo === "number") patch.botsBravo = Math.min(12, Math.max(0, body.botsBravo));
    await db.update(rooms).set(patch).where(eq(rooms.code, upper));
  }

  return Response.json(await roomInfo(upper));
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { code } = await ctx.params;
  const upper = code.toUpperCase();
  const body = (await req.json().catch(() => ({}))) as { playerId?: string };
  if (!body.playerId) return Response.json({ error: "playerId required" }, { status: 400 });

  await db
    .delete(roomPlayers)
    .where(and(eq(roomPlayers.roomCode, upper), eq(roomPlayers.playerId, body.playerId)));

  const room = await loadRoom(upper);
  if (room && room.hostId === body.playerId) {
    await db.update(rooms).set({ status: "ended", updatedAt: new Date() }).where(eq(rooms.code, upper));
  }
  return Response.json({ ok: true });
}
