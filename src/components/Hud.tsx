"use client";

import { useSyncExternalStore, useState } from "react";
import { hudStore, initialHud } from "@/game/store";

interface Props {
  onPause: () => void;
  onFullscreen: () => void;
  mode: "offline" | "online";
  roomCode?: string;
}

const MAP_RANGE = 90;

export default function Hud({ onPause, onFullscreen, mode, roomCode }: Props) {
  const hud = useSyncExternalStore(hudStore.subscribe, hudStore.getSnapshot, () => initialHud);
  const [bagOpen, setBagOpen] = useState(false);

  const spread = 0;
  const compass = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const headingIdx = Math.round(hud.heading / 45) % 8;

  return (
    <div className="pointer-events-none absolute inset-0 font-mono text-white">
      {/* damage / low hp vignette */}
      <div
        className="absolute inset-0 transition-opacity duration-150"
        style={{
          boxShadow: "inset 0 0 180px 60px rgba(180,10,10,0.85)",
          opacity: Math.max(hud.damageFlash, hud.health < 35 ? 0.35 : 0),
        }}
      />

      {/* crosshair */}
      {hud.alive && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="relative h-16 w-16">
            <span className="absolute left-1/2 top-1/2 h-[2px] w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90" />
            {[0, 90, 180, 270].map((r) => (
              <span
                key={r}
                className="absolute left-1/2 top-1/2 h-[9px] w-[2px] bg-white/80"
                style={{ transform: `translate(-50%,-50%) rotate(${r}deg) translateY(-${spread}px)` }}
              />
            ))}
            {hud.hitMarker > 0 &&
              [45, 135, 225, 315].map((r) => (
                <span
                  key={r}
                  className="absolute left-1/2 top-1/2 h-[10px] w-[2px] bg-red-400"
                  style={{ transform: `translate(-50%,-50%) rotate(${r}deg) translateY(-14px)` }}
                />
              ))}
          </div>
        </div>
      )}

      {/* scope overlay */}
      {hud.aiming && (hud.weaponClass === "SR" || hud.weaponClass === "DMR") && (
        <div className="absolute inset-0">
          <div
            className="absolute inset-0"
            style={{ background: "radial-gradient(circle at center, transparent 27%, rgba(0,0,0,0.96) 29%)" }}
          />
          <div className="absolute left-1/2 top-1/2 h-[1px] w-[46vh] -translate-x-1/2 -translate-y-1/2 bg-black/70" />
          <div className="absolute left-1/2 top-1/2 h-[46vh] w-[1px] -translate-x-1/2 -translate-y-1/2 bg-black/70" />
        </div>
      )}

      {/* top bar */}
      <div className="absolute left-0 right-0 top-0 flex items-start justify-between p-2">
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            onClick={onPause}
            className="rounded-md bg-black/50 px-3 py-1.5 text-[11px] font-bold tracking-widest ring-1 ring-white/20 hover:bg-black/70"
          >
            ☰ MENU
          </button>
          <button
            onClick={onFullscreen}
            className="rounded-md bg-black/50 px-3 py-1.5 text-[11px] font-bold tracking-widest ring-1 ring-white/20 hover:bg-black/70"
          >
            ⛶ FULLSCREEN
          </button>
          <button
            onClick={() => setBagOpen((v) => !v)}
            className="rounded-md bg-black/50 px-3 py-1.5 text-[11px] font-bold tracking-widest ring-1 ring-white/20 hover:bg-black/70"
          >
            🎒 BAG
          </button>
          <div className="rounded-md bg-black/40 px-2 py-1 text-[10px] text-emerald-300 ring-1 ring-white/10">
            {hud.fps} FPS · {mode.toUpperCase()}
            {roomCode ? ` · ${roomCode}` : ""} · {hud.alivePlayers} ALIVE
          </div>
        </div>

        {/* compass */}
        <div className="flex flex-col items-center">
          <div className="rounded-md bg-black/45 px-6 py-1 text-xs tracking-[0.5em] text-amber-200 ring-1 ring-white/15">
            {compass[headingIdx]} {Math.round(hud.heading).toString().padStart(3, "0")}°
          </div>
          <div className="mt-1 flex gap-3 rounded-md bg-black/45 px-4 py-1 text-xs ring-1 ring-white/10">
            <span className="text-sky-300">ALPHA {hud.scoreAlpha}</span>
            <span className="text-white/40">vs</span>
            <span className="text-orange-300">BRAVO {hud.scoreBravo}</span>
          </div>
        </div>

        {/* minimap */}
        <div className="relative h-36 w-36 overflow-hidden rounded-lg bg-emerald-950/70 ring-2 ring-white/25">
          <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.25)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.25)_1px,transparent_1px)] [background-size:18px_18px]" />
          {hud.blips.map((b, i) => {
            const dx = b.x - hud.playerX;
            const dz = b.z - hud.playerZ;
            const px = 50 + (dx / MAP_RANGE) * 50;
            const py = 50 + (dz / MAP_RANGE) * 50;
            if (px < 0 || px > 100 || py < 0 || py > 100) return null;
            return (
              <span
                key={i}
                className={`absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                  b.self ? "bg-white ring-2 ring-amber-300" : b.team === "alpha" ? "bg-sky-400" : "bg-orange-400"
                } ${b.bot ? "opacity-80" : ""}`}
                style={{ left: `${px}%`, top: `${py}%` }}
              />
            );
          })}
          <div className="absolute left-1 top-1 text-[9px] text-white/70">N↑</div>
        </div>
      </div>

      {/* kill feed */}
      <div className="absolute right-2 top-40 flex w-60 flex-col items-end gap-1">
        {hud.killFeed.map((k) => (
          <div key={k.id} className="rounded bg-black/55 px-2 py-1 text-[11px] ring-1 ring-white/10">
            {k.text}
          </div>
        ))}
      </div>

      {/* prompt */}
      {hud.prompt && (
        <div className="absolute left-1/2 top-[58%] -translate-x-1/2 rounded-md bg-black/60 px-4 py-2 text-xs tracking-widest ring-1 ring-amber-300/40">
          [F] {hud.prompt}
        </div>
      )}

      {/* bottom left: health + stance */}
      <div className="absolute bottom-3 left-3 w-72">
        <div className="mb-1 flex items-center gap-2 text-[11px] tracking-widest">
          <span className={hud.health > 50 ? "text-emerald-300" : hud.health > 25 ? "text-amber-300" : "text-red-400"}>
            HP {Math.round(hud.health)}
          </span>
          <span className="text-white/50">
            {hud.stance === 0 ? "STAND" : hud.stance === 1 ? "CROUCH" : "PRONE"}
          </span>
          {hud.sprinting && <span className="text-amber-300">SPRINT</span>}
          <span className="ml-auto text-white/60">
            K {hud.kills} / D {hud.deaths}
          </span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-sm bg-black/60 ring-1 ring-white/20">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-[width] duration-150"
            style={{ width: `${Math.max(0, Math.min(100, hud.health))}%` }}
          />
        </div>
      </div>

      {/* bottom right: weapons */}
      <div className="absolute bottom-3 right-3 flex flex-col items-end gap-1">
        <div className="flex items-end gap-2">
          <div className="text-right">
            <div className="text-xs tracking-widest text-white/70">{hud.weaponName}</div>
            <div className="text-3xl font-black leading-none">
              {hud.ammo}
              <span className="ml-1 text-base font-normal text-white/60">/ {hud.reserve}</span>
            </div>
          </div>
        </div>
        {hud.reloading && <div className="text-[11px] tracking-widest text-amber-300">RELOADING…</div>}
        <div className="mt-1 flex gap-2">
          {hud.slots.map((s, i) => (
            <div
              key={i}
              className={`rounded px-3 py-1 text-[10px] ring-1 ${
                hud.slot === i ? "bg-amber-400/80 text-slate-900 ring-amber-200" : "bg-black/50 text-white/70 ring-white/15"
              }`}
            >
              {i + 1}. {s.name} {s.ammo}/{s.reserve}
            </div>
          ))}
        </div>
      </div>

      {/* backpack */}
      {bagOpen && (
        <div className="pointer-events-auto absolute left-1/2 top-1/2 w-[min(520px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-slate-950/90 p-4 ring-1 ring-white/20">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold tracking-[0.3em] text-amber-300">BACKPACK · UNLIMITED</h3>
            <button onClick={() => setBagOpen(false)} className="rounded bg-white/10 px-3 py-1 text-xs hover:bg-white/20">
              CLOSE
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {hud.backpack.length === 0 && <div className="text-xs text-white/50">Empty — loot buildings for supplies.</div>}
            {hud.backpack.map((b) => (
              <div key={b.name} className="rounded-lg bg-white/5 px-3 py-2 text-xs ring-1 ring-white/10">
                <div className="font-bold">{b.name}</div>
                <div className="text-white/50">
                  {b.kind} ×{b.count}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* death overlay */}
      {!hud.alive && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-950/50 backdrop-blur-[1px]">
          <div className="text-5xl font-black tracking-[0.3em] text-red-300">KNOCKED OUT</div>
          <div className="mt-3 text-sm tracking-widest text-white/80">Respawning in {hud.respawnIn}s</div>
        </div>
      )}
    </div>
  );
}
