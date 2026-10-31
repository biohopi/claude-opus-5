import * as THREE from "three";
import type { Stance } from "@/lib/types";

const SHARED = {
  box: new THREE.BoxGeometry(1, 1, 1),
  caps: new THREE.CapsuleGeometry(0.5, 1, 4, 8),
};

function nameplate(text: string, color: string) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 256, 64);
  ctx.font = "bold 30px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.strokeText(text, 128, 40);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 40);
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  spr.scale.set(2.6, 0.65, 1);
  spr.renderOrder = 999;
  return spr;
}

export class Character {
  public group = new THREE.Group();
  public body = new THREE.Group();
  public gun = new THREE.Group();
  private legL: THREE.Mesh;
  private legR: THREE.Mesh;
  private armL: THREE.Group;
  private armR: THREE.Group;
  private torso: THREE.Mesh;
  private head: THREE.Group;
  private plate?: THREE.Sprite;
  private hpBar?: THREE.Sprite;
  private hpCtx?: CanvasRenderingContext2D;
  private hpTex?: THREE.CanvasTexture;
  private phase = 0;
  private mats: THREE.Material[] = [];

  constructor(teamColor: number, name?: string, nameColor = "#ffffff") {
    const uniform = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.78, metalness: 0.08 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x25282d, roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc69b77, roughness: 0.9 });
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x33383f, roughness: 0.55, metalness: 0.5 });
    this.mats.push(uniform, dark, skin, gunMat);

    this.torso = new THREE.Mesh(SHARED.box, uniform);
    this.torso.scale.set(0.62, 0.78, 0.36);
    this.torso.position.y = 1.18;
    this.body.add(this.torso);

    const vest = new THREE.Mesh(SHARED.box, dark);
    vest.scale.set(0.68, 0.5, 0.42);
    vest.position.y = 1.3;
    this.body.add(vest);

    const pack = new THREE.Mesh(SHARED.box, dark);
    pack.scale.set(0.46, 0.5, 0.24);
    pack.position.set(0, 1.26, 0.26);
    this.body.add(pack);

    this.head = new THREE.Group();
    const skull = new THREE.Mesh(SHARED.box, skin);
    skull.scale.set(0.27, 0.3, 0.28);
    this.head.add(skull);
    const helmet = new THREE.Mesh(SHARED.box, dark);
    helmet.scale.set(0.32, 0.17, 0.33);
    helmet.position.y = 0.11;
    this.head.add(helmet);
    this.head.position.y = 1.74;
    this.body.add(this.head);

    const mkArm = (side: number) => {
      const g = new THREE.Group();
      const upper = new THREE.Mesh(SHARED.box, uniform);
      upper.scale.set(0.16, 0.56, 0.17);
      upper.position.y = -0.26;
      g.add(upper);
      const hand = new THREE.Mesh(SHARED.box, skin);
      hand.scale.set(0.13, 0.14, 0.14);
      hand.position.y = -0.56;
      g.add(hand);
      g.position.set(side * 0.38, 1.5, 0);
      return g;
    };
    this.armL = mkArm(-1);
    this.armR = mkArm(1);
    this.body.add(this.armL, this.armR);

    const mkLeg = (side: number) => {
      const l = new THREE.Mesh(SHARED.box, dark);
      l.scale.set(0.2, 0.84, 0.22);
      l.position.set(side * 0.16, 0.42, 0);
      return l;
    };
    this.legL = mkLeg(-1);
    this.legR = mkLeg(1);
    this.body.add(this.legL, this.legR);

    // rifle
    const barrel = new THREE.Mesh(SHARED.box, gunMat);
    barrel.scale.set(0.07, 0.08, 0.95);
    barrel.position.z = -0.35;
    const stock = new THREE.Mesh(SHARED.box, gunMat);
    stock.scale.set(0.09, 0.19, 0.42);
    stock.position.z = 0.22;
    const magz = new THREE.Mesh(SHARED.box, gunMat);
    magz.scale.set(0.07, 0.25, 0.1);
    magz.position.set(0, -0.16, -0.1);
    const scope = new THREE.Mesh(SHARED.box, gunMat);
    scope.scale.set(0.06, 0.08, 0.3);
    scope.position.set(0, 0.11, -0.18);
    this.gun.add(barrel, stock, magz, scope);
    this.gun.position.set(0.3, 1.38, -0.28);
    this.body.add(this.gun);

    this.body.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });

    this.group.add(this.body);

    if (name) {
      this.plate = nameplate(name, nameColor);
      this.plate.position.y = 2.35;
      this.group.add(this.plate);

      const c = document.createElement("canvas");
      c.width = 128;
      c.height = 16;
      this.hpCtx = c.getContext("2d")!;
      this.hpTex = new THREE.CanvasTexture(c);
      this.hpBar = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.hpTex, depthTest: false, transparent: true }),
      );
      this.hpBar.scale.set(1.6, 0.2, 1);
      this.hpBar.position.y = 2.08;
      this.hpBar.renderOrder = 999;
      this.group.add(this.hpBar);
      this.setHealth(100);
    }
  }

  setHealth(hp: number) {
    if (!this.hpCtx || !this.hpTex) return;
    const ctx = this.hpCtx;
    ctx.clearRect(0, 0, 128, 16);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 2, 128, 12);
    const f = Math.max(0, Math.min(1, hp / 100));
    ctx.fillStyle = f > 0.5 ? "#6fe06f" : f > 0.25 ? "#ffcc55" : "#ff5555";
    ctx.fillRect(2, 4, 124 * f, 8);
    this.hpTex.needsUpdate = true;
  }

  setVisible(v: boolean) {
    this.group.visible = v;
  }

  /** Procedural animation state machine (idle / walk / sprint / crouch / prone / aim). */
  update(dt: number, opts: { speed: number; stance: Stance; aiming: boolean; pitch: number; firing: boolean }) {
    const { speed, stance, aiming, pitch } = opts;
    const moving = speed > 0.3;
    const freq = stance === 2 ? 4 : speed > 7 ? 12 : 8;
    this.phase += dt * (moving ? freq : 2.5);

    const swing = moving ? Math.min(1, speed / 7) * 0.72 : 0;
    this.legL.rotation.x = Math.sin(this.phase) * swing;
    this.legR.rotation.x = -Math.sin(this.phase) * swing;

    const crouch = stance === 1 ? 1 : 0;
    const prone = stance === 2 ? 1 : 0;

    // body height / pose
    const targetY = -(crouch * 0.42 + prone * 0.78);
    this.body.position.y += (targetY - this.body.position.y) * Math.min(1, dt * 12);
    const targetTilt = prone * (Math.PI / 2 - 0.12);
    this.body.rotation.x += (targetTilt - this.body.rotation.x) * Math.min(1, dt * 10);

    const legBend = crouch * 0.6;
    this.legL.rotation.x -= legBend;
    this.legR.rotation.x -= legBend;

    // arms: aim forward when aiming, otherwise bob with the stride
    const aimLift = aiming ? -1.45 : -1.05;
    const bob = moving && !aiming ? Math.sin(this.phase) * 0.25 : 0;
    this.armR.rotation.x += (aimLift - this.armR.rotation.x) * Math.min(1, dt * 14);
    this.armL.rotation.x += (aimLift - 0.08 + bob - this.armL.rotation.x) * Math.min(1, dt * 14);
    this.armL.rotation.z = 0.35;
    this.armR.rotation.z = -0.2;

    // weapon follows pitch (upper-body IK-ish)
    const gy = 1.38 - crouch * 0.05;
    this.gun.position.set(aiming ? 0.08 : 0.3, gy, aiming ? -0.42 : -0.28);
    this.gun.rotation.x += (-pitch - this.gun.rotation.x) * Math.min(1, dt * 16);
    this.torso.rotation.x = -pitch * 0.25;
    this.head.rotation.x = -pitch * 0.6;

    if (this.plate) this.plate.position.y = 2.35 + targetY;
    if (this.hpBar) this.hpBar.position.y = 2.08 + targetY;
  }

  dispose() {
    for (const m of this.mats) m.dispose();
    if (this.plate) {
      (this.plate.material as THREE.SpriteMaterial).map?.dispose();
      this.plate.material.dispose();
    }
    if (this.hpBar) {
      this.hpTex?.dispose();
      this.hpBar.material.dispose();
    }
  }
}
