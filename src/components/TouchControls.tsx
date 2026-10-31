"use client";

import { useRef } from "react";
import type { ControlConfig } from "@/lib/layout";
import type { InputManager } from "@/game/input";
import type { ActionName } from "@/game/input";

interface Props {
  layout: ControlConfig[];
  input: InputManager | null;
}

const HOLD = new Set(["fire", "aim", "sprint"]);

export default function TouchControls({ layout, input }: Props) {
  const stickRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  const activeId = useRef<number | null>(null);

  const stick = layout.find((c) => c.id === "stick");

  const onStickDown = (e: React.PointerEvent) => {
    if (!stick) return;
    activeId.current = e.pointerId;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    moveStick(e);
  };
  const moveStick = (e: React.PointerEvent) => {
    if (!stickRef.current || !input || !stick) return;
    const rect = stickRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = (e.clientX - cx) / (rect.width / 2);
    let dy = (e.clientY - cy) / (rect.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    input.setStick(dx, -dy, true);
    if (knobRef.current) {
      knobRef.current.style.transform = `translate(${dx * rect.width * 0.3}px, ${dy * rect.height * 0.3}px)`;
    }
  };
  const endStick = (e: React.PointerEvent) => {
    if (activeId.current !== e.pointerId) return;
    activeId.current = null;
    input?.setStick(0, 0, false);
    if (knobRef.current) knobRef.current.style.transform = "translate(0px, 0px)";
  };

  const press = (id: string, down: boolean) => {
    if (!input) return;
    if (id === "fire" || id === "aim" || id === "sprint") input.setButton(id, down);
    else if (down) input.setButton(id as ActionName, true);
    else input.setButton(id as ActionName, false);
  };

  return (
    <div className="pointer-events-none absolute inset-0 select-none" style={{ touchAction: "none" }}>
      {layout.map((c) => {
        if (!c.visible) return null;
        if (c.id === "stick") {
          return (
            <div
              key={c.id}
              ref={stickRef}
              onPointerDown={onStickDown}
              onPointerMove={(e) => activeId.current === e.pointerId && moveStick(e)}
              onPointerUp={endStick}
              onPointerCancel={endStick}
              className="pointer-events-auto absolute rounded-full border-2 border-white/50 bg-white/10 backdrop-blur-sm"
              style={{
                left: `calc(${c.x * 100}% - ${c.size / 2}px)`,
                top: `calc(${c.y * 100}% - ${c.size / 2}px)`,
                width: c.size,
                height: c.size,
                opacity: c.opacity,
              }}
            >
              <div
                ref={knobRef}
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 bg-white/35"
                style={{ width: c.size * 0.42, height: c.size * 0.42 }}
              />
            </div>
          );
        }
        return (
          <button
            key={c.id}
            onPointerDown={(e) => {
              e.preventDefault();
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              press(c.id, true);
            }}
            onPointerUp={() => press(c.id, false)}
            onPointerCancel={() => press(c.id, false)}
            onPointerLeave={() => HOLD.has(c.id) && press(c.id, false)}
            className={`pointer-events-auto absolute flex items-center justify-center border-2 border-white/55 bg-black/35 text-[10px] font-bold tracking-wider text-white/90 backdrop-blur-[2px] active:bg-amber-400/40 ${
              c.shape === "square" ? "rounded-xl" : "rounded-full"
            }`}
            style={{
              left: `calc(${c.x * 100}% - ${c.size / 2}px)`,
              top: `calc(${c.y * 100}% - ${c.size / 2}px)`,
              width: c.size,
              height: c.size,
              opacity: c.opacity,
            }}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
