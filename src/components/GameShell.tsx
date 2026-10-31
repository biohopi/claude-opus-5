"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Game } from "@/game/game";
import type { InputManager } from "@/game/input";
import { hudStore } from "@/game/store";
import Hud from "./Hud";
import TouchControls from "./TouchControls";
import LayoutEditor from "./LayoutEditor";
import LobbyScreen from "./LobbyScreen";
import {
  getPlayerId,
  loadLayout,
  loadSettings,
  saveLayout,
  saveSettings,
  type ControlConfig,
  type Settings,
} from "@/lib/layout";
import type { RoomInfo, Team } from "@/lib/types";

type Screen = "launch" | "menu" | "offline" | "multiplayer" | "playing";

export default function GameShell() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<Game | null>(null);
  const [screen, setScreen] = useState<Screen>("launch");
  const [settings, setSettings] = useState<Settings>({ quality: "high", sensitivity: 1, showTouch: false, name: "" });
  const [layout, setLayout] = useState<ControlConfig[]>([]);
  const [paused, setPaused] = useState(false);
  const [editor, setEditor] = useState(false);
  const [playerId, setPlayerId] = useState("anon");
  const [name, setName] = useState("Operator");
  const [mode, setMode] = useState<"offline" | "online">("offline");
  const [roomCode, setRoomCode] = useState<string | undefined>();
  const [offline, setOffline] = useState({ team: "alpha" as Team, botsAlpha: 6, botsBravo: 6 });
  const [booting, setBooting] = useState(false);
  const [input, setInput] = useState<InputManager | null>(null);

  // Hydrate device-local preferences after mount (localStorage is unavailable on the server).
  useEffect(() => {
    const s = loadSettings();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSettings(s);
    setLayout(loadLayout());
    setPlayerId(getPlayerId());
    setName(s.name || "Operator" + Math.floor(Math.random() * 900 + 100));
  }, []);

  useEffect(() => {
    if (gameRef.current) gameRef.current.input.sensitivity = settings.sensitivity;
  }, [settings.sensitivity]);

  const goFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        const so = window.screen as unknown as { orientation?: { lock?: (o: string) => Promise<void> } };
        await so?.orientation?.lock?.("landscape")?.catch(() => undefined);
      } else {
        await document.exitFullscreen();
      }
    } catch {
      /* fullscreen denied */
    }
  }, []);

  const startGame = useCallback(
    (opts: {
      mode: "offline" | "online";
      team: Team;
      seed: number;
      roomCode?: string;
      isHost: boolean;
      botsAlpha: number;
      botsBravo: number;
    }) => {
      setBooting(true);
      setScreen("playing");
      setMode(opts.mode);
      setRoomCode(opts.roomCode);
      hudStore.reset();
      // allow the canvas to mount before building the scene
      setTimeout(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        gameRef.current?.dispose();
        gameRef.current = new Game({
          canvas,
          mode: opts.mode,
          playerId,
          playerName: name,
          team: opts.team,
          seed: opts.seed,
          roomCode: opts.roomCode,
          isHost: opts.isHost,
          botsAlpha: opts.botsAlpha,
          botsBravo: opts.botsBravo,
          quality: settings.quality,
          hud: hudStore,
          onLoaded: () => setBooting(false),
        });
        gameRef.current.input.sensitivity = settings.sensitivity;
        setInput(gameRef.current.input);
      }, 60);
    },
    [playerId, name, settings.quality, settings.sensitivity],
  );

  const leaveMatch = useCallback(() => {
    gameRef.current?.dispose();
    gameRef.current = null;
    setInput(null);
    setPaused(false);
    setEditor(false);
    setScreen("menu");
  }, []);

  // pause handling
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape" && screen === "playing") {
        setPaused((p) => {
          const next = !p;
          gameRef.current?.setPaused(next);
          return next;
        });
      }
      if (e.code === "Tab" && screen === "playing") e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen]);

  useEffect(() => () => gameRef.current?.dispose(), []);

  const onLaunchFromLobby = useCallback(
    (room: RoomInfo, team: Team) => {
      startGame({
        mode: "online",
        team,
        seed: room.mapSeed,
        roomCode: room.code,
        isHost: room.hostId === playerId,
        botsAlpha: room.botsAlpha,
        botsBravo: room.botsBravo,
      });
    },
    [playerId, startGame],
  );

  const persist = (s: Settings) => {
    setSettings(s);
    saveSettings(s);
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        onPointerDown={(e) => {
          if (screen === "playing" && !paused && !editor && e.pointerType === "mouse") {
            gameRef.current?.input.requestLock();
          }
        }}
      />

      {screen === "playing" && (
        <>
          <Hud
            mode={mode}
            roomCode={roomCode}
            onFullscreen={goFullscreen}
            onPause={() => {
              setPaused(true);
              gameRef.current?.setPaused(true);
            }}
          />
          {settings.showTouch && !paused && !editor && (
            <TouchControls layout={layout} input={input} />
          )}
          <div className="pointer-events-auto absolute inset-0 z-50 hidden flex-col items-center justify-center bg-slate-950/95 text-center portrait:flex">
            <div className="text-5xl">📱↻</div>
            <p className="mt-4 text-sm font-bold uppercase tracking-[0.3em] text-amber-300">Rotate to landscape</p>
            <button
              onClick={goFullscreen}
              className="mt-5 rounded-xl bg-amber-400 px-8 py-3 text-xs font-black uppercase tracking-widest text-slate-900"
            >
              Fullscreen
            </button>
          </div>
          {booting && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950">
              <div className="text-xs uppercase tracking-[0.5em] text-amber-300">Generating battleground…</div>
              <div className="mt-4 h-1 w-56 overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-amber-400" />
              </div>
            </div>
          )}
        </>
      )}

      {editor && (
        <LayoutEditor
          layout={layout}
          onChange={setLayout}
          onClose={() => {
            saveLayout(layout);
            setEditor(false);
          }}
        />
      )}

      {/* ----------------------------------------------------------- launch */}
      {screen === "launch" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[radial-gradient(circle_at_50%_30%,#2b4a68,#05080c_65%)]">
          <div
            className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-55"
            style={{ backgroundImage: "url(/images/hero.jpg)" }}
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-slate-950/60 via-slate-950/40 to-slate-950/95" />
          <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:repeating-linear-gradient(90deg,rgba(255,255,255,0.08)_0_2px,transparent_2px_80px)]" />
          <h1 className="relative z-10 text-center text-6xl font-black tracking-[0.25em] text-amber-300 drop-shadow-[0_0_30px_rgba(251,191,36,0.35)] sm:text-7xl">
            ARENA<span className="text-white">OPS</span>
          </h1>
          <p className="relative z-10 mt-3 text-xs uppercase tracking-[0.55em] text-slate-300">
            Tactical 3D Battleground
          </p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 18))}
            className="relative z-10 mt-10 w-64 rounded-xl bg-black/50 px-4 py-3 text-center font-mono tracking-widest ring-1 ring-white/20 outline-none focus:ring-amber-400"
            placeholder="CALLSIGN"
          />
          <button
            onClick={() => {
              persist({ ...settings, name });
              setScreen("menu");
              void goFullscreen();
            }}
            className="relative z-10 mt-6 rounded-xl bg-amber-400 px-16 py-4 text-lg font-black uppercase tracking-[0.3em] text-slate-900 shadow-[0_0_40px_rgba(251,191,36,0.35)] hover:bg-amber-300"
          >
            Enter
          </button>
          <p className="relative z-10 mt-6 max-w-md text-center text-[11px] leading-relaxed text-slate-400">
            WASD move · Mouse look · LMB fire · RMB aim · Space jump · C crouch · Z prone · R reload · X swap · F loot ·
            H heal · Q/E lean · Esc menu
          </p>
        </div>
      )}

      {/* ------------------------------------------------------------- menu */}
      {screen === "menu" && (
        <div className="absolute inset-0 overflow-auto bg-[radial-gradient(circle_at_20%_10%,#223b52,#05080c_60%)] p-6">
          <div className="mx-auto max-w-4xl">
            <h2 className="text-3xl font-black tracking-[0.3em] text-amber-300">COMMAND CENTER</h2>
            <p className="mt-1 text-xs uppercase tracking-[0.4em] text-slate-400">Callsign: {name}</p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <button
                onClick={() => setScreen("offline")}
                className="group rounded-2xl bg-slate-900/70 p-6 text-left ring-1 ring-white/10 transition hover:ring-amber-400/60"
              >
                <div className="text-xl font-black tracking-widest text-white">OFFLINE</div>
                <p className="mt-2 text-xs text-slate-400">
                  Instant deployment versus AI squads. Pick team sizes, bot counts and quality.
                </p>
                <span className="mt-4 inline-block text-xs font-bold uppercase tracking-widest text-amber-300 group-hover:underline">
                  Configure →
                </span>
              </button>
              <button
                onClick={() => setScreen("multiplayer")}
                className="group rounded-2xl bg-slate-900/70 p-6 text-left ring-1 ring-white/10 transition hover:ring-amber-400/60"
              >
                <div className="text-xl font-black tracking-widest text-white">MULTIPLAYER</div>
                <p className="mt-2 text-xs text-slate-400">
                  Create or join a room, balance teams and bots, then start the match as host.
                </p>
                <span className="mt-4 inline-block text-xs font-bold uppercase tracking-widest text-amber-300 group-hover:underline">
                  Room browser →
                </span>
              </button>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl bg-slate-900/70 p-5 ring-1 ring-white/10">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.3em] text-slate-400">Settings</h3>
                <label className="mb-3 block text-xs">
                  Graphics quality
                  <div className="mt-2 flex gap-2">
                    {(["low", "medium", "high"] as const).map((q) => (
                      <button
                        key={q}
                        onClick={() => persist({ ...settings, quality: q })}
                        className={`flex-1 rounded-lg px-3 py-2 text-[11px] font-bold uppercase ${
                          settings.quality === q ? "bg-amber-400 text-slate-900" : "bg-white/10 hover:bg-white/20"
                        }`}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </label>
                <label className="mb-3 block text-xs">
                  <span className="flex justify-between">
                    Look sensitivity <span className="text-amber-300">{settings.sensitivity.toFixed(2)}×</span>
                  </span>
                  <input
                    type="range"
                    min={20}
                    max={300}
                    value={settings.sensitivity * 100}
                    onChange={(e) => persist({ ...settings, sensitivity: Number(e.target.value) / 100 })}
                    className="mt-1 w-full accent-amber-400"
                  />
                </label>
                <button
                  onClick={() => persist({ ...settings, showTouch: !settings.showTouch })}
                  className="w-full rounded-lg bg-white/10 py-2 text-[11px] font-bold uppercase hover:bg-white/20"
                >
                  Touch controls: {settings.showTouch ? "ON" : "OFF"}
                </button>
              </div>

              <div className="rounded-2xl bg-slate-900/70 p-5 ring-1 ring-white/10">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-[0.3em] text-slate-400">Controls layout</h3>
                <p className="text-xs text-slate-400">
                  Drag, resize and fade every on-screen button. Layout is stored on this device.
                </p>
                <button
                  onClick={() => setEditor(true)}
                  className="mt-4 w-full rounded-lg bg-amber-400 py-2.5 text-[11px] font-black uppercase tracking-widest text-slate-900 hover:bg-amber-300"
                >
                  Open layout editor
                </button>
                <button
                  onClick={goFullscreen}
                  className="mt-2 w-full rounded-lg bg-white/10 py-2.5 text-[11px] font-bold uppercase tracking-widest hover:bg-white/20"
                >
                  Toggle fullscreen / landscape
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------- offline */}
      {screen === "offline" && (
        <div className="absolute inset-0 overflow-auto bg-[radial-gradient(circle_at_70%_20%,#2a4435,#05080c_60%)] p-6">
          <div className="mx-auto max-w-3xl">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-black tracking-[0.3em] text-amber-300">OFFLINE DEPLOYMENT</h2>
              <button
                onClick={() => setScreen("menu")}
                className="rounded-lg bg-white/10 px-4 py-2 text-xs font-bold uppercase hover:bg-white/20"
              >
                Back
              </button>
            </div>
            <div className="rounded-2xl bg-slate-900/70 p-5 ring-1 ring-white/10">
              <div className="mb-4 grid grid-cols-2 gap-3">
                {(["alpha", "bravo"] as Team[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setOffline((o) => ({ ...o, team: t }))}
                    className={`rounded-xl py-3 text-sm font-black uppercase tracking-widest ring-1 ${
                      offline.team === t
                        ? t === "alpha"
                          ? "bg-sky-500/30 text-sky-200 ring-sky-400"
                          : "bg-orange-500/30 text-orange-200 ring-orange-400"
                        : "bg-white/5 text-slate-300 ring-white/10"
                    }`}
                  >
                    Join {t}
                  </button>
                ))}
              </div>
              {([
                ["Alpha bots", "botsAlpha"],
                ["Bravo bots", "botsBravo"],
              ] as const).map(([label, key]) => (
                <label key={key} className="mb-4 block text-xs">
                  <span className="flex justify-between">
                    {label} <span className="text-amber-300">{offline[key]}</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={12}
                    value={offline[key]}
                    onChange={(e) => setOffline((o) => ({ ...o, [key]: Number(e.target.value) }))}
                    className="mt-1 w-full accent-amber-400"
                  />
                </label>
              ))}
              <button
                onClick={() =>
                  startGame({
                    mode: "offline",
                    team: offline.team,
                    seed: Math.floor(Math.random() * 99999),
                    isHost: true,
                    botsAlpha: offline.botsAlpha,
                    botsBravo: offline.botsBravo,
                  })
                }
                className="w-full rounded-xl bg-emerald-400 py-4 text-base font-black uppercase tracking-[0.25em] text-slate-900 hover:bg-emerald-300"
              >
                Deploy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------- multiplayer */}
      {screen === "multiplayer" && (
        <LobbyScreen
          playerId={playerId}
          playerName={name}
          onBack={() => setScreen("menu")}
          onLaunch={onLaunchFromLobby}
        />
      )}

      {/* ------------------------------------------------------------ pause */}
      {screen === "playing" && paused && !editor && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm">
          <div className="w-[min(460px,92vw)] rounded-2xl bg-slate-900/95 p-6 ring-1 ring-white/15">
            <h3 className="mb-5 text-center text-xl font-black tracking-[0.35em] text-amber-300">PAUSED</h3>
            <div className="space-y-2">
              <button
                onClick={() => {
                  setPaused(false);
                  gameRef.current?.setPaused(false);
                }}
                className="w-full rounded-xl bg-amber-400 py-3 text-sm font-black uppercase tracking-widest text-slate-900 hover:bg-amber-300"
              >
                Resume
              </button>
              <button
                onClick={() => setEditor(true)}
                className="w-full rounded-xl bg-white/10 py-3 text-sm font-bold uppercase tracking-widest hover:bg-white/20"
              >
                Controls layout
              </button>
              <button
                onClick={() => persist({ ...settings, showTouch: !settings.showTouch })}
                className="w-full rounded-xl bg-white/10 py-3 text-sm font-bold uppercase tracking-widest hover:bg-white/20"
              >
                Touch controls: {settings.showTouch ? "ON" : "OFF"}
              </button>
              <label className="block rounded-xl bg-white/5 p-3 text-xs">
                <span className="flex justify-between">
                  Sensitivity <span className="text-amber-300">{settings.sensitivity.toFixed(2)}×</span>
                </span>
                <input
                  type="range"
                  min={20}
                  max={300}
                  value={settings.sensitivity * 100}
                  onChange={(e) => persist({ ...settings, sensitivity: Number(e.target.value) / 100 })}
                  className="mt-2 w-full accent-amber-400"
                />
              </label>
              <button
                onClick={goFullscreen}
                className="w-full rounded-xl bg-white/10 py-3 text-sm font-bold uppercase tracking-widest hover:bg-white/20"
              >
                Fullscreen
              </button>
              <button
                onClick={leaveMatch}
                className="w-full rounded-xl bg-red-500/80 py-3 text-sm font-black uppercase tracking-widest hover:bg-red-500"
              >
                Leave match
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
