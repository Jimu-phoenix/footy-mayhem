import * as THREE from 'three';

// Team colours: shirt + shorts (shorts slightly darker for contrast)
export const TEAMS = {
  red:  { shirt: 0xe03c3c, shorts: 0xa52626 },
  blue: { shirt: 0x2f74e0, shorts: 0x1e4c9c },
};

const SKIN = 0xd9a47c;
const SHOES = 0x2a2a2e;

function mat(color) {
  return new THREE.MeshStandardMaterial({
    color,
    flatShading: true, // gives the faceted low-poly look
    roughness: 0.85,
    metalness: 0,
  });
}

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Creates a low-poly humanoid, about 1.8 units tall, facing +Z, feet at y = 0.
 *
 * @param {'red'|'blue'|{shirt:number, shorts:number}} team
 * @param {{skin?:number, scale?:number}} opts
 * @returns {{ object: THREE.Group, update: (dt:number, speed?:number)=>void,
 *   legs: THREE.Group[], arms: THREE.Group[], body: THREE.Group }}
 *   speed: 0 = idle pose, 1 = normal walk, ~2 = run
 */
export function createCharacter(team = 'red', opts = {}) {
  const colors = typeof team === 'string' ? TEAMS[team] : team;
  const shirtM = mat(colors.shirt);
  const shortsM = mat(colors.shorts);
  const skinM = mat(opts.skin ?? SKIN);
  const shoeM = mat(SHOES);

  const root = new THREE.Group();
  const body = new THREE.Group(); // bobs up/down while walking
  root.add(body);

  // ---- Torso & pelvis ----
  const torsoGeo = new THREE.CylinderGeometry(0.27, 0.2, 0.6, 6);
  const torso = mesh(torsoGeo, shirtM, 0, 1.33, 0);
  torso.scale.z = 0.6; // flatten front-to-back
  body.add(torso);

  const pelvisGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.22, 6);
  const pelvis = mesh(pelvisGeo, shortsM, 0, 0.93, 0);
  pelvis.scale.z = 0.65;
  body.add(pelvis);

  // ---- Neck & head ----
  body.add(mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.12, 6), skinM, 0, 1.68, 0));
  const head = mesh(new THREE.IcosahedronGeometry(0.15, 1), skinM, 0, 1.82, 0);
  head.scale.set(0.9, 1.15, 1);
  body.add(head);

  // ---- Legs (pivot at the hip so they swing naturally) ----
  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.11, 0.88, 0);
    // shorts leg (upper thigh)
    pivot.add(mesh(new THREE.CylinderGeometry(0.11, 0.1, 0.32, 6), shortsM, 0, -0.14, 0));
    // bare lower leg
    pivot.add(mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.55, 6), skinM, 0, -0.5, 0));
    // shoe
    pivot.add(mesh(new THREE.BoxGeometry(0.13, 0.1, 0.24), shoeM, 0, -0.83, 0.04));
    body.add(pivot);
    return pivot;
  }
  const legL = makeLeg(1);
  const legR = makeLeg(-1);

  // ---- Arms (pivot at the shoulder) ----
  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.31, 1.58, 0);
    pivot.rotation.z = side * 0.08; // slight outward angle
    // short sleeve
    pivot.add(mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.24, 6), shirtM, 0, -0.1, 0));
    // bare arm
    pivot.add(mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.4, 6), skinM, 0, -0.38, 0));
    // hand
    pivot.add(mesh(new THREE.IcosahedronGeometry(0.06, 0), skinM, 0, -0.62, 0));
    body.add(pivot);
    return pivot;
  }
  const armL = makeArm(1);
  const armR = makeArm(-1);

  if (opts.scale) root.scale.setScalar(opts.scale);

  // ---- Walk animation ----
  let phase = 0;
  let blend = 0; // 0 idle -> 1 walking, smoothed

  function update(dt, speed = 0) {
    const target = Math.min(speed, 2.5);
    blend += (target - blend) * Math.min(1, dt * 10);
    phase += dt * 8 * Math.max(blend, 0.0001);

    const swing = Math.min(blend, 1.6) * 0.7;
    const s = Math.sin(phase);

    legL.rotation.x = s * swing;
    legR.rotation.x = -s * swing;
    armL.rotation.x = -s * swing * 0.8;
    armR.rotation.x = s * swing * 0.8;

    body.position.y = Math.abs(Math.cos(phase)) * 0.04 * Math.min(blend, 1.5);
    body.rotation.y = s * 0.06 * Math.min(blend, 1.5); // small torso twist
  }

  return {
    object: root,
    update,
    body,
    legs: [legL, legR],
    arms: [armL, armR],
  };
}
