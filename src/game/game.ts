import * as THREE from "three";
import { World } from "./world";
import { Character } from "./characters";
import { InputManager } from "./input";
import { WEAPONS, makeWeapon, type WeaponInstance } from "./weapons";
import { RNG } from "./noise";
import type { HudStore, Blip } from "./store";
import type { NetState, Stance, Team, SyncResponse } from "@/lib/types";

const TEAM_COLORS: Record<Team, number> = { alpha: 0x3f78c4, bravo: 0xc4653f };
const EYE = { 0: 1.64, 1: 1.12, 2: 0.52 } as const;
const HEIGHT = { 0: 1.8, 1: 1.25, 2: 0.7 } as const;
const SPEED = { 0: 5.4, 1: 2.7, 2: 1.3 } as const;
const SPRINT = 9.2;
const GRAVITY = -26;

interface Actor {
  id: string;
  name: string;
  team: Team;
  bot: boolean;
  char: Character;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;
  stance: Stance;
  health: number;
  alive: boolean;
  speed: number;
  firing: boolean;
  aiming: boolean;
  weapon: string;
  kills: number;
  deaths: number;
  netPos?: THREE.Vector3;
  netYaw?: number;
  lastSeen: number;
  respawnAt: number;
  ai?: {
    mode: "patrol" | "engage";
    dest: THREE.Vector3;
    targetId: string | null;
    think: number;
    fireCd: number;
    burst: number;
    los: boolean;
    losCd: number;
    strafe: number;
  };
}

export interface GameOptions {
  canvas: HTMLCanvasElement;
  mode: "offline" | "online";
  playerId: string;
  playerName: string;
  team: Team;
  seed: number;
  roomCode?: string;
  isHost: boolean;
  botsAlpha: number;
  botsBravo: number;
  quality: "low" | "medium" | "high";
  hud: HudStore;
  onLoaded?: () => void;
}

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  world: World;
  input: InputManager;
  clock = new THREE.Clock();
  paused = false;
  disposed = false;

  // local player
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  stance: Stance = 0;
  health = 100;
  alive = true;
  respawnAt = 0;
  grounded = false;
  sprinting = false;
  aiming = false;
  lean = 0;
  recoil = new THREE.Vector2();
  recoilVel = new THREE.Vector2();
  slot: 0 | 1 = 0;
  weapons: [WeaponInstance, WeaponInstance];
  backpack = new Map<string, { kind: string; count: number }>();
  kills = 0;
  deaths = 0;

  actors = new Map<string, Actor>();
  private sun: THREE.DirectionalLight;
  private muzzle: THREE.PointLight;
  private muzzleTimer = 0;
  private tracers: { line: THREE.Line; life: number }[] = [];
  private impacts: { mesh: THREE.Mesh; life: number }[] = [];
  private killFeed: { id: number; text: string; team: string }[] = [];
  private feedId = 1;
  private rng: RNG;
  private hudTimer = 0;
  private netTimer = 0;
  private netBusy = false;
  private lastEventId = 0;
  private queued: { type: string; payload: Record<string, unknown> }[] = [];
  private frameTimes: number[] = [];
  private hitMarker = 0;
  private damageFlash = 0;
  private scores = { alpha: 0, bravo: 0 };
  private raf = 0;
  private localCharacter: Character;
  private shakeTime = 0;
  private audio?: AudioContext;

  constructor(private opts: GameOptions) {
    this.rng = new RNG(opts.seed + 991);
    const canvas = opts.canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: opts.quality !== "low",
      powerPreference: "high-performance",
      stencil: false,
    });
    const dpr = opts.quality === "high" ? 2 : opts.quality === "medium" ? 1.5 : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, dpr));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = opts.quality !== "low";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.1, 1200);
    this.scene.add(this.camera);

    this.sun = new THREE.DirectionalLight(0xffeedd, 2.6);
    this.sun.position.set(80, 140, 60);
    this.sun.castShadow = opts.quality !== "low";
    const sm = opts.quality === "high" ? 2048 : 1024;
    this.sun.shadow.mapSize.set(sm, sm);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 320;
    const ext = 70;
    this.sun.shadow.camera.left = -ext;
    this.sun.shadow.camera.right = ext;
    this.sun.shadow.camera.top = ext;
    this.sun.shadow.camera.bottom = -ext;
    this.sun.shadow.bias = -0.0009;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(new THREE.HemisphereLight(0xbdd9ff, 0x4a4535, 1.35));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.22));

    this.muzzle = new THREE.PointLight(0xffc45e, 0, 14, 2);
    this.scene.add(this.muzzle);

    this.world = new World(opts.seed);
    this.world.build(this.scene);

    this.input = new InputManager(canvas);
    this.weapons = [makeWeapon("M416"), makeWeapon("Kar98k")];
    this.backpack.set("Bandage", { kind: "med", count: 5 });
    this.backpack.set("Med Kit", { kind: "med", count: 2 });
    this.backpack.set("5.56mm", { kind: "ammo", count: 180 });

    this.localCharacter = new Character(TEAM_COLORS[opts.team]);
    this.scene.add(this.localCharacter.group);

    this.spawnSelf();
    if (opts.mode === "offline" || opts.isHost) this.spawnBots();

    window.addEventListener("resize", this.onResize);
    opts.onLoaded?.();
    this.loop();
  }

  // ------------------------------------------------------------- spawning
  private spawnPoint(team: Team) {
    const list = this.world.spawns[team];
    const p = list[Math.floor(this.rng.next() * list.length)].clone();
    p.y = this.world.groundHeight(p.x, p.z, p.y + 3) + 0.05;
    return p;
  }

  private spawnSelf() {
    this.pos.copy(this.spawnPoint(this.opts.team));
    this.vel.set(0, 0, 0);
    this.health = 100;
    this.alive = true;
    this.stance = 0;
    const enemy = this.opts.team === "alpha" ? "bravo" : "alpha";
    const look = this.world.spawns[enemy as Team][0];
    this.yaw = Math.atan2(look.x - this.pos.x, look.z - this.pos.z) + Math.PI;
    this.weapons.forEach((w) => {
      w.ammo = w.def.mag;
      w.reloading = 0;
    });
  }

  private spawnBots() {
    const names = ["Ghost", "Viper", "Hawk", "Bravo6", "Reaper", "Nomad", "Slate", "Kilo", "Raven", "Tundra", "Fox", "Zero"];
    const make = (team: Team, i: number) => {
      const id = `bot:${team}:${i}`;
      const name = `${names[i % names.length]}_${i + 1}`;
      const char = new Character(TEAM_COLORS[team], name, team === this.opts.team ? "#8fd3ff" : "#ff9d8f");
      this.scene.add(char.group);
      const p = this.spawnPoint(team);
      const actor: Actor = {
        id,
        name,
        team,
        bot: true,
        char,
        pos: p,
        vel: new THREE.Vector3(),
        yaw: this.rng.range(0, 6.28),
        pitch: 0,
        stance: 0,
        health: 100,
        alive: true,
        speed: 0,
        firing: false,
        aiming: false,
        weapon: this.rng.pick(["M416", "AKM", "UMP45", "SLR"]),
        kills: 0,
        deaths: 0,
        lastSeen: performance.now(),
        respawnAt: 0,
        ai: {
          mode: "patrol",
          dest: this.randomPoint(),
          targetId: null,
          think: this.rng.range(0, 1),
          fireCd: 0,
          burst: 0,
          los: false,
          losCd: 0,
          strafe: this.rng.next() > 0.5 ? 1 : -1,
        },
      };
      this.actors.set(id, actor);
    };
    for (let i = 0; i < this.opts.botsAlpha; i++) make("alpha", i);
    for (let i = 0; i < this.opts.botsBravo; i++) make("bravo", i);
  }

  private randomPoint() {
    const a = this.rng.range(0, Math.PI * 2);
    const r = Math.sqrt(this.rng.next()) * 180;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    return new THREE.Vector3(x, this.world.heightAt(x, z), z);
  }

  // ---------------------------------------------------------------- loop
  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    if (!this.paused) {
      this.update(dt);
    }
    this.renderer.render(this.scene, this.camera);
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 30) this.frameTimes.shift();
  };

  private update(dt: number) {
    const s = this.input.sample();
    this.world.update(dt);
    this.updateSelf(dt, s);
    this.updateBots(dt);
    this.updateRemotes(dt);
    this.updateFx(dt);
    this.updateCamera(dt);
    this.updateSun();
    this.netTimer += dt;
    if (this.opts.mode === "online" && this.netTimer > 0.09) {
      this.netTimer = 0;
      void this.sync();
    }
    this.hudTimer += dt;
    if (this.hudTimer > 0.08) {
      this.hudTimer = 0;
      this.pushHud();
    }
  }

  // -------------------------------------------------------------- player
  private updateSelf(dt: number, s: ReturnType<InputManager["sample"]>) {
    const wep = this.weapons[this.slot];

    if (!this.alive) {
      this.respawnAt -= dt;
      if (this.respawnAt <= 0) {
        this.spawnSelf();
        if (this.opts.mode === "online") this.queued.push({ type: "respawn", payload: {} });
      }
      this.localCharacter.setVisible(false);
      return;
    }
    this.localCharacter.setVisible(true);

    // look
    const sens = 0.0022;
    this.yaw -= s.lookX * sens;
    this.pitch -= s.lookY * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.25, 1.25);

    // recoil recovery
    this.recoil.lerp(new THREE.Vector2(0, 0), Math.min(1, dt * 7));

    // stance toggles
    if (this.input.consume("crouch")) this.stance = this.stance === 1 ? 0 : 1;
    if (this.input.consume("prone")) this.stance = this.stance === 2 ? 0 : 2;
    if (this.input.consume("swap")) this.swapWeapon();
    if (this.input.consume("reload")) this.reload();
    if (this.input.consume("heal")) this.heal();
    if (this.input.consume("interact")) this.pickup();
    if (this.input.consume("scope")) this.input.aiming = !this.input.aiming;
    if (this.input.consume("leanL")) this.lean = this.lean === -1 ? 0 : -1;
    if (this.input.consume("leanR")) this.lean = this.lean === 1 ? 0 : 1;
    if (this.input.consume("jump") && this.grounded && this.stance !== 2) {
      this.vel.y = 8.4;
      this.grounded = false;
    }

    this.aiming = s.aiming;
    const moveMag = Math.hypot(s.moveX, s.moveY);
    this.sprinting = s.sprint && s.moveY > 0.35 && this.stance === 0 && !this.aiming;

    let speed: number = SPEED[this.stance];
    if (this.sprinting) speed = SPRINT;
    else if (this.aiming) speed *= 0.55;

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const fx = -sin;
    const fz = -cos;
    const rx = cos;
    const rz = -sin;
    const targetVx = (fx * s.moveY + rx * s.moveX) * speed;
    const targetVz = (fz * s.moveY + rz * s.moveX) * speed;
    const accel = this.grounded ? 14 : 4;
    this.vel.x += (targetVx - this.vel.x) * Math.min(1, dt * accel);
    this.vel.z += (targetVz - this.vel.z) * Math.min(1, dt * accel);

    this.vel.y += GRAVITY * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    // keep inside play area
    const dist = Math.hypot(this.pos.x, this.pos.z);
    if (dist > 245) {
      this.pos.x *= 245 / dist;
      this.pos.z *= 245 / dist;
    }

    this.world.collide(this.pos, 0.42, HEIGHT[this.stance]);
    const g = this.world.groundHeight(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y <= g + 0.02) {
      this.pos.y = g;
      if (this.vel.y < 0) this.vel.y = 0;
      this.grounded = true;
    } else this.grounded = false;

    // weapon timers
    for (const w of this.weapons) {
      w.cooldown -= dt;
      if (w.reloading > 0) {
        w.reloading -= dt;
        if (w.reloading <= 0) {
          const need = w.def.mag - w.ammo;
          const take = Math.min(need, w.reserve);
          w.ammo += take;
          w.reserve -= take;
        }
      }
    }

    if (s.firing && !this.sprinting && wep.reloading <= 0) {
      if (wep.ammo > 0 && wep.cooldown <= 0) this.shoot(wep);
      else if (wep.ammo <= 0) this.reload();
      if (!wep.def.auto) this.input.firing = false;
    }

    // animate local body
    this.localCharacter.group.position.copy(this.pos);
    this.localCharacter.group.rotation.y = this.yaw;
    this.localCharacter.update(dt, {
      speed: Math.hypot(this.vel.x, this.vel.z),
      stance: this.stance,
      aiming: this.aiming,
      pitch: this.pitch,
      firing: s.firing,
    });

    // interaction prompt
    this.nearLoot();
  }

  private swapWeapon() {
    this.slot = this.slot === 0 ? 1 : 0;
    this.weapons[this.slot].reloading = 0;
  }

  private reload() {
    const w = this.weapons[this.slot];
    if (w.reloading > 0 || w.ammo >= w.def.mag || w.reserve <= 0) return;
    w.reloading = w.def.reload;
  }

  private heal() {
    const med = this.backpack.get("Med Kit") ?? this.backpack.get("Bandage");
    if (!med || med.count <= 0 || this.health >= 100) return;
    med.count--;
    const amount = med === this.backpack.get("Med Kit") ? 45 : 18;
    this.health = Math.min(100, this.health + amount);
    if (med.count <= 0) {
      for (const [k, v] of this.backpack) if (v === med) this.backpack.delete(k);
    }
    if (this.opts.mode === "online") this.queued.push({ type: "heal", payload: { amount } });
  }

  private nearestLoot() {
    let best: (typeof this.world.loot)[number] | null = null;
    let bd = 2.6;
    for (const l of this.world.loot) {
      if (l.taken) continue;
      const d = Math.hypot(l.x - this.pos.x, l.z - this.pos.z);
      if (d < bd && Math.abs(l.y - this.pos.y) < 3) {
        bd = d;
        best = l;
      }
    }
    return best;
  }

  private promptText: string | null = null;
  private nearLoot() {
    const l = this.nearestLoot();
    this.promptText = l ? `Pick up ${l.name}` : null;
  }

  private pickup() {
    const l = this.nearestLoot();
    if (!l) return;
    l.taken = true;
    l.mesh.visible = false;
    if (l.kind === "weapon") {
      this.weapons[this.slot] = makeWeapon(l.name);
      this.pushFeed(`Equipped ${l.name}`, "info");
    } else {
      const cur = this.backpack.get(l.name);
      if (cur) cur.count += l.kind === "ammo" ? 30 : 1;
      else this.backpack.set(l.name, { kind: l.kind, count: l.kind === "ammo" ? 30 : 1 });
      if (l.kind === "armor") this.health = Math.min(100, this.health + 10);
      this.pushFeed(`Picked up ${l.name}`, "info");
    }
  }

  // -------------------------------------------------------------- combat
  private shoot(w: WeaponInstance) {
    w.cooldown = 60 / w.def.rpm;
    w.ammo--;
    w.recoilIndex++;

    const spread = this.aiming ? w.def.adsSpread : w.def.spread * (this.stance === 2 ? 0.45 : this.stance === 1 ? 0.7 : 1);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.x += (this.rng.next() - 0.5) * spread * 2;
    dir.y += (this.rng.next() - 0.5) * spread * 2;
    dir.z += (this.rng.next() - 0.5) * spread * 2;
    dir.normalize();

    const origin = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    origin.addScaledVector(dir, 0.6);

    // recoil kick
    const kv = w.def.recoilV * (this.aiming ? 0.6 : 1) * (this.stance === 2 ? 0.5 : 1);
    const kh = w.def.recoilH * (this.aiming ? 0.6 : 1);
    this.pitch += kv;
    this.yaw += (this.rng.next() - 0.5) * kh * 2;
    this.recoil.x += kv * 14;
    this.shakeTime = 0.08;

    this.muzzleTimer = 0.045;
    this.muzzle.position.copy(origin);
    this.playShot(w.def.id);

    const hit = this.hitscan(origin, dir, w.def.range, w.def.damage, this.opts.team);
    this.spawnTracer(origin, hit.point);
  }

  private hitscan(origin: THREE.Vector3, dir: THREE.Vector3, range: number, damage: number, team: Team) {
    const envHit = this.world.rayWorld(origin, dir, range);
    const envDist = envHit ? envHit.dist : range;
    let bestDist = envDist;
    let bestActor: Actor | "self" | null = null;
    let head = false;

    const check = (ax: number, ay: number, az: number, radius: number, isHead: boolean, ref: Actor | "self") => {
      const ox = ax - origin.x;
      const oy = ay - origin.y;
      const oz = az - origin.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < 0 || t > bestDist) return;
      const px = origin.x + dir.x * t;
      const py = origin.y + dir.y * t;
      const pz = origin.z + dir.z * t;
      const d2 = (px - ax) ** 2 + (py - ay) ** 2 + (pz - az) ** 2;
      if (d2 <= radius * radius) {
        bestDist = t;
        bestActor = ref;
        head = isHead;
      }
    };

    for (const a of this.actors.values()) {
      if (!a.alive || a.team === team) continue;
      const hh = HEIGHT[a.stance];
      check(a.pos.x, a.pos.y + hh * 0.55, a.pos.z, 0.42, false, a);
      check(a.pos.x, a.pos.y + hh * 0.95, a.pos.z, 0.25, true, a);
    }

    const point = new THREE.Vector3().copy(origin).addScaledVector(dir, bestDist);
    if (bestActor && bestActor !== "self") {
      const victim = bestActor as Actor;
      const dmg = damage * (head ? 2.3 : 1);
      this.damageActor(victim, dmg, this.opts.playerName);
      this.hitMarker = head ? 0.5 : 0.3;
    }
    return { point, actor: bestActor };
  }

  damageActor(a: Actor, dmg: number, byName: string) {
    if (!a.alive) return;
    if (a.bot) {
      // online clients that do not simulate the bots still report the hit so the
      // host (bot authority) applies the same damage
      if (this.opts.mode === "online" && !this.opts.isHost)
        this.queued.push({ type: "hit", payload: { target: a.id, damage: dmg } });
      a.health -= dmg;
      a.char.setHealth(a.health);
      if (a.health <= 0) {
        a.alive = false;
        a.deaths++;
        a.char.setVisible(false);
        a.respawnAt = 5;
        this.kills++;
        this.scores[this.opts.team]++;
        this.pushFeed(`${byName} eliminated ${a.name}`, this.opts.team);
        if (this.opts.mode === "online")
          this.queued.push({ type: "botkill", payload: { victim: a.name } });
      }
    } else {
      // remote human: server is authoritative
      this.queued.push({
        type: "hit",
        payload: { target: a.id, damage: dmg, weapon: this.weapons[this.slot].def.id },
      });
      a.health = Math.max(0, a.health - dmg);
      a.char.setHealth(a.health);
    }
  }

  damageSelf(dmg: number, byName: string) {
    if (!this.alive) return;
    this.health -= dmg;
    this.damageFlash = 0.6;
    if (this.health <= 0) this.killSelf(byName);
  }

  private killSelf(byName: string) {
    this.health = 0;
    this.alive = false;
    this.deaths++;
    this.respawnAt = 6;
    this.scores[this.opts.team === "alpha" ? "bravo" : "alpha"]++;
    this.pushFeed(`${byName} eliminated ${this.opts.playerName}`, "enemy");
  }

  private pushFeed(text: string, team: string) {
    this.killFeed.push({ id: this.feedId++, text, team });
    if (this.killFeed.length > 5) this.killFeed.shift();
    setTimeout(() => {
      this.killFeed = this.killFeed.filter((k) => k.text !== text || k.team !== team).slice(-5);
    }, 6000);
  }

  // ----------------------------------------------------------------- bots
  private updateBots(dt: number) {
    const simulate = this.opts.mode === "offline" || this.opts.isHost;
    for (const a of this.actors.values()) {
      if (!a.bot) continue;
      if (!simulate) {
        this.interpolate(a, dt);
        continue;
      }
      if (!a.alive) {
        a.respawnAt -= dt;
        if (a.respawnAt <= 0) {
          a.pos.copy(this.spawnPoint(a.team));
          a.health = 100;
          a.alive = true;
          a.char.setHealth(100);
          a.char.setVisible(true);
        }
        continue;
      }
      const ai = a.ai!;
      ai.think -= dt;
      ai.losCd -= dt;
      ai.fireCd -= dt;

      // target acquisition
      if (ai.think <= 0) {
        ai.think = 0.45;
        let bestD = 110;
        let best: { id: string; pos: THREE.Vector3 } | null = null;
        if (this.alive && this.opts.team !== a.team) {
          const d = a.pos.distanceTo(this.pos);
          if (d < bestD) {
            bestD = d;
            best = { id: "self", pos: this.pos };
          }
        }
        for (const o of this.actors.values()) {
          if (o === a || !o.alive || o.team === a.team) continue;
          const d = a.pos.distanceTo(o.pos);
          if (d < bestD) {
            bestD = d;
            best = { id: o.id, pos: o.pos };
          }
        }
        ai.targetId = best ? best.id : null;
        ai.mode = best ? "engage" : "patrol";
        if (!best && a.pos.distanceTo(ai.dest) < 4) ai.dest = this.randomPoint();
      }

      const target =
        ai.targetId === "self" ? { pos: this.pos, alive: this.alive } : ai.targetId ? this.actors.get(ai.targetId) : null;

      let moveTo = ai.dest;
      let wantFire = false;
      if (target && (target as { alive: boolean }).alive) {
        const tp = (target as { pos: THREE.Vector3 }).pos;
        const dist = a.pos.distanceTo(tp);
        a.yaw = Math.atan2(a.pos.x - tp.x, a.pos.z - tp.z);
        a.pitch = Math.atan2(tp.y + 1.3 - (a.pos.y + 1.5), Math.max(1, Math.hypot(tp.x - a.pos.x, tp.z - a.pos.z)));
        if (ai.losCd <= 0) {
          ai.losCd = 0.3;
          const dir = new THREE.Vector3(tp.x - a.pos.x, tp.y + 1.2 - (a.pos.y + 1.5), tp.z - a.pos.z).normalize();
          const origin = new THREE.Vector3(a.pos.x, a.pos.y + 1.5, a.pos.z);
          const hit = this.world.rayWorld(origin, dir, Math.min(dist, 120), 1.1);
          ai.los = !hit || hit.dist > dist - 2.2;
        }
        wantFire = ai.los && dist < 95;
        // keep preferred range, strafe while engaging
        const desired = 26;
        const dirToT = new THREE.Vector3(tp.x - a.pos.x, 0, tp.z - a.pos.z).normalize();
        const side = new THREE.Vector3(-dirToT.z, 0, dirToT.x).multiplyScalar(ai.strafe);
        const forward = dist > desired + 6 ? 1 : dist < desired - 8 ? -1 : 0;
        moveTo = a.pos
          .clone()
          .addScaledVector(dirToT, forward * 8)
          .addScaledVector(side, ai.los ? 5 : 8);
        a.stance = dist < 45 && ai.los && this.rng.next() > 0.995 ? 1 : a.stance;
      } else {
        a.stance = 0;
        if (a.pos.distanceTo(ai.dest) < 4) ai.dest = this.randomPoint();
        const d = new THREE.Vector3().subVectors(ai.dest, a.pos);
        a.yaw = Math.atan2(-d.x, -d.z);
      }

      // locomotion
      const dirv = new THREE.Vector3(moveTo.x - a.pos.x, 0, moveTo.z - a.pos.z);
      const len = dirv.length();
      const sp = ai.mode === "engage" ? 4.6 : 3.4;
      if (len > 0.5) {
        dirv.multiplyScalar(sp / len);
        a.vel.x += (dirv.x - a.vel.x) * Math.min(1, dt * 8);
        a.vel.z += (dirv.z - a.vel.z) * Math.min(1, dt * 8);
      } else {
        a.vel.x *= 0.8;
        a.vel.z *= 0.8;
      }
      a.vel.y += GRAVITY * dt;
      a.pos.x += a.vel.x * dt;
      a.pos.z += a.vel.z * dt;
      a.pos.y += a.vel.y * dt;
      this.world.collide(a.pos, 0.42, HEIGHT[a.stance]);
      const g = this.world.groundHeight(a.pos.x, a.pos.z, a.pos.y);
      if (a.pos.y <= g + 0.05) {
        a.pos.y = g;
        a.vel.y = 0;
        if (len > 0.5 && Math.hypot(a.vel.x, a.vel.z) < 1.2 && this.rng.next() > 0.9) a.vel.y = 6.5; // hop over obstacles
      }
      a.speed = Math.hypot(a.vel.x, a.vel.z);

      // firing
      a.firing = false;
      if (wantFire && target) {
        if (ai.burst <= 0 && ai.fireCd <= 0) {
          ai.burst = 3 + Math.floor(this.rng.next() * 3);
          ai.fireCd = 0.09;
        }
        if (ai.burst > 0 && ai.fireCd <= 0) {
          ai.burst--;
          ai.fireCd = ai.burst > 0 ? 0.1 : this.rng.range(0.7, 1.8);
          a.firing = true;
          this.botShoot(a, target as { pos: THREE.Vector3 }, ai.targetId!);
        }
      }
      a.char.group.position.copy(a.pos);
      a.char.group.rotation.y = a.yaw;
      a.char.update(dt, { speed: a.speed, stance: a.stance, aiming: wantFire, pitch: a.pitch, firing: a.firing });
    }
  }

  private botShoot(a: Actor, target: { pos: THREE.Vector3 }, targetId: string) {
    const def = WEAPONS[a.weapon] ?? WEAPONS.M416;
    const origin = new THREE.Vector3(a.pos.x, a.pos.y + 1.5, a.pos.z);
    const aim = new THREE.Vector3(target.pos.x, target.pos.y + 1.2, target.pos.z);
    const dist = origin.distanceTo(aim);
    const err = 0.02 + dist * 0.0022;
    aim.x += (this.rng.next() - 0.5) * err * dist;
    aim.y += (this.rng.next() - 0.5) * err * dist * 0.5;
    aim.z += (this.rng.next() - 0.5) * err * dist;
    const dir = aim.sub(origin).normalize();
    const envHit = this.world.rayWorld(origin, dir, def.range);
    const envDist = envHit ? envHit.dist : def.range;

    // did the shot land on the intended target?
    const tp = target.pos;
    const toT = new THREE.Vector3(tp.x - origin.x, tp.y + 1.1 - origin.y, tp.z - origin.z);
    const t = toT.dot(dir);
    let hit = false;
    if (t > 0 && t < envDist) {
      const px = origin.x + dir.x * t;
      const py = origin.y + dir.y * t;
      const pz = origin.z + dir.z * t;
      const d2 = (px - tp.x) ** 2 + (py - (tp.y + 1.1)) ** 2 + (pz - tp.z) ** 2;
      hit = d2 < 0.5;
    }
    const end = new THREE.Vector3().copy(origin).addScaledVector(dir, Math.min(envDist, dist + 4));
    this.spawnTracer(origin, end, 0xffd9a0);
    this.playShot(def.id, Math.max(0.08, 1 - dist / 90));

    if (hit) {
      if (targetId === "self") this.damageSelf(def.damage * 0.72, a.name);
      else {
        const victim = this.actors.get(targetId);
        if (victim && victim.bot) {
          victim.health -= def.damage * 0.72;
          victim.char.setHealth(victim.health);
          if (victim.health <= 0) {
            victim.alive = false;
            victim.char.setVisible(false);
            victim.respawnAt = 5;
            a.kills++;
            this.scores[a.team]++;
            this.pushFeed(`${a.name} eliminated ${victim.name}`, a.team);
          }
        }
      }
    }
  }

  // -------------------------------------------------------------- remotes
  private interpolate(a: Actor, dt: number) {
    if (a.netPos) {
      a.pos.lerp(a.netPos, Math.min(1, dt * 12));
      const dy = ((a.netYaw ?? a.yaw) - a.yaw + Math.PI * 3) % (Math.PI * 2) - Math.PI;
      a.yaw += dy * Math.min(1, dt * 12);
    }
    a.char.group.position.copy(a.pos);
    a.char.group.rotation.y = a.yaw;
    a.char.setVisible(a.alive);
    a.char.update(dt, { speed: a.speed, stance: a.stance, aiming: a.aiming, pitch: a.pitch, firing: a.firing });
  }

  private updateRemotes(dt: number) {
    const now = performance.now();
    for (const a of this.actors.values()) {
      if (a.bot) continue;
      if (now - a.lastSeen > 15000) {
        this.scene.remove(a.char.group);
        a.char.dispose();
        this.actors.delete(a.id);
        continue;
      }
      this.interpolate(a, dt);
    }
  }

  // ------------------------------------------------------------------ fx
  private spawnTracer(from: THREE.Vector3, to: THREE.Vector3, color = 0xfff0b0) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.scene.add(line);
    this.tracers.push({ line, life: 0.09 });

    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xcfc6b5, transparent: true, opacity: 0.8 }),
    );
    puff.position.copy(to);
    this.scene.add(puff);
    this.impacts.push({ mesh: puff, life: 0.35 });
  }

  private updateFx(dt: number) {
    this.muzzleTimer -= dt;
    this.muzzle.intensity = this.muzzleTimer > 0 ? 28 : 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      (t.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, t.life / 0.09) * 0.85;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        (t.line.material as THREE.Material).dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const p = this.impacts[i];
      p.life -= dt;
      p.mesh.scale.multiplyScalar(1 + dt * 4);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, p.life / 0.35) * 0.8;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.impacts.splice(i, 1);
      }
    }
    this.hitMarker = Math.max(0, this.hitMarker - dt);
    this.damageFlash = Math.max(0, this.damageFlash - dt);
    this.shakeTime = Math.max(0, this.shakeTime - dt);
  }

  private updateSun() {
    this.sun.position.set(this.pos.x + 70, this.pos.y + 130, this.pos.z + 50);
    this.sun.target.position.copy(this.pos);
    this.sun.target.updateMatrixWorld();
  }

  // -------------------------------------------------------------- camera
  private updateCamera(dt: number) {
    const eye = EYE[this.stance];
    const head = new THREE.Vector3(this.pos.x, this.pos.y + eye, this.pos.z);
    const pitch = THREE.MathUtils.clamp(this.pitch + this.recoil.x * 0.02, -1.3, 1.3);

    const def = this.weapons[this.slot].def;
    const baseFov = 74;
    const targetFov = this.aiming ? baseFov * def.zoom : this.sprinting ? baseFov + 6 : baseFov;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 9);
    this.camera.updateProjectionMatrix();

    const dirBack = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(pitch),
      -Math.sin(pitch),
      Math.cos(this.yaw) * Math.cos(pitch),
    );
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const distWanted = this.aiming ? (def.class === "SR" || def.class === "DMR" ? 0.1 : 1.4) : 3.4;
    const sideWanted = this.aiming ? (distWanted < 0.5 ? 0 : 0.45) : 0.75;

    const anchor = head.clone().addScaledVector(right, sideWanted + this.lean * 0.5);
    let dist = distWanted;
    const probe = this.world.rayWorld(anchor, dirBack, distWanted + 0.4);
    if (probe) dist = Math.max(0.12, probe.dist - 0.35);

    const camPos = anchor.clone().addScaledVector(dirBack, dist);
    this.camera.position.lerp(camPos, Math.min(1, dt * 22));
    // hide our own body when the camera is tight to the head (scoped)
    this.localCharacter.setVisible(this.alive && dist > 0.7);
    if (this.shakeTime > 0) {
      this.camera.position.x += (this.rng.next() - 0.5) * 0.03;
      this.camera.position.y += (this.rng.next() - 0.5) * 0.03;
    }
    const look = head.clone().addScaledVector(dirBack, -30).addScaledVector(right, this.lean * 0.5);
    this.camera.lookAt(look);
  }

  // --------------------------------------------------------------- audio
  private playShot(id: string, volume = 1) {
    try {
      if (!this.audio) this.audio = new AudioContext();
      const ctx = this.audio;
      if (ctx.state === "suspended") void ctx.resume();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const noiseLen = 0.14;
      osc.type = "square";
      const base = id === "Kar98k" ? 120 : id === "AKM" ? 190 : 240;
      osc.frequency.setValueAtTime(base, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + noiseLen);
      gain.gain.setValueAtTime(0.08 * volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + noiseLen);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + noiseLen);
    } catch {
      /* audio not available */
    }
  }

  // ------------------------------------------------------------ networking
  private selfState(): NetState {
    return {
      id: this.opts.playerId,
      name: this.opts.playerName,
      team: this.opts.team,
      bot: false,
      x: +this.pos.x.toFixed(2),
      y: +this.pos.y.toFixed(2),
      z: +this.pos.z.toFixed(2),
      yaw: +this.yaw.toFixed(3),
      pitch: +this.pitch.toFixed(3),
      stance: this.stance,
      speed: +Math.hypot(this.vel.x, this.vel.z).toFixed(2),
      aiming: this.aiming,
      firing: this.input.firing,
      health: this.health,
      alive: this.alive,
      weapon: this.weapons[this.slot].def.id,
      kills: this.kills,
      deaths: this.deaths,
      t: Date.now(),
    };
  }

  private botStates(): NetState[] {
    const out: NetState[] = [];
    for (const a of this.actors.values()) {
      if (!a.bot) continue;
      out.push({
        id: a.id,
        name: a.name,
        team: a.team,
        bot: true,
        x: +a.pos.x.toFixed(2),
        y: +a.pos.y.toFixed(2),
        z: +a.pos.z.toFixed(2),
        yaw: +a.yaw.toFixed(3),
        pitch: +a.pitch.toFixed(3),
        stance: a.stance,
        speed: +a.speed.toFixed(2),
        aiming: a.firing,
        firing: a.firing,
        health: Math.max(0, Math.round(a.health)),
        alive: a.alive,
        weapon: a.weapon,
        kills: a.kills,
        deaths: a.deaths,
        t: Date.now(),
      });
    }
    return out;
  }

  private async sync() {
    if (this.netBusy || !this.opts.roomCode) return;
    this.netBusy = true;
    const events = this.queued;
    this.queued = [];
    try {
      const res = await fetch(`/api/rooms/${this.opts.roomCode}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          playerId: this.opts.playerId,
          self: this.selfState(),
          bots: this.opts.isHost ? this.botStates() : undefined,
          events,
          lastEventId: this.lastEventId,
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as SyncResponse & {
        me: { health: number; alive: boolean; kills: number; deaths: number };
      };
      this.lastEventId = data.lastEventId;
      this.scores = data.scores;
      this.kills = data.me.kills;
      this.deaths = data.me.deaths;
      if (this.alive && data.me.health < this.health) this.damageFlash = 0.6;
      if (this.alive) {
        this.health = data.me.health;
        if (!data.me.alive) {
          this.alive = false;
          this.respawnAt = 6;
        }
      }
      this.applyStates(data.states);
      for (const ev of data.events) {
        if (ev.type === "hit") {
          const p = ev.payload as { target?: string; damage?: number; by?: string };
          if (this.opts.isHost && p.target?.startsWith("bot:") && p.by !== this.opts.playerId) {
            const bot = this.actors.get(p.target);
            if (bot && bot.alive) {
              bot.health -= Number(p.damage ?? 0);
              bot.char.setHealth(bot.health);
              if (bot.health <= 0) {
                bot.alive = false;
                bot.char.setVisible(false);
                bot.respawnAt = 5;
              }
            }
          }
        } else if (ev.type === "kill") {
          const p = ev.payload as { killer?: string; victim?: string };
          this.pushFeed(`${p.killer ?? "?"} eliminated ${p.victim ?? "?"}`, "net");
        } else if (ev.type === "system") {
          const p = ev.payload as { message?: string };
          if (p.message) this.pushFeed(p.message, "info");
        } else if (ev.type === "chat") {
          const p = ev.payload as { from?: string; message?: string };
          this.pushFeed(`${p.from}: ${p.message}`, "chat");
        }
      }
    } catch {
      /* transient network error */
    } finally {
      this.netBusy = false;
    }
  }

  private applyStates(states: NetState[]) {
    const now = performance.now();
    const hostSimulatesBots = this.opts.isHost;
    for (const s of states) {
      if (s.id === this.opts.playerId) continue;
      if (s.bot && hostSimulatesBots) continue;
      let a = this.actors.get(s.id);
      if (!a) {
        const char = new Character(
          TEAM_COLORS[s.team],
          s.name,
          s.team === this.opts.team ? "#8fd3ff" : "#ff9d8f",
        );
        this.scene.add(char.group);
        a = {
          id: s.id,
          name: s.name,
          team: s.team,
          bot: s.bot,
          char,
          pos: new THREE.Vector3(s.x, s.y, s.z),
          vel: new THREE.Vector3(),
          yaw: s.yaw,
          pitch: s.pitch,
          stance: s.stance,
          health: s.health,
          alive: s.alive,
          speed: s.speed,
          firing: s.firing,
          aiming: s.aiming,
          weapon: s.weapon,
          kills: s.kills,
          deaths: s.deaths,
          lastSeen: now,
          respawnAt: 0,
        };
        this.actors.set(s.id, a);
      }
      a.netPos = new THREE.Vector3(s.x, s.y, s.z);
      a.netYaw = s.yaw;
      a.pitch = s.pitch;
      a.stance = s.stance;
      a.speed = s.speed;
      a.aiming = s.aiming;
      a.firing = s.firing;
      a.weapon = s.weapon;
      a.alive = s.alive;
      a.lastSeen = now;
      if (a.health !== s.health) {
        a.health = s.health;
        a.char.setHealth(s.health);
      }
    }
  }

  // ------------------------------------------------------------------ hud
  private pushHud() {
    const blips: Blip[] = [{ x: this.pos.x, z: this.pos.z, team: this.opts.team, bot: false, self: true }];
    let aliveCount = this.alive ? 1 : 0;
    for (const a of this.actors.values()) {
      if (!a.alive) continue;
      aliveCount++;
      const d = Math.hypot(a.pos.x - this.pos.x, a.pos.z - this.pos.z);
      if (a.team === this.opts.team || d < 85) blips.push({ x: a.pos.x, z: a.pos.z, team: a.team, bot: a.bot });
    }
    const w = this.weapons[this.slot];
    const fps = this.frameTimes.length
      ? Math.round(1 / (this.frameTimes.reduce((s, v) => s + v, 0) / this.frameTimes.length))
      : 60;
    this.opts.hud.set({
      health: Math.max(0, Math.round(this.health)),
      alive: this.alive,
      respawnIn: Math.max(0, Math.ceil(this.respawnAt)),
      stance: this.stance,
      aiming: this.aiming,
      sprinting: this.sprinting,
      weaponName: w.def.name,
      weaponClass: w.def.class,
      ammo: w.ammo,
      reserve: w.reserve,
      reloading: w.reloading > 0,
      slot: this.slot,
      slots: this.weapons.map((x) => ({ name: x.def.name, ammo: x.ammo, reserve: x.reserve })),
      kills: this.kills,
      deaths: this.deaths,
      scoreAlpha: this.scores.alpha,
      scoreBravo: this.scores.bravo,
      alivePlayers: aliveCount,
      killFeed: [...this.killFeed],
      backpack: [...this.backpack.entries()].map(([name, v]) => ({ name, kind: v.kind, count: v.count })),
      prompt: this.promptText,
      fps,
      heading: ((this.yaw * 180) / Math.PI + 360) % 360,
      blips,
      playerX: this.pos.x,
      playerZ: this.pos.z,
      playerYaw: this.yaw,
      hitMarker: this.hitMarker,
      damageFlash: this.damageFlash,
      connection: this.opts.mode === "online" ? "online" : "offline",
    });
  }

  // --------------------------------------------------------------- system
  setSlot(i: 0 | 1) {
    this.slot = i;
  }
  doReload() {
    this.reload();
  }
  doHeal() {
    this.heal();
  }
  doPickup() {
    this.pickup();
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  };

  setPaused(p: boolean) {
    this.paused = p;
    this.input.enabled = !p;
    if (p) document.exitPointerLock?.();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.input.dispose();
    for (const a of this.actors.values()) a.char.dispose();
    this.localCharacter.dispose();
    this.world.dispose();
    this.renderer.dispose();
    void this.audio?.close();
  }
}
