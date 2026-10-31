export type ActionName =
  | "jump"
  | "crouch"
  | "prone"
  | "reload"
  | "swap"
  | "heal"
  | "interact"
  | "scope"
  | "leanL"
  | "leanR";

export class InputManager {
  enabled = true;
  keys = new Set<string>();
  moveX = 0;
  moveY = 0;
  lookX = 0;
  lookY = 0;
  firing = false;
  aiming = false;
  sprint = false;
  sensitivity = 1;
  pointerLocked = false;
  private pending = new Set<ActionName>();
  private held = new Set<ActionName>();
  private vMove = { x: 0, y: 0, active: false };
  private lookPointer: number | null = null;
  private lastLook = { x: 0, y: 0 };
  private detach: (() => void)[] = [];

  constructor(private dom: HTMLElement) {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!this.enabled) return;
      if (e.repeat) return;
      this.keys.add(e.code);
      const map: Record<string, ActionName> = {
        Space: "jump",
        ControlLeft: "crouch",
        KeyC: "crouch",
        KeyZ: "prone",
        KeyR: "reload",
        KeyQ: "leanL",
        KeyE: "leanR",
        KeyF: "interact",
        KeyH: "heal",
        KeyX: "swap",
        Digit1: "swap",
        Digit2: "swap",
      };
      if (map[e.code]) this.pending.add(map[e.code]);
      if (e.code === "Space") e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
    const onMouseMove = (e: MouseEvent) => {
      if (this.pointerLocked && this.enabled) {
        this.lookX += e.movementX * this.sensitivity;
        this.lookY += e.movementY * this.sensitivity;
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      if (!this.enabled) return;
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this.aiming = true;
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.aiming = false;
    };
    const onLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.dom;
    };
    const onContext = (e: Event) => e.preventDefault();
    const onWheel = () => this.pending.add("swap");

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !this.enabled) return;
      // only drag-look when the touch lands on the 3D canvas (not on HUD buttons)
      if (e.target !== this.dom) return;
      if (this.lookPointer === null && e.clientX > window.innerWidth * 0.3) {
        this.lookPointer = e.pointerId;
        this.lastLook = { x: e.clientX, y: e.clientY };
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || e.pointerId !== this.lookPointer) return;
      this.lookX += (e.clientX - this.lastLook.x) * 1.6 * this.sensitivity;
      this.lookY += (e.clientY - this.lastLook.y) * 1.6 * this.sensitivity;
      this.lastLook = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId === this.lookPointer) this.lookPointer = null;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("wheel", onWheel, { passive: true });
    document.addEventListener("pointerlockchange", onLockChange);
    dom.addEventListener("contextmenu", onContext);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    this.detach.push(() => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("wheel", onWheel);
      document.removeEventListener("pointerlockchange", onLockChange);
      dom.removeEventListener("contextmenu", onContext);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    });
  }

  requestLock() {
    if (!this.pointerLocked) this.dom.requestPointerLock?.();
  }

  // --- virtual (touch) API used by the React HUD ---
  setStick(x: number, y: number, active: boolean) {
    this.vMove = { x, y, active };
  }
  setButton(name: ActionName | "fire" | "aim" | "sprint", down: boolean) {
    if (name === "fire") this.firing = down;
    else if (name === "aim") this.aiming = down;
    else if (name === "sprint") this.sprint = down;
    else if (down) {
      this.pending.add(name);
      this.held.add(name);
    } else this.held.delete(name);
  }

  consume(name: ActionName) {
    if (this.pending.has(name)) {
      this.pending.delete(name);
      return true;
    }
    return false;
  }

  sample() {
    let mx = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
    let my = (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0);
    if (this.vMove.active) {
      mx = this.vMove.x;
      my = this.vMove.y;
    }
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    this.moveX = mx;
    this.moveY = my;
    const dx = this.lookX;
    const dy = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    return {
      moveX: mx,
      moveY: my,
      lookX: dx,
      lookY: dy,
      sprint: this.sprint || this.keys.has("ShiftLeft") || this.keys.has("ShiftRight"),
      firing: this.firing,
      aiming: this.aiming,
    };
  }

  dispose() {
    this.detach.forEach((fn) => fn());
  }
}
