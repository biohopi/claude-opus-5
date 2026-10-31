import { db } from "@/db";
import { matchEvents, rooms, roomPlayers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { loadRoom, roomInfo } from "@/lib/server/room";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { code } = await ctx.params;
  const upper = code.toUpperCase();
  const body = (await req.json()) as { playerId: string };
  const room = await loadRoom(upper);
  if (!room) return Response.json({ error: "room not found" }, { status: 404 });
  if (room.hostId !== body.playerId)
    return Response.json({ error: "only the host can start" }, { status: 403 });

  await db
    .update(rooms)
    .set({ status: "playing", startedAt: new Date(), updatedAt: new Date() })
    .where(eq(rooms.code, upper));

  await db
    .update(roomPlayers)
    .set({ health: 100, alive: true, kills: 0, deaths: 0 })
    .where(eq(roomPlayers.roomCode, upper));

  await db.insert(matchEvents).values({
    roomCode: upper,
    type: "system",
    payload: { message: "Match started", seed: room.mapSeed },
  });

  return Response.json(await roomInfo(upper));
}
