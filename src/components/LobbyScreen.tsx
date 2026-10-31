"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomInfo, Team } from "@/lib/types";

interface Props {
  playerId: string;
  playerName: string;
  onLaunch: (room: RoomInfo, team: Team) => void;
  onBack: () => void;
}

interface RoomBrief {
  code: string;
  name: string;
  status: string;
  maxPerTeam: number;
  botsAlpha: number;
  botsBravo: number;
  count: number;
}

export default function LobbyScreen({ playerId, playerName, onLaunch, onBack }: Props) {
  const [list, setList] = useState<RoomBrief[]>([]);
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const launched = useRef(false);

  const refreshList = useCallback(async () => {
    try {
      const res = await fetch("/api/rooms", { cache: "no-store" });
      const data = (await res.json()) as { rooms: RoomBrief[] };
      setList(data.rooms ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (room) return;
    void refreshList();
    const t = setInterval(refreshList, 3000);
    return () => clearInterval(t);
  }, [room, refreshList]);

  // poll the joined room
  useEffect(() => {
    if (!room) return;
    const code = room.code;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/rooms/${code}`, { cache: "no-store" });
        if (!res.ok) return;
        const info = (await res.json()) as RoomInfo;
        setRoom(info);
        const me = info.players.find((p) => p.playerId === playerId);
        if (info.status === "playing" && !launched.current) {
          launched.current = true;
          onLaunch(info, me?.team ?? "alpha");
        }
      } catch {
        /* ignore */
      }
    }, 1200);
    return () => clearInterval(t);
  }, [room, playerId, onLaunch]);

  const createRoom = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: `${playerName}'s Squad`,
          playerId,
          playerName,
          maxPerTeam: 5,
          botsAlpha: 4,
          botsBravo: 4,
        }),
      });
      const data = (await res.json()) as { code?: string; error?: string };
      if (!data.code) throw new Error(data.error ?? "failed");
      const info = await (await fetch(`/api/rooms/${data.code}`, { cache: "no-store" })).json();
      setRoom(info as RoomInfo);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const joinRoom = async (target: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/rooms/${target.toUpperCase()}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId, name: playerName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "join failed");
      setRoom(data as RoomInfo);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const patch = async (body: Record<string, unknown>) => {
    if (!room) return;
    const res = await fetch(`/api/rooms/${room.code}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId, ...body }),
    });
    if (res.ok) setRoom((await res.json()) as RoomInfo);
  };

  const leave = async () => {
    if (!room) return;
    await fetch(`/api/rooms/${room.code}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    setRoom(null);
  };

  const start = async () => {
    if (!room) return;
    setBusy(true);
    await fetch(`/api/rooms/${room.code}/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId }),
    });
    setBusy(false);
  };

  const isHost = room?.hostId === playerId;
  const me = room?.players.find((p) => p.playerId === playerId);

  return (
    <div className="absolute inset-0 overflow-auto bg-[radial-gradient(circle_at_30%_20%,#1e3b57,#070d14_60%)] p-5 text-slate-100">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-2xl font-black tracking-[0.3em] text-amber-300">MULTIPLAYER</h2>
          <button
            onClick={room ? leave : onBack}
            className="rounded-lg bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-widest hover:bg-white/20"
          >
            {room ? "Leave room" : "Back"}
          </button>
        </div>

        {error && <div className="mb-3 rounded-lg bg-red-500/20 px-4 py-2 text-xs text-red-200">{error}</div>}

        {!room && (
          <div className="grid gap-5 md:grid-cols-[1fr_320px]">
            <div className="rounded-2xl bg-slate-900/70 p-4 ring-1 ring-white/10">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.3em] text-slate-400">Open rooms</h3>
              <div className="space-y-2">
                {list.length === 0 && (
                  <p className="text-xs text-slate-400">No live rooms. Create one and share the code.</p>
                )}
                {list.map((r) => (
                  <div
                    key={r.code}
                    className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3 ring-1 ring-white/10"
                  >
                    <div>
                      <div className="text-sm font-bold">{r.name}</div>
                      <div className="text-[11px] text-slate-400">
                        {r.code} · {r.count}/{r.maxPerTeam * 2} players · {r.botsAlpha + r.botsBravo} bots ·{" "}
                        {r.status}
                      </div>
                    </div>
                    <button
                      disabled={busy}
                      onClick={() => joinRoom(r.code)}
                      className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-black uppercase text-slate-900 hover:bg-amber-300 disabled:opacity-50"
                    >
                      Join
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl bg-slate-900/70 p-4 ring-1 ring-white/10">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.3em] text-slate-400">Create room</h3>
                <button
                  disabled={busy}
                  onClick={createRoom}
                  className="w-full rounded-xl bg-amber-400 py-3 text-sm font-black uppercase tracking-widest text-slate-900 hover:bg-amber-300 disabled:opacity-50"
                >
                  Host new match
                </button>
              </div>
              <div className="rounded-2xl bg-slate-900/70 p-4 ring-1 ring-white/10">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.3em] text-slate-400">Join by code</h3>
                <div className="flex gap-2">
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 5))}
                    placeholder="ABCDE"
                    className="w-full rounded-lg bg-black/40 px-3 py-2 font-mono text-lg tracking-[0.4em] ring-1 ring-white/15 outline-none focus:ring-amber-400"
                  />
                  <button
                    disabled={busy || code.length < 4}
                    onClick={() => joinRoom(code)}
                    className="rounded-lg bg-white/10 px-4 text-xs font-bold uppercase hover:bg-white/20 disabled:opacity-40"
                  >
                    Go
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {room && (
          <div className="grid gap-5 md:grid-cols-[1fr_340px]">
            <div className="rounded-2xl bg-slate-900/70 p-4 ring-1 ring-white/10">
              <div className="mb-4 flex items-baseline justify-between">
                <h3 className="text-lg font-bold">{room.name}</h3>
                <span className="font-mono text-2xl tracking-[0.4em] text-amber-300">{room.code}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {(["alpha", "bravo"] as Team[]).map((team) => (
                  <div
                    key={team}
                    className={`rounded-xl p-3 ring-1 ${
                      team === "alpha" ? "bg-sky-500/10 ring-sky-400/30" : "bg-orange-500/10 ring-orange-400/30"
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className={`text-xs font-black uppercase tracking-[0.25em] ${team === "alpha" ? "text-sky-300" : "text-orange-300"}`}>
                        {team}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {room.players.filter((p) => p.team === team).length}/{room.maxPerTeam} +{" "}
                        {team === "alpha" ? room.botsAlpha : room.botsBravo} bots
                      </span>
                    </div>
                    <ul className="space-y-1 text-xs">
                      {room.players
                        .filter((p) => p.team === team)
                        .map((p) => (
                          <li key={p.playerId} className="flex items-center gap-2 rounded bg-black/25 px-2 py-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                            {p.name}
                            {p.isHost && <span className="ml-auto text-[10px] text-amber-300">HOST</span>}
                          </li>
                        ))}
                      {Array.from({ length: team === "alpha" ? room.botsAlpha : room.botsBravo }).map((_, i) => (
                        <li key={`bot${i}`} className="flex items-center gap-2 rounded bg-black/10 px-2 py-1 text-slate-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-500" /> AI Operator {i + 1}
                        </li>
                      ))}
                    </ul>
                    {me?.team !== team && (
                      <button
                        onClick={() => patch({ team })}
                        className="mt-2 w-full rounded-lg bg-white/10 py-1.5 text-[11px] font-bold uppercase hover:bg-white/20"
                      >
                        Switch to {team}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl bg-slate-900/70 p-4 ring-1 ring-white/10">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.3em] text-slate-400">
                  Match setup {isHost ? "" : "(host only)"}
                </h3>
                {([
                  ["Players per team", "maxPerTeam", room.maxPerTeam, 1, 10],
                  ["Alpha bots", "botsAlpha", room.botsAlpha, 0, 12],
                  ["Bravo bots", "botsBravo", room.botsBravo, 0, 12],
                ] as const).map(([label, key, value, min, max]) => (
                  <label key={key} className="mb-3 block text-xs">
                    <span className="flex justify-between">
                      {label} <span className="text-amber-300">{value}</span>
                    </span>
                    <input
                      type="range"
                      disabled={!isHost}
                      min={min}
                      max={max}
                      value={value}
                      onChange={(e) => patch({ [key]: Number(e.target.value) })}
                      className="mt-1 w-full accent-amber-400 disabled:opacity-40"
                    />
                  </label>
                ))}
                <div className="text-[11px] text-slate-400">Map seed #{room.mapSeed}</div>
              </div>

              <button
                disabled={!isHost || busy}
                onClick={start}
                className="w-full rounded-xl bg-emerald-400 py-4 text-base font-black uppercase tracking-[0.2em] text-slate-900 hover:bg-emerald-300 disabled:opacity-40"
              >
                {isHost ? "Start match" : "Waiting for host…"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
