"use client";

import { useRef, useState } from "react";
import { DEFAULT_LAYOUT, saveLayout, type ControlConfig } from "@/lib/layout";

interface Props {
  layout: ControlConfig[];
  onChange: (l: ControlConfig[]) => void;
  onClose: () => void;
}

export default function LayoutEditor({ layout, onChange, onClose }: Props) {
  const [selected, setSelected] = useState<string>(layout[0]?.id ?? "stick");
  const dragRef = useRef<{ id: string | null; dx: number; dy: number }>({ id: null, dx: 0, dy: 0 });

  const sel = layout.find((c) => c.id === selected);

  const patch = (id: string, p: Partial<ControlConfig>) =>
    onChange(layout.map((c) => (c.id === id ? { ...c, ...p } : c)));

  const onDown = (e: React.PointerEvent, c: ControlConfig) => {
    e.preventDefault();
    setSelected(c.id);
    dragRef.current = {
      id: c.id,
      dx: e.clientX - c.x * window.innerWidth,
      dy: e.clientY - c.y * window.innerHeight,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag.id) return;
    const x = Math.min(0.99, Math.max(0.01, (e.clientX - drag.dx) / window.innerWidth));
    const y = Math.min(0.99, Math.max(0.01, (e.clientY - drag.dy) / window.innerHeight));
    patch(drag.id, { x, y });
  };
  const onUp = () => {
    dragRef.current.id = null;
  };

  return (
    <div
      className="absolute inset-0 z-40 bg-slate-950/70 backdrop-blur-[2px]"
      style={{ touchAction: "none" }}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {layout.map((c) => (
        <div
          key={c.id}
          onPointerDown={(e) => onDown(e, c)}
          className={`absolute flex cursor-move items-center justify-center border-2 text-[10px] font-bold tracking-wider ${
            c.shape === "square" ? "rounded-xl" : "rounded-full"
          } ${selected === c.id ? "border-amber-400 bg-amber-400/25 text-amber-100" : "border-white/55 bg-black/40 text-white/80"} ${
            c.visible ? "" : "opacity-25"
          }`}
          style={{
            left: `calc(${c.x * 100}% - ${c.size / 2}px)`,
            top: `calc(${c.y * 100}% - ${c.size / 2}px)`,
            width: c.size,
            height: c.size,
          }}
        >
          {c.label}
        </div>
      ))}

      <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-slate-900/90 px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-amber-300 ring-1 ring-amber-400/40">
        Controls Layout Editor — drag to move
      </div>

      <div className="absolute bottom-4 left-1/2 w-[min(760px,94vw)] -translate-x-1/2 rounded-2xl bg-slate-900/95 p-4 text-slate-100 ring-1 ring-white/15">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {layout.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelected(c.id)}
              className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                selected === c.id ? "bg-amber-400 text-slate-900" : "bg-white/10 text-slate-200 hover:bg-white/20"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {sel && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-xs">
              Size <span className="text-amber-300">{Math.round(sel.size)}px</span>
              <input
                type="range"
                min={40}
                max={220}
                value={sel.size}
                onChange={(e) => patch(sel.id, { size: Number(e.target.value) })}
                className="mt-1 w-full accent-amber-400"
              />
            </label>
            <label className="text-xs">
              Opacity <span className="text-amber-300">{Math.round(sel.opacity * 100)}%</span>
              <input
                type="range"
                min={10}
                max={100}
                value={sel.opacity * 100}
                onChange={(e) => patch(sel.id, { opacity: Number(e.target.value) / 100 })}
                className="mt-1 w-full accent-amber-400"
              />
            </label>
            <div className="flex items-end gap-2">
              <button
                onClick={() => patch(sel.id, { visible: !sel.visible })}
                className="flex-1 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/20"
              >
                {sel.visible ? "Hide button" : "Show button"}
              </button>
              <button
                onClick={() => patch(sel.id, { shape: sel.shape === "square" ? "round" : "square" })}
                className="flex-1 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/20"
              >
                {sel.shape === "square" ? "Round" : "Square"}
              </button>
            </div>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => onChange(DEFAULT_LAYOUT.map((c) => ({ ...c })))}
            className="rounded-lg bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-wider hover:bg-white/20"
          >
            Reset
          </button>
          <button
            onClick={() => {
              saveLayout(layout);
              onClose();
            }}
            className="ml-auto rounded-lg bg-amber-400 px-6 py-2 text-xs font-black uppercase tracking-wider text-slate-900 hover:bg-amber-300"
          >
            Save &amp; Close
          </button>
        </div>
      </div>
    </div>
  );
}
