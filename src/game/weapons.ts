export interface WeaponDef {
  id: string;
  name: string;
  class: "AR" | "SMG" | "SR" | "DMR" | "PISTOL";
  damage: number;
  rpm: number;
  mag: number;
  reload: number;
  recoilV: number;
  recoilH: number;
  spread: number; // radians at hip
  adsSpread: number;
  range: number;
  auto: boolean;
  zoom: number; // ADS fov multiplier
  muzzleColor: number;
  bodyColor: number;
  length: number;
}

export const WEAPONS: Record<string, WeaponDef> = {
  M416: {
    id: "M416", name: "M416", class: "AR", damage: 23, rpm: 690, mag: 30, reload: 2.1,
    recoilV: 0, recoilH: 0, spread: 0, adsSpread: 0, range: 320, auto: true,
    zoom: 0.55, muzzleColor: 0xffc45e, bodyColor: 0x3d4a57, length: 1.0,
  },
  AKM: {
    id: "AKM", name: "AKM", class: "AR", damage: 29, rpm: 600, mag: 30, reload: 2.4,
    recoilV: 0, recoilH: 0, spread: 0, adsSpread: 0, range: 300, auto: true,
    zoom: 0.55, muzzleColor: 0xffb347, bodyColor: 0x5c4634, length: 1.02,
  },
  UMP45: {
    id: "UMP45", name: "UMP45", class: "SMG", damage: 18, rpm: 750, mag: 25, reload: 1.8,
    recoilV: 0, recoilH: 0, spread: 0, adsSpread: 0, range: 180, auto: true,
    zoom: 0.6, muzzleColor: 0xffd27a, bodyColor: 0x4a4a52, length: 0.82,
  },
  Kar98k: {
    id: "Kar98k", name: "Kar98k", class: "SR", damage: 78, rpm: 48, mag: 5, reload: 3.4,
    recoilV: 0, recoilH: 0, spread: 0, adsSpread: 0, range: 600, auto: false,
    zoom: 0.2, muzzleColor: 0xfff0b0, bodyColor: 0x6b4f33, length: 1.25,
  },
  SLR: {
    id: "SLR", name: "SLR", class: "DMR", damage: 42, rpm: 250, mag: 10, reload: 2.9,
    recoilV: 0, recoilH: 0, spread: 0, adsSpread: 0, range: 450, auto: false,
    zoom: 0.32, muzzleColor: 0xffdc8a, bodyColor: 0x45504a, length: 1.15,
  },
  P18C: {
    id: "P18C", name: "P18C", class: "PISTOL", damage: 14, rpm: 1100, mag: 17, reload: 1.5,
    recoilV: 0, recoilH: 0, spread: 0, adsSpread: 0, range: 90, auto: true,
    zoom: 0.75, muzzleColor: 0xffd27a, bodyColor: 0x2e3338, length: 0.4,
  },
};

export interface WeaponInstance {
  def: WeaponDef;
  ammo: number;
  reserve: number;
  cooldown: number;
  reloading: number;
  recoilIndex: number;
}

export function makeWeapon(id: string): WeaponInstance {
  const def = WEAPONS[id] ?? WEAPONS.M416;
  return { def, ammo: def.mag, reserve: def.mag * 6, cooldown: 0, reloading: 0, recoilIndex: 0 };
}
