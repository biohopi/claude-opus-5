import { db } from "@/db";
import { matchEvents, rooms, roomPlayers } from "@/db/schema";
import { and, eq, gt, sql } from "drizzle-orm";
import { loadRoom } from "@/lib/server/room";
import type { NetState, SyncResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ code: string }> };

interface Incoming {
  playerId: string;
  self: NetState;
  bots?: NetState[];
  events?: { type: string; payload: Record<string, unknown> }[];
  lastEventId?: number;
}

export async function POST(req: Request, ctx: Ctx) {
  const { code } = await ctx.params;
  const upper = code.toUpperCase();
  const body = (await req.json()) as Incoming;
  const room = await loadRoom(upper);
  if (!room) return Response.json({ error: "room not found" }, { status: 404 });

  const members = await db.select().from(roomPlayers).where(eq(roomPlayers.roomCode, upper));
  const me = members.find((m) => m.playerId === body.playerId);
  if (!me) return Response.json({ error: "not in room" }, { status: 403 });

  const isHost = room.hostId === body.playerId;

  // ---- persist my state (+ bot states if I am the host simulator) ----
  await db
    .update(roomPlayers)
    .set({
      state: { self: body.self, bots: isHost ? (body.bots ?? []) : [] } as Record<string, unknown>,
      lastSeen: new Date(),
    })
    .where(and(eq(roomPlayers.roomCode, upper), eq(roomPlayers.playerId, body.playerId)));

  // ---- apply authoritative combat events ----
  const outgoing: { type: string; payload: Record<string, unknown> }[] = [];
  for (const ev of body.events ?? []) {
    if (ev.type === "hit") {
      const targetId = String(ev.payload.target ?? "");
      const damage = Math.max(0, Math.min(200, Number(ev.payload.damage ?? 0)));
      const target = members.find((m) => m.playerId === targetId);
      if (target && target.alive) {
        const next = Math.max(0, target.health - damage);
        target.health = next;
        if (next <= 0) {
          target.alive = false;
          await db
            .update(roomPlayers)
            .set({ health: 0, alive: false, deaths: sql`${roomPlayers.deaths} + 1` })
            .where(and(eq(roomPlayers.roomCode, upper), eq(roomPlayers.playerId, targetId)));
          await db
            .update(roomPlayers)
            .set({ kills: sql`${roomPlayers.kills} + 1` })
            .where(and(eq(roomPlayers.roomCode, upper), eq(roomPlayers.playerId, body.playerId)));
          outgoing.push({
            type: "kill",
            payload: { killer: me.name, victim: target.name, weapon: ev.payload.weapon ?? "", victimId: targetId },
          });
        } else {
          await db
            .update(roomPlayers)
            .set({ health: next })
            .where(and(eq(roomPlayers.roomCode, upper), eq(roomPlayers.playerId, targetId)));
          outgoing.push({ type: "hit", payload: { target: targetId, damage, by: body.playerId } });
        }
      } else if (targetId.startsWith("bot:")) {
        outgoing.push({ type: "hit", payload: { target: targetId, damage, by: body.playerId } });
      }
    } else if (ev.type === "respawn") {
      await db
        .update(roomPlayers)
        .set({ health: 100, alive: true })
        .where(and(eq(roomPlayers.roomCode, upper), eq(roomPlayers.playerId, body.playerId)));
      me.health = 100;
      me.alive = true;
    } else if (ev.type === "heal") {
      const amount = Math.max(0, Math.min(100, Number(ev.payload.amount ?? 0)));
      const next = Math.min(100, me.health + amount);
      await db
        .update(roomPlayers)
        .set({ health: next })
        .where(and(eq(roomPlayers.roomCode, upper), eq(roomPlayers.playerId, body.playerId)));
      me.health = next;
    } else if (ev.type === "botkill") {
      await db
        .update(roomPlayers)
        .set({ kills: sql`${roomPlayers.kills} + 1` })
        .where(and(eq(roomPlayers.roomCode, upper), eq(roomPlayers.playerId, body.playerId)));
      outgoing.push({ type: "kill", payload: { killer: me.name, victim: ev.payload.victim ?? "Bot", weapon: ev.payload.weapon ?? "" } });
    } else if (ev.type === "chat" || ev.type === "system") {
      outgoing.push({ type: ev.type, payload: { ...ev.payload, from: me.name } });
    }
  }

  if (outgoing.length) {
    await db.insert(matchEvents).values(outgoing.map((e) => ({ roomCode: upper, type: e.type, payload: e.payload })));
  }

  // ---- build snapshot ----
  const fresh = await db.select().from(roomPlayers).where(eq(roomPlayers.roomCode, upper));
  const cutoff = Date.now() - 12000;
  const states: NetState[] = [];
  for (const m of fresh) {
    const raw = (m.state ?? {}) as { self?: NetState; bots?: NetState[] };
    if (m.playerId !== body.playerId && raw.self && m.lastSeen.getTime() > cutoff) {
      states.push({ ...raw.self, id: m.playerId, name: m.name, team: m.team as NetState["team"], health: m.health, alive: m.alive, kills: m.kills, deaths: m.deaths });
    }
    if (m.playerId === room.hostId && raw.bots && m.lastSeen.getTime() > cutoff && !isHost) {
      for (const b of raw.bots) states.push(b);
    }
  }

  const sinceId = Number(body.lastEventId ?? 0);
  const evs = await db
    .select()
    .from(matchEvents)
    .where(and(eq(matchEvents.roomCode, upper), gt(matchEvents.id, sinceId)))
    .orderBy(matchEvents.id)
    .limit(40);

  const freshMe = fresh.find((m) => m.playerId === body.playerId) ?? me;

  const scores = fresh.reduce(
    (acc, m) => {
      if (m.team === "alpha") acc.alpha += m.kills;
      else acc.bravo += m.kills;
      return acc;
    },
    { alpha: 0, bravo: 0 },
  );

  await db.update(rooms).set({ updatedAt: new Date() }).where(eq(rooms.code, upper));

  const payload: SyncResponse & { me: { health: number; alive: boolean; kills: number; deaths: number } } = {
    ok: true,
    status: room.status as SyncResponse["status"],
    mapSeed: room.mapSeed,
    serverTime: Date.now(),
    states,
    events: evs.map((e) => ({ id: e.id, type: e.type, payload: e.payload })),
    lastEventId: evs.length ? evs[evs.length - 1].id : sinceId,
    scores,
    me: {
      health: freshMe.health,
      alive: freshMe.alive,
      kills: freshMe.kills,
      deaths: freshMe.deaths,
    },
  };
  return Response.json(payload);
}
