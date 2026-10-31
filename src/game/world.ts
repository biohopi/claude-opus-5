import * as THREE from "three";
import { RNG, fbm } from "./noise";

export interface Box {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  solid: boolean;
}

export interface LootItem {
  id: number;
  kind: "weapon" | "ammo" | "med" | "armor";
  name: string;
  x: number;
  y: number;
  z: number;
  taken: boolean;
  mesh: THREE.Object3D;
}

export const MAP_SIZE = 520;
export const PLAY_RADIUS = 230;
const CELL = 8;

export class World {
  public group = new THREE.Group();
  public boxes: Box[] = [];
  public loot: LootItem[] = [];
  public buildings: { x: number; z: number; w: number; d: number; base: number }[] = [];
  public spawns: { alpha: THREE.Vector3[]; bravo: THREE.Vector3[] } = { alpha: [], bravo: [] };
  private grid = new Map<string, Box[]>();
  private rng: RNG;
  private materials: THREE.Material[] = [];
  private windMaterials: THREE.ShaderMaterial[] = [];
  private uniforms = { uTime: { value: 0 } };

  constructor(public seed: number) {
    this.rng = new RNG(seed * 7919 + 13);
  }

  // ---------------------------------------------------------------- terrain
  heightAt(x: number, z: number): number {
    const n1 = fbm(x * 0.0055, z * 0.0055, this.seed, 4);
    const n2 = fbm(x * 0.02, z * 0.02, this.seed + 91, 3);
    let h = (n1 - 0.45) * 46 + (n2 - 0.5) * 5.5;
    // bowl-shaped border mountains so the arena is naturally bounded
    const d = Math.sqrt(x * x + z * z);
    if (d > PLAY_RADIUS) {
      const t = Math.min(1, (d - PLAY_RADIUS) / 60);
      h += t * t * 70;
    }
    // flatten the central town plateau
    const town = Math.max(0, 1 - d / 110);
    h = h * (1 - town * 0.65) + 4 * town * 0.65;
    return h;
  }

  slopeAt(x: number, z: number) {
    const e = 1.5;
    const hL = this.heightAt(x - e, z);
    const hR = this.heightAt(x + e, z);
    const hD = this.heightAt(x, z - e);
    const hU = this.heightAt(x, z + e);
    return Math.min(1, Math.hypot(hR - hL, hU - hD) / (2 * e) / 1.4);
  }

  // ------------------------------------------------------------- collisions
  private key(cx: number, cz: number) {
    return cx + "," + cz;
  }

  private indexBox(b: Box) {
    const x0 = Math.floor((b.x - b.hx) / CELL);
    const x1 = Math.floor((b.x + b.hx) / CELL);
    const z0 = Math.floor((b.z - b.hz) / CELL);
    const z1 = Math.floor((b.z + b.hz) / CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this.key(cx, cz);
        const arr = this.grid.get(k);
        if (arr) arr.push(b);
        else this.grid.set(k, [b]);
      }
    }
  }

  private stamp = 1;
  private stamps = new WeakMap<Box, number>();
  private scratch: Box[] = [];

  /** Boxes in the cells around (x,z). The returned array is reused — do not retain it. */
  nearBoxes(x: number, z: number, pad = 1): Box[] {
    const out = this.scratch;
    out.length = 0;
    const s = ++this.stamp;
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    const r = Math.ceil(pad / CELL);
    for (let i = cx - r; i <= cx + r; i++) {
      for (let j = cz - r; j <= cz + r; j++) {
        const arr = this.grid.get(this.key(i, j));
        if (!arr) continue;
        for (const b of arr) {
          if (this.stamps.get(b) === s) continue;
          this.stamps.set(b, s);
          out.push(b);
        }
      }
    }
    return out;
  }

  cellBoxes(x: number, z: number): Box[] | undefined {
    return this.grid.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL)));
  }

  /** Highest supporting surface under (or slightly above) the feet. */
  groundHeight(x: number, z: number, feetY: number, stepUp = 0.65) {
    let g = this.heightAt(x, z);
    for (const b of this.nearBoxes(x, z, 2)) {
      if (!b.solid) continue;
      if (x < b.x - b.hx - 0.3 || x > b.x + b.hx + 0.3) continue;
      if (z < b.z - b.hz - 0.3 || z > b.z + b.hz + 0.3) continue;
      const top = b.y + b.hy;
      if (top <= feetY + stepUp && top > g) g = top;
    }
    return g;
  }

  /** Push a vertical cylinder out of solid boxes. Mutates pos. */
  collide(pos: THREE.Vector3, radius: number, height: number) {
    const feet = pos.y;
    const head = pos.y + height;
    for (let iter = 0; iter < 2; iter++) {
      for (const b of this.nearBoxes(pos.x, pos.z, radius + 1)) {
        if (!b.solid) continue;
        const top = b.y + b.hy;
        const bottom = b.y - b.hy;
        if (top <= feet + 0.65 || bottom >= head) continue; // walkable / above head
        const cx = Math.max(b.x - b.hx, Math.min(pos.x, b.x + b.hx));
        const cz = Math.max(b.z - b.hz, Math.min(pos.z, b.z + b.hz));
        const dx = pos.x - cx;
        const dz = pos.z - cz;
        const dist2 = dx * dx + dz * dz;
        if (dist2 > radius * radius) continue;
        const dist = Math.sqrt(dist2);
        if (dist > 0.0001) {
          const push = radius - dist;
          pos.x += (dx / dist) * push;
          pos.z += (dz / dist) * push;
        } else {
          // inside: push along smallest penetration axis
          const px = b.hx + radius - Math.abs(pos.x - b.x);
          const pz = b.hz + radius - Math.abs(pos.z - b.z);
          if (px < pz) pos.x += pos.x > b.x ? px : -px;
          else pos.z += pos.z > b.z ? pz : -pz;
        }
      }
    }
  }

  /** March a ray against terrain + boxes; returns the first hit or null. */
  rayWorld(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, step = 0.5) {
    const p = origin.clone();
    const d = dir.clone().normalize().multiplyScalar(step);
    let cellX = NaN;
    let cellZ = NaN;
    let boxes: Box[] | undefined;
    for (let t = 0; t < maxDist; t += step) {
      p.add(d);
      if (p.y < this.heightAt(p.x, p.z)) return { point: p.clone(), dist: t };
      const cx = Math.floor(p.x / CELL);
      const cz = Math.floor(p.z / CELL);
      if (cx !== cellX || cz !== cellZ) {
        cellX = cx;
        cellZ = cz;
        boxes = this.grid.get(this.key(cx, cz));
      }
      if (boxes) {
        for (let i = 0; i < boxes.length; i++) {
          const b = boxes[i];
          if (!b.solid) continue;
          if (Math.abs(p.x - b.x) < b.hx && Math.abs(p.y - b.y) < b.hy && Math.abs(p.z - b.z) < b.hz)
            return { point: p.clone(), dist: t };
        }
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ build
  build(scene: THREE.Scene) {
    scene.add(this.group);
    this.buildSky(scene);
    this.buildTerrain();
    this.layoutTown();
    this.buildFoliage();
    this.buildLoot();
    for (const b of this.boxes) this.indexBox(b);
    this.makeSpawns();
  }

  private buildSky(scene: THREE.Scene) {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          top: { value: new THREE.Color(0x2e6fb7) },
          mid: { value: new THREE.Color(0x9ec9e8) },
          bottom: { value: new THREE.Color(0xe7d9b8) },
        },
        vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `
          varying vec3 vPos; uniform vec3 top; uniform vec3 mid; uniform vec3 bottom;
          void main(){
            float h = normalize(vPos).y;
            vec3 c = mix(bottom, mid, smoothstep(-0.12, 0.22, h));
            c = mix(c, top, smoothstep(0.2, 0.75, h));
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    sky.frustumCulled = false;
    scene.add(sky);
    scene.fog = new THREE.FogExp2(0xb9cfdd, 0.0026);
  }

  private detailTexture() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(128, 128);
    for (let i = 0; i < 128 * 128; i++) {
      const v = 150 + Math.random() * 105;
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(140, 140);
    tex.anisotropy = 4;
    return tex;
  }

  private buildTerrain() {
    const seg = 200;
    const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const grass = new THREE.Color(0x5c7a3a);
    const grass2 = new THREE.Color(0x76913f);
    const dirt = new THREE.Color(0x7a6442);
    const rock = new THREE.Color(0x6e6a63);
    const sand = new THREE.Color(0xc8b98a);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = this.heightAt(x, z);
      pos.setY(i, h);
      const slope = this.slopeAt(x, z);
      tmp.copy(grass).lerp(grass2, fbm(x * 0.03, z * 0.03, this.seed + 5, 2));
      if (h < 1.6) tmp.lerp(sand, Math.min(1, (1.6 - h) / 1.6));
      if (slope > 0.3) tmp.lerp(dirt, Math.min(1, (slope - 0.3) / 0.3));
      if (slope > 0.55) tmp.lerp(rock, Math.min(1, (slope - 0.55) / 0.35));
      if (h > 34) tmp.lerp(rock, Math.min(1, (h - 34) / 18));
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.98,
      metalness: 0,
      map: this.detailTexture(),
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.materials.push(mat);

    // water
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, 1, 1),
      new THREE.MeshStandardMaterial({
        color: 0x1c4f63,
        transparent: true,
        opacity: 0.82,
        roughness: 0.12,
        metalness: 0.35,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.2;
    this.group.add(water);
  }

  // ------------------------------------------------------------- structures
  private addBox(
    list: { m: THREE.Matrix4; mat: number }[],
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    mat: number,
    solid = true,
    rotY = 0,
  ) {
    const m = new THREE.Matrix4();
    m.compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
      new THREE.Vector3(w, h, d),
    );
    list.push({ m, mat });
    if (solid) {
      // axis-aligned approximation (buildings are axis aligned)
      const cos = Math.abs(Math.cos(rotY));
      const sin = Math.abs(Math.sin(rotY));
      this.boxes.push({
        x,
        y,
        z,
        hx: (w * cos + d * sin) / 2,
        hy: h / 2,
        hz: (d * cos + w * sin) / 2,
        solid: true,
      });
    }
  }

  private building(
    list: { m: THREE.Matrix4; mat: number }[],
    cx: number,
    cz: number,
    w: number,
    d: number,
    floors: number,
  ) {
    const base = this.heightAt(cx, cz);
    const fh = 3.2;
    const t = 0.28;
    this.buildings.push({ x: cx, z: cz, w, d, base });

    // foundation
    this.addBox(list, cx, base - 0.3, cz, w + 1.2, 0.8, d + 1.2, 0);

    for (let f = 0; f < floors; f++) {
      const y0 = base + f * fh;
      const yc = y0 + fh / 2;
      const doorW = f === 0 ? 2.6 : 2.2;

      // four walls, each split around an opening
      const sides: { ax: "x" | "z"; sign: number }[] = [
        { ax: "z", sign: -1 },
        { ax: "z", sign: 1 },
        { ax: "x", sign: -1 },
        { ax: "x", sign: 1 },
      ];
      for (const s of sides) {
        const len = s.ax === "z" ? w : d;
        const seg = (len - doorW) / 2;
        for (const dir of [-1, 1]) {
          const off = dir * (doorW / 2 + seg / 2);
          if (s.ax === "z") {
            this.addBox(list, cx + off, yc, cz + s.sign * (d / 2), seg, fh, t, 0);
          } else {
            this.addBox(list, cx + s.sign * (w / 2), yc, cz + off, t, fh, seg, 0);
          }
        }
        // lintel above the opening + glass pane on upper floors
        const lintelY = y0 + fh - 0.55;
        if (s.ax === "z") {
          this.addBox(list, cx, lintelY, cz + s.sign * (d / 2), doorW, 1.1, t, 0);
          if (f > 0) this.addBox(list, cx, y0 + 1.7, cz + s.sign * (d / 2), doorW, 1.5, 0.08, 2, false);
        } else {
          this.addBox(list, cx + s.sign * (w / 2), lintelY, cz, t, 1.1, doorW, 0);
          if (f > 0) this.addBox(list, cx + s.sign * (w / 2), y0 + 1.7, cz, 0.08, 1.5, doorW, 2, false);
        }
        if (f > 0) {
          // sill under upper-floor openings so players don't fall out instantly
          if (s.ax === "z") this.addBox(list, cx, y0 + 0.45, cz + s.sign * (d / 2), doorW, 0.9, t, 1);
          else this.addBox(list, cx + s.sign * (w / 2), y0 + 0.45, cz, t, 0.9, doorW, 1);
        }
      }

      // ceiling slab with a stairwell hole in the -x/-z quadrant
      const ceilY = y0 + fh;
      const holeW = 3.4;
      const holeD = 3.4;
      const slabT = 0.3;
      // slab split into 3 pieces around the hole
      this.addBox(list, cx + holeW / 2 / 2, ceilY, cz, w - holeW, slabT, d, f === floors - 1 ? 1 : 0);
      this.addBox(
        list,
        cx - (w - holeW) / 2,
        ceilY,
        cz + holeD / 2 + (d - holeD) / 4,
        holeW,
        slabT,
        (d - holeD) / 2,
        f === floors - 1 ? 1 : 0,
      );
      this.addBox(
        list,
        cx - (w - holeW) / 2,
        ceilY,
        cz - holeD / 2 - (d - holeD) / 4,
        holeW,
        slabT,
        (d - holeD) / 2,
        f === floors - 1 ? 1 : 0,
      );

      // staircase up to the next level
      if (f < floors - 1) {
        const steps = 11;
        for (let i = 0; i < steps; i++) {
          const sy = y0 + ((i + 1) / steps) * fh - fh / steps / 2;
          const sz = cz - holeD / 2 + (i / steps) * holeD * 0.95;
          this.addBox(
            list,
            cx - (w - holeW) / 2,
            sy - 0.15,
            sz,
            holeW - 0.4,
            fh / steps,
            holeD / steps + 0.3,
            1,
          );
        }
      }
    }

    // roof parapet + props
    const roofY = base + floors * fh;
    this.addBox(list, cx, roofY + 0.5, cz - d / 2, w, 1, 0.3, 0);
    this.addBox(list, cx, roofY + 0.5, cz + d / 2, w, 1, 0.3, 0);
    this.addBox(list, cx - w / 2, roofY + 0.5, cz, 0.3, 1, d, 0);
    this.addBox(list, cx + w / 2, roofY + 0.5, cz, 0.3, 1, d, 0);
    this.addBox(list, cx + w / 4, roofY + 0.9, cz + d / 4, 1.6, 1.8, 1.6, 1);
  }

  private layoutTown() {
    const list: { m: THREE.Matrix4; mat: number }[] = [];
    const placed: { x: number; z: number; r: number }[] = [];
    const tryPlace = (x: number, z: number, r: number) => {
      for (const p of placed) if (Math.hypot(p.x - x, p.z - z) < p.r + r + 7) return false;
      placed.push({ x, z, r });
      return true;
    };

    // central town: grid-ish blocks
    for (let i = 0; i < 26; i++) {
      const gx = (i % 6) - 2.5;
      const gz = Math.floor(i / 6) - 2;
      const x = gx * 32 + this.rng.range(-5, 5);
      const z = gz * 34 + this.rng.range(-5, 5);
      const w = this.rng.range(11, 17);
      const d = this.rng.range(11, 17);
      if (!tryPlace(x, z, Math.max(w, d) / 2)) continue;
      this.building(list, x, z, w, d, this.rng.next() > 0.35 ? 3 : 2);
    }
    // outskirt compounds
    for (let i = 0; i < 18; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(120, 205);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const w = this.rng.range(9, 14);
      const d = this.rng.range(9, 14);
      if (!tryPlace(x, z, Math.max(w, d) / 2)) continue;
      this.building(list, x, z, w, d, this.rng.next() > 0.5 ? 3 : 1);
    }

    // walls / containers / cover props scattered around
    for (let i = 0; i < 140; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(15, 215);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = this.heightAt(x, z);
      const kind = this.rng.next();
      if (kind < 0.4) this.addBox(list, x, y + 1, z, this.rng.range(4, 9), 2, 0.5, 0, true, this.rng.range(0, 3.14));
      else if (kind < 0.75) this.addBox(list, x, y + 1.3, z, 6, 2.6, 2.6, 1, true, this.rng.range(0, 3.14));
      else this.addBox(list, x, y + 0.6, z, 1.4, 1.2, 1.4, 1);
    }

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mats = [
      new THREE.MeshStandardMaterial({ color: 0xc3bcae, roughness: 0.92, metalness: 0.02 }),
      new THREE.MeshStandardMaterial({ color: 0x8a6243, roughness: 0.8, metalness: 0.05 }),
      new THREE.MeshPhysicalMaterial({
        color: 0x9fd0e8,
        roughness: 0.08,
        metalness: 0.1,
        transparent: true,
        opacity: 0.35,
      }),
    ];
    this.materials.push(...mats);
    for (let m = 0; m < 3; m++) {
      const subset = list.filter((b) => b.mat === m);
      if (!subset.length) continue;
      const inst = new THREE.InstancedMesh(geo, mats[m], subset.length);
      inst.castShadow = m !== 2;
      inst.receiveShadow = true;
      subset.forEach((b, i) => inst.setMatrixAt(i, b.m));
      inst.instanceMatrix.needsUpdate = true;
      this.group.add(inst);
    }
  }

  // ---------------------------------------------------------------- foliage
  private buildFoliage() {
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.38, 5, 6);
    trunkGeo.translate(0, 2.5, 0);
    const leafGeo = new THREE.IcosahedronGeometry(2.6, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4430, roughness: 1 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f6b2e, roughness: 0.95, flatShading: true });
    this.materials.push(trunkMat, leafMat);

    const trees: THREE.Matrix4[] = [];
    const leaves: THREE.Matrix4[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < 1400; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = Math.sqrt(this.rng.next()) * (PLAY_RADIUS + 25);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = this.heightAt(x, z);
      if (y < 1.4 || this.slopeAt(x, z) > 0.55) continue;
      let blocked = false;
      for (const b of this.buildings) if (Math.hypot(b.x - x, b.z - z) < Math.max(b.w, b.d) * 0.8 + 4) blocked = true;
      if (blocked) continue;
      const s = this.rng.range(0.8, 1.5);
      q.setFromEuler(new THREE.Euler(0, this.rng.range(0, 6.28), 0));
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
      trees.push(m.clone());
      m.compose(
        new THREE.Vector3(x, y + 4.6 * s, z),
        q,
        new THREE.Vector3(s * this.rng.range(0.8, 1.15), s * this.rng.range(0.75, 1.1), s),
      );
      leaves.push(m.clone());
      this.boxes.push({ x, y: y + 2.5 * s, z, hx: 0.35, hy: 2.5 * s, hz: 0.35, solid: true });
    }
    const t1 = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
    const t2 = new THREE.InstancedMesh(leafGeo, leafMat, leaves.length);
    trees.forEach((mm, i) => t1.setMatrixAt(i, mm));
    leaves.forEach((mm, i) => t2.setMatrixAt(i, mm));
    t1.castShadow = t2.castShadow = true;
    t1.receiveShadow = t2.receiveShadow = true;
    this.group.add(t1, t2);

    // rocks
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x79756d, roughness: 1, flatShading: true });
    this.materials.push(rockMat);
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 420);
    for (let i = 0; i < 420; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = Math.sqrt(this.rng.next()) * (PLAY_RADIUS + 40);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = this.heightAt(x, z);
      const s = this.rng.range(0.6, 2.6);
      q.setFromEuler(new THREE.Euler(this.rng.range(0, 1), this.rng.range(0, 6.28), this.rng.range(0, 1)));
      m.compose(new THREE.Vector3(x, y + s * 0.4, z), q, new THREE.Vector3(s, s * 0.8, s));
      rocks.setMatrixAt(i, m);
      if (s > 1.4) this.boxes.push({ x, y: y + s * 0.4, z, hx: s * 0.8, hy: s * 0.6, hz: s * 0.8, solid: true });
    }
    rocks.castShadow = rocks.receiveShadow = true;
    this.group.add(rocks);

    // wind-animated grass tufts
    const blade = new THREE.PlaneGeometry(0.9, 0.85, 1, 2);
    blade.translate(0, 0.42, 0);
    const tuft = blade;
    const grassMat = new THREE.MeshStandardMaterial({
      color: 0x6f8f3e,
      roughness: 1,
      side: THREE.DoubleSide,
    });
    grassMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
           float sway = sin(uTime * 1.6 + instanceMatrix[3][0] * 0.35 + instanceMatrix[3][2] * 0.21) * 0.22;
           transformed.x += sway * max(position.y, 0.0);
           transformed.z += sway * 0.6 * max(position.y, 0.0);`,
        );
      this.windMaterials.push(shader as unknown as THREE.ShaderMaterial);
    };
    this.materials.push(grassMat);
    const count = 9000;
    const grass = new THREE.InstancedMesh(tuft, grassMat, count * 2);
    let gi = 0;
    for (let i = 0; i < count; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = Math.sqrt(this.rng.next()) * PLAY_RADIUS;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = this.heightAt(x, z);
      if (y < 1.3) continue;
      const s = this.rng.range(0.7, 1.7);
      const rot = this.rng.range(0, 6.28);
      q.setFromEuler(new THREE.Euler(0, rot, 0));
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
      grass.setMatrixAt(gi++, m);
      q.setFromEuler(new THREE.Euler(0, rot + Math.PI / 2, 0));
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
      grass.setMatrixAt(gi++, m);
    }
    grass.count = gi;
    grass.instanceMatrix.needsUpdate = true;
    this.group.add(grass);
  }

  // ------------------------------------------------------------------- loot
  private buildLoot() {
    const defs: { kind: LootItem["kind"]; name: string; color: number }[] = [
      { kind: "weapon", name: "M416", color: 0x3f4d5c },
      { kind: "weapon", name: "AKM", color: 0x5c4634 },
      { kind: "weapon", name: "UMP45", color: 0x4a4a52 },
      { kind: "weapon", name: "Kar98k", color: 0x6b4f33 },
      { kind: "weapon", name: "SLR", color: 0x45504a },
      { kind: "ammo", name: "Ammo Box", color: 0xb8a24a },
      { kind: "ammo", name: "Ammo Box", color: 0xb8a24a },
      { kind: "med", name: "Med Kit", color: 0xd14f4f },
      { kind: "med", name: "Bandage", color: 0xe8e8e8 },
      { kind: "armor", name: "Lv3 Vest", color: 0x4f7fb8 },
    ];
    let id = 1;
    const spawnAt = (x: number, z: number) => {
      const def = this.rng.pick(defs);
      const y = this.groundHeightNoGrid(x, z) + 0.6;
      const geo =
        def.kind === "weapon"
          ? new THREE.BoxGeometry(1.0, 0.16, 0.16)
          : def.kind === "med"
            ? new THREE.BoxGeometry(0.42, 0.3, 0.3)
            : new THREE.BoxGeometry(0.4, 0.4, 0.4);
      const mat = new THREE.MeshStandardMaterial({
        color: def.color,
        emissive: new THREE.Color(def.color).multiplyScalar(0.22),
        roughness: 0.5,
        metalness: 0.3,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      const halo = new THREE.Mesh(
        new THREE.RingGeometry(0.5, 0.72, 16),
        new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = -0.55;
      mesh.add(halo);
      this.group.add(mesh);
      this.loot.push({ id: id++, kind: def.kind, name: def.name, x, y, z, taken: false, mesh });
    };

    for (const b of this.buildings) {
      const n = this.rng.int(2, 5);
      for (let i = 0; i < n; i++) {
        spawnAt(b.x + this.rng.range(-b.w / 2 + 1.5, b.w / 2 - 1.5), b.z + this.rng.range(-b.d / 2 + 1.5, b.d / 2 - 1.5));
      }
    }
    for (let i = 0; i < 90; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const r = Math.sqrt(this.rng.next()) * PLAY_RADIUS;
      spawnAt(Math.cos(a) * r, Math.sin(a) * r);
    }
  }

  private groundHeightNoGrid(x: number, z: number) {
    let g = this.heightAt(x, z);
    for (const b of this.boxes) {
      if (Math.abs(b.x - x) > b.hx || Math.abs(b.z - z) > b.hz) continue;
      const top = b.y + b.hy;
      if (top > g && top < g + 12) g = top;
    }
    return g;
  }

  private makeSpawns() {
    const make = (ax: number, az: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 16; i++) {
        const x = ax + this.rng.range(-26, 26);
        const z = az + this.rng.range(-26, 26);
        pts.push(new THREE.Vector3(x, this.heightAt(x, z) + 0.2, z));
      }
      return pts;
    };
    this.spawns.alpha = make(-150, -150);
    this.spawns.bravo = make(150, 150);
  }

  update(dt: number) {
    this.uniforms.uTime.value += dt;
    for (const l of this.loot) {
      if (l.taken) continue;
      l.mesh.rotation.y += dt * 1.2;
      l.mesh.position.y = l.y + Math.sin(this.uniforms.uTime.value * 2 + l.id) * 0.08;
    }
  }

  dispose() {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
  }
}
