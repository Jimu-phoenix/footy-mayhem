import * as THREE from 'three';
import { poll as pollGamepads, onPadChange, padCount } from './gamepad.js';
import { createControllers } from './controllers.js';

/* =====================================================================
   MINI FOOTBALL 3D  -  2 vs 2
   Keyboard: WASD / Arrows move, Shift sprint, Space shoot (hold to charge),
             F tackle, Q / E / Tab switch player, R restart
   Gamepad:  Left stick / D-pad move, RT sprint, X shoot (hold to charge),
             B tackle, LB switch player, A / Start kick off, Start restart
   ===================================================================== */

/* ---------- Config ---------- */
const PITCH_L = 50;
const PITCH_W = 30;
const HALF_L = PITCH_L / 2;
const HALF_W = PITCH_W / 2;
const GOAL_HALF = 3.6; // half width of goal mouth
const GOAL_H = 2.6;
const GOAL_DEPTH = 2;
const BALL_R = 0.4;
const PLAYER_R = 0.55;
const KICK_RANGE = PLAYER_R + BALL_R + 0.9;
// possession / dribbling
const POSSESS_R = PLAYER_R + BALL_R + 0.45; // pickup radius (tighter than kick range)
const DRIBBLE_D = 0.62; // ball anchor distance ahead of the carrier
const DRIBBLE_SPRINT = 0.4; // extra distance while sprinting = bigger touch
const DROP_R = 1.15; // ball this far from the carrier = no longer possessed
const SPRING_K = 40; // how tightly the ball is pulled to the anchor
// (steady-state lag ≈ v/K: ball ends up 0.40 m ahead at 7.5 m/s, 0.71 m at
//  10.5 m/s sprint, and a 180° turn settles in ~75 ms — lag without slop)
const POSSESS_LOCK = 0.3; // seconds a stripped player cannot re-grab
const POSSESS_DELAY = 0.15; // ball stays loose this long after a tackle
const POSSESS_MAX_V = 14; // too fast to trap — shots zip past instead of gluing
const POP_SPEED = 7; // loose-ball speed when a tackle wins the ball
// tackling — a short lunge with a ball-seeking homing pull
const TACKLE_TIME = 0.26; // lunge duration (the "magnetised" window)
const TACKLE_CD = 0.75; // seconds before you can lunge again
const TACKLE_SPEED = 13.5; // lunge speed (vs 10.5 sprint)
const TACKLE_MAGNET_R = 2.4; // how far the ball pulls you in while lunging
const TACKLE_RANGE = PLAYER_R * 2.2; // dispossess reach while lunging (~1.21 m)
const TACKLE_KNOCK = 8; // shove velocity applied to the dispossessed opponent
const MATCH_TIME = 120; // seconds
const GRAVITY = 24;
const STEP = 1 / 120; // fixed physics step

const HUMAN_SPEED = 7.5;
const HUMAN_SPRINT = 10.5;
const AI_SPEED = 7.0;
const AI_SPRINT = 8.6;

const TEAM_COLORS = { blue: '#1f6bff', red: '#ff3d3d' };

const clamp = THREE.MathUtils.clamp;
const rand = (a, b) => a + Math.random() * (b - a);
function lerpAngle(a, b, t) {
  const d = ((((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  return a + d * t;
}

/* ---------- Renderer / scene / camera ---------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color('#8ec9ff');
scene.fog = new THREE.Fog('#8ec9ff', 75, 170);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 300);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

/* ---------- Lights ---------- */
scene.add(new THREE.HemisphereLight('#ffffff', '#3a6b35', 1.0));

const sun = new THREE.DirectionalLight('#ffffff', 2.2);
sun.position.set(15, 32, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 28;
sun.shadow.camera.bottom = -28;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 90;
sun.shadow.bias = -0.0005;
scene.add(sun);

/* ---------- Pitch ---------- */
function makePitchTexture(margin) {
  const S = 40; // pixels per metre
  const totalL = PITCH_L + margin * 2;
  const totalW = PITCH_W + margin * 2;
  const canvas = document.createElement('canvas');
  canvas.width = totalL * S;
  canvas.height = totalW * S;
  const g = canvas.getContext('2d');

  // mowing stripes
  const stripes = 12;
  const sw = canvas.width / stripes;
  for (let i = 0; i < stripes; i++) {
    g.fillStyle = i % 2 ? '#2f8f3a' : '#298233';
    g.fillRect(i * sw, 0, sw + 1, canvas.height);
  }

  const X = (x) => (x + totalL / 2) * S;
  const Z = (z) => (z + totalW / 2) * S;

  g.strokeStyle = '#ffffff';
  g.fillStyle = '#ffffff';
  g.lineWidth = 0.18 * S;

  g.strokeRect(X(-HALF_L), Z(-HALF_W), PITCH_L * S, PITCH_W * S);

  g.beginPath();
  g.moveTo(X(0), Z(-HALF_W));
  g.lineTo(X(0), Z(HALF_W));
  g.stroke();

  g.beginPath();
  g.arc(X(0), Z(0), 4 * S, 0, Math.PI * 2);
  g.stroke();

  g.beginPath();
  g.arc(X(0), Z(0), 0.25 * S, 0, Math.PI * 2);
  g.fill();

  for (const s of [-1, 1]) {
    const boxD = 7, boxW = 16, sixD = 2.5, sixW = 9;
    g.strokeRect(s > 0 ? X(HALF_L - boxD) : X(-HALF_L), Z(-boxW / 2), boxD * S, boxW * S);
    g.strokeRect(s > 0 ? X(HALF_L - sixD) : X(-HALF_L), Z(-sixW / 2), sixD * S, sixW * S);
    g.beginPath();
    g.arc(X(s * (HALF_L - 5)), Z(0), 0.2 * S, 0, Math.PI * 2);
    g.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return { tex, totalL, totalW };
}

{
  const { tex, totalL, totalW } = makePitchTexture(4);
  const pitch = new THREE.Mesh(
    new THREE.PlaneGeometry(totalL, totalW),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 })
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.receiveShadow = true;
  scene.add(pitch);

  const outer = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: '#2c5f34', roughness: 1 })
  );
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.03;
  outer.receiveShadow = true;
  scene.add(outer);
}

/* ---------- Boards around the pitch ---------- */
{
  const T = 0.4;
  const boardMat = new THREE.MeshStandardMaterial({ color: '#10243f', roughness: 0.6 });
  const capMat = new THREE.MeshStandardMaterial({ color: '#ffd23f', roughness: 0.5 });

  const addBoard = (w, h, d, x, z) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), boardMat);
    b.position.set(x, h / 2, z);
    b.castShadow = true;
    b.receiveShadow = true;
    scene.add(b);
    const c = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), capMat);
    c.position.set(x, h + 0.03, z);
    scene.add(c);
  };

  addBoard(PITCH_L + T * 2, 0.9, T, 0, -(HALF_W + T / 2)); // far side
  addBoard(PITCH_L + T * 2, 0.5, T, 0, HALF_W + T / 2); // camera side (low so it doesn't hide players)

  const segLen = HALF_W - GOAL_HALF;
  const segZ = (HALF_W + GOAL_HALF) / 2;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addBoard(T, 0.9, segLen, sx * (HALF_L + T / 2), sz * segZ);
    }
  }
}

/* ---------- Goals ---------- */
function makeNetTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
const netTexture = makeNetTexture();

function createNet(w, h) {
  const tex = netTexture.clone();
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(w / 0.3, h / 0.3);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
}

function createGoal(side) {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: '#f5f5f5', roughness: 0.4, metalness: 0.1 });
  const r = 0.1;

  const post = (x, z) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, GOAL_H, 12), white);
    m.position.set(x, GOAL_H / 2, z);
    m.castShadow = true;
    g.add(m);
  };
  post(0, GOAL_HALF);
  post(0, -GOAL_HALF);
  post(GOAL_DEPTH, GOAL_HALF);
  post(GOAL_DEPTH, -GOAL_HALF);

  const barZ = (x) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, GOAL_HALF * 2 + r * 2, 12), white);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, GOAL_H, 0);
    m.castShadow = true;
    g.add(m);
  };
  barZ(0);
  barZ(GOAL_DEPTH);

  for (const z of [-GOAL_HALF, GOAL_HALF]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, GOAL_DEPTH, 12), white);
    m.rotation.z = Math.PI / 2;
    m.position.set(GOAL_DEPTH / 2, GOAL_H, z);
    g.add(m);

    const sideNet = createNet(GOAL_DEPTH, GOAL_H);
    sideNet.position.set(GOAL_DEPTH / 2, GOAL_H / 2, z);
    g.add(sideNet);
  }

  const back = createNet(GOAL_HALF * 2, GOAL_H);
  back.rotation.y = Math.PI / 2;
  back.position.set(GOAL_DEPTH, GOAL_H / 2, 0);
  g.add(back);

  const top = createNet(GOAL_DEPTH, GOAL_HALF * 2);
  top.rotation.x = -Math.PI / 2;
  top.position.set(GOAL_DEPTH / 2, GOAL_H, 0);
  g.add(top);

  g.position.x = side * HALF_L;
  if (side < 0) g.rotation.y = Math.PI;
  return g;
}
scene.add(createGoal(1), createGoal(-1));

/* ---------- Stands with a little crowd ---------- */
function createStand(length, tiers = 5) {
  const group = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: '#8b93a3', roughness: 0.9 });
  const stepH = 0.9;
  const stepD = 1.4;

  for (let i = 0; i < tiers; i++) {
    const h = stepH * (i + 1);
    const step = new THREE.Mesh(new THREE.BoxGeometry(length, h, stepD), concrete);
    step.position.set(0, h / 2, -i * stepD);
    group.add(step);
  }

  const perRow = Math.floor(length / 0.9);
  const crowd = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.5, 0.9, 0.4),
    new THREE.MeshStandardMaterial({ roughness: 0.8 }),
    perRow * tiers
  );
  const palette = ['#e63946', '#f1faee', '#457b9d', '#ffb703', '#2a9d8f', '#9b5de5', '#ffffff', '#1d3557'];
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  let n = 0;
  for (let i = 0; i < tiers; i++) {
    for (let j = 0; j < perRow; j++) {
      if (Math.random() < 0.12) continue; // empty seat
      m.makeTranslation(
        -length / 2 + 0.5 + j * 0.9 + rand(-0.07, 0.07),
        stepH * (i + 1) + 0.45,
        -i * stepD + rand(-0.1, 0.1)
      );
      crowd.setMatrixAt(n, m);
      crowd.setColorAt(n, c.set(palette[Math.floor(Math.random() * palette.length)]));
      n++;
    }
  }
  crowd.count = n;
  crowd.instanceMatrix.needsUpdate = true;
  if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
  group.add(crowd);
  return group;
}

{
  const back = createStand(PITCH_L + 8);
  back.position.set(0, 0, -(HALF_W + 4));
  scene.add(back);

  const endLeft = createStand(PITCH_W + 8);
  endLeft.position.set(-(HALF_L + 7), 0, 0);
  endLeft.rotation.y = Math.PI / 2;
  scene.add(endLeft);

  const endRight = createStand(PITCH_W + 8);
  endRight.position.set(HALF_L + 7, 0, 0);
  endRight.rotation.y = -Math.PI / 2;
  scene.add(endRight);
}

/* ---------- Ball ---------- */
function makeBallTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#151515';
  const blob = (x, y, r) => {
    g.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i) g.lineTo(px, py);
      else g.moveTo(px, py);
    }
    g.closePath();
    g.fill();
  };
  for (let i = 0; i < 6; i++) {
    const x = (i * 512) / 6 + 40;
    blob(x, 128, 26);
    blob(x + 512 / 12, 52, 20);
    blob(x + 512 / 12, 204, 20);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const ball = {
  mesh: new THREE.Mesh(
    new THREE.SphereGeometry(BALL_R, 32, 24),
    new THREE.MeshStandardMaterial({ map: makeBallTexture(), roughness: 0.45 })
  ),
  vel: new THREE.Vector3(),
  owner: null, // player currently dribbling the ball
  looseCd: 0, // ball cannot be picked up until this expires (after a tackle)
};
ball.mesh.castShadow = true;
ball.pos = ball.mesh.position;
ball.pos.set(0, BALL_R, 0);
scene.add(ball.mesh);

/* ---------- Players ---------- */
const players = [];
const teams = {
  blue: { name: 'blue', label: 'BLUE', dir: 1, score: 0, players: [], presser: null },
  red: { name: 'red', label: 'RED', dir: -1, score: 0, players: [], presser: null },
};

function createPlayer(team) {
  const shirt = new THREE.MeshStandardMaterial({ color: TEAM_COLORS[team.name], roughness: 0.7 });
  const shorts = new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.8 });
  const skinColor = ['#f1c27d', '#c68642', '#8d5524', '#e0ac69'][Math.floor(Math.random() * 4)];
  const skin = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.8 });
  const boot = new THREE.MeshStandardMaterial({ color: '#16161a', roughness: 0.6 });

  const group = new THREE.Group();
  const model = new THREE.Group();
  model.scale.setScalar(0.85);
  group.add(model);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.35, 4, 12), shirt);
  torso.position.y = 1.32;
  model.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 16), skin);
  head.position.y = 2.0;
  model.add(head);

  const legs = [];
  const arms = [];
  for (const sx of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(sx * 0.16, 0.9, 0);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.38, 0.24), shorts);
    upper.position.y = -0.19;
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.4, 0.2), skin);
    shin.position.y = -0.58;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.34), boot);
    foot.position.set(0, -0.84, 0.06);
    leg.add(upper, shin, foot);
    model.add(leg);
    legs.push(leg);

    const arm = new THREE.Group();
    arm.position.set(sx * 0.42, 1.6, 0);
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.25, 0.15), shirt);
    sleeve.position.y = -0.12;
    const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.35, 0.12), skin);
    forearm.position.y = -0.42;
    arm.add(sleeve, forearm);
    model.add(arm);
    arms.push(arm);
  }

  model.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  scene.add(group);

  return {
    team: team.name,
    group,
    legs,
    arms,
    vel: new THREE.Vector3(),
    heading: team.dir > 0 ? Math.PI / 2 : -Math.PI / 2,
    phase: 0,
    kickCd: 0,
    lostCd: 0,
    sprinting: false,
    kickAnim: 0,
    tackle: 0,
    tackleCd: 0,
    aiTimer: 0,
    aiAimZ: rand(-2.5, 2.5),
  };
}

for (const team of Object.values(teams)) {
  for (let i = 0; i < 2; i++) {
    const p = createPlayer(team);
    team.players.push(p);
    players.push(p);
  }
}

// markers, one per controller slot
function makeMarker(color) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.75, 0.95, 40),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  ring.visible = false;

  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 4), new THREE.MeshBasicMaterial({ color }));
  arrow.rotation.x = Math.PI;
  arrow.visible = false;

  scene.add(ring, arrow);
  return { ring, arrow };
}
const markers = [makeMarker('#ffe14a'), makeMarker('#7CFC00')];

/* ---------- HUD (DOM) ---------- */
const style = document.createElement('style');
style.textContent = `
  html, body { margin: 0; height: 100%; overflow: hidden; background: #000; font-family: 'Segoe UI', system-ui, sans-serif; }
  canvas { display: block; }
  #hud { position: fixed; inset: 0; pointer-events: none; color: #fff; user-select: none; }
  #scoreboard { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); display: flex; align-items: stretch;
    border-radius: 12px; overflow: hidden; font-weight: 800; box-shadow: 0 6px 20px rgba(0,0,0,.35); }
  #scoreboard > div { padding: 8px 16px; display: flex; align-items: center; }
  .tBlue { background: #1f6bff; letter-spacing: 1px; }
  .tRed { background: #ff3d3d; letter-spacing: 1px; }
  #score { background: #0e1726; font-size: 26px; min-width: 90px; justify-content: center; }
  #clock { background: #0e1726cc; font-variant-numeric: tabular-nums; font-size: 18px; color: #ffd23f; }
  #banner { position: absolute; top: 30%; left: 50%; transform: translate(-50%, -50%) scale(.7); opacity: 0; text-align: center;
    font-size: clamp(36px, 8vw, 84px); font-weight: 900; text-shadow: 0 4px 24px rgba(0,0,0,.55); transition: all .25s ease; }
  #banner.show { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  #banner small { display: block; font-size: .32em; font-weight: 700; letter-spacing: 3px; margin-top: 6px; }
  #power { position: absolute; bottom: 36px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column;
    gap: 6px; align-items: center; opacity: 0; transition: opacity .1s; }
  #power.show { opacity: 1; }
  .pbar { width: 240px; height: 12px; background: rgba(0,0,0,.45); border-radius: 8px; overflow: hidden; display: none; }
  .pbar.show { display: block; }
  .pbar > div { height: 100%; width: 0; background: linear-gradient(90deg, #7CFC00, #ffd23f, #ff4d4d); }
  #toast { position: absolute; top: 74px; left: 50%; transform: translateX(-50%); background: rgba(14,23,38,.92); color: #fff;
    padding: 8px 16px; border-radius: 10px; font-size: 14px; font-weight: 700; opacity: 0; transition: opacity .25s;
    box-shadow: 0 6px 20px rgba(0,0,0,.35); white-space: nowrap; max-width: 90vw; overflow: hidden; text-overflow: ellipsis; }
  #toast.show { opacity: 1; }
  #help { position: absolute; left: 14px; bottom: 12px; font-size: 12px; opacity: .85; line-height: 1.6;
    background: rgba(0,0,0,.35); padding: 8px 12px; border-radius: 8px; }
  kbd { background: rgba(255,255,255,.2); border-radius: 4px; padding: 1px 6px; font-family: inherit; font-weight: 700; }
  #overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: auto;
    background: radial-gradient(ellipse at center, rgba(8,18,40,.55), rgba(8,18,40,.88)); color: #fff; }
  #overlay.hidden { display: none; }
  .card { text-align: center; padding: 32px 40px; max-width: 460px; }
  .card h1 { margin: 0 0 6px; font-size: 40px; letter-spacing: 1px; }
  .card p { margin: 6px 0; opacity: .85; }
  .card .keys { text-align: left; display: inline-block; margin: 16px 0 22px; line-height: 2; font-size: 14px; }
  .card button { font: inherit; font-weight: 800; font-size: 18px; padding: 12px 34px; border: 0; border-radius: 10px;
    background: #ffd23f; color: #10243f; cursor: pointer; }
  .card button:hover { filter: brightness(1.08); }
  .modes { display: flex; gap: 8px; justify-content: center; margin: 18px 0 4px; }
  .card .mode { font: inherit; font-size: 14px; font-weight: 700; padding: 8px 14px; border-radius: 8px;
    border: 2px solid rgba(255,255,255,.25); background: rgba(255,255,255,.08); color: #fff; cursor: pointer;
    box-shadow: none; }
  .card .mode:hover { filter: none; }
  .card .mode.active { border-color: #ffd23f; background: #ffd23f; color: #10243f; }
  .card .mode:disabled { opacity: .35; cursor: not-allowed; }
  #modeHint { margin: 6px 0 0; font-size: 12px; opacity: .7; }
`;
document.head.appendChild(style);

const hud = document.createElement('div');
hud.id = 'hud';
hud.innerHTML = `
  <div id="scoreboard">
    <div class="tBlue">BLUE</div>
    <div id="score">0 - 0</div>
    <div class="tRed">RED</div>
    <div id="clock">2:00</div>
  </div>
  <div id="banner"></div>
  <div id="power">
    <div class="pbar"><div></div></div>
    <div class="pbar"><div></div></div>
  </div>
  <div id="help">
    <span id="helpKb"><kbd>WASD</kbd> / <kbd>Arrows</kbd> move &nbsp; <kbd>Shift</kbd> sprint<br>
    <kbd>Space</kbd> shoot (hold to charge) &nbsp; <kbd>F</kbd> tackle &nbsp; <kbd>Q</kbd> / <kbd>Tab</kbd> switch player</span><span
    id="helpPad" style="display:none"><br><kbd>Stick</kbd> / <kbd>D-pad</kbd> move &nbsp; <kbd>RT</kbd> sprint<br>
    <kbd>X</kbd> shoot (hold to charge) &nbsp; <kbd>B</kbd> tackle &nbsp; <kbd>LB</kbd> switch &nbsp; <kbd>Start</kbd> restart</span>
  </div>
  <div id="toast"></div>
`;
document.body.appendChild(hud);

const overlay = document.createElement('div');
overlay.id = 'overlay';
overlay.innerHTML = `
  <div class="card">
    <h1>⚽ Mini Football 3D</h1>
    <p>2 vs 2 &middot; most goals in 2 minutes wins</p>
    <div class="keys">
      <kbd>WASD</kbd> / <kbd>Arrows</kbd> &ndash; move<br>
      <kbd>Shift</kbd> &ndash; sprint<br>
      <kbd>Space</kbd> &ndash; shoot (hold for power)<br>
      <kbd>F</kbd> &ndash; tackle (lunge into the ball)<br>
      <kbd>Q</kbd> / <kbd>Tab</kbd> &ndash; switch player<br>
      <kbd>R</kbd> &ndash; restart match
    </div>
    <div class="modes">
      <button class="mode active" data-mode="solo">1P vs AI</button>
      <button class="mode" data-mode="coop">Co-op 2P</button>
      <button class="mode" data-mode="versus">Versus 1v1</button>
    </div>
    <p id="modeHint"></p><br>
    <button id="startBtn">Kick off</button>
  </div>
`;
document.body.appendChild(overlay);

const $score = hud.querySelector('#score');
const $clock = hud.querySelector('#clock');
const $banner = hud.querySelector('#banner');
const $power = hud.querySelector('#power');
const $powerBars = [...hud.querySelectorAll('.pbar')];
const $helpPad = hud.querySelector('#helpPad');
const $toast = hud.querySelector('#toast');
const $startBtn = overlay.querySelector('#startBtn');
const $modeButtons = [...overlay.querySelectorAll('.mode')];
const $modeHint = overlay.querySelector('#modeHint');

function showBanner(html, color = '#fff') {
  $banner.innerHTML = html;
  $banner.style.color = color;
  $banner.classList.add('show');
}
function hideBanner() {
  $banner.classList.remove('show');
}

/* ---------- Game state ---------- */
let state = 'menu'; // menu | kickoff | playing | goal | ended
let stateTimer = 0;
let matchTime = MATCH_TIME;
let lastScorer = null;
let clockTime = 0;

function resetKickoff() {
  const spots = [
    [-4, -3],
    [-13, 4],
  ];
  teams.blue.players.forEach((p, i) => {
    p.group.position.set(spots[i][0], 0, spots[i][1]);
    p.vel.set(0, 0, 0);
    p.heading = Math.PI / 2;
    p.kickCd = 0;
    p.lostCd = 0;
    p.sprinting = false;
    p.tackle = 0;
    p.tackleCd = 0;
  });
  teams.red.players.forEach((p, i) => {
    p.group.position.set(-spots[i][0], 0, -spots[i][1]);
    p.vel.set(0, 0, 0);
    p.heading = -Math.PI / 2;
    p.kickCd = 0;
    p.lostCd = 0;
    p.sprinting = false;
    p.tackle = 0;
    p.tackleCd = 0;
  });
  ball.pos.set(0, BALL_R, 0);
  ball.vel.set(0, 0, 0);
  ball.owner = null;
  ball.looseCd = 0;
  teams.blue.presser = null;
  teams.red.presser = null;
  controllers.resetCharges();
}

function startMatch() {
  teams.blue.score = 0;
  teams.red.score = 0;
  matchTime = MATCH_TIME;
  resetKickoff();
  overlay.classList.add('hidden');
  state = 'kickoff';
  stateTimer = 1.4;
  showBanner('KICK OFF');
}

function scoreGoal(teamName) {
  teams[teamName].score++;
  lastScorer = teamName;
  state = 'goal';
  stateTimer = 2.8;
  ball.owner = null;
  controllers.resetCharges();
  showBanner(`GOAL!<small>${teams[teamName].label} SCORES</small>`, TEAM_COLORS[teamName]);
}

function endMatch() {
  state = 'ended';
  const b = teams.blue.score;
  const r = teams.red.score;
  let html;
  if (b > r) html = `FULL TIME<small>BLUE WINS ${b} - ${r}</small>`;
  else if (r > b) html = `FULL TIME<small>RED WINS ${r} - ${b}</small>`;
  else html = `FULL TIME<small>DRAW ${b} - ${r}</small>`;
  html += '<small style="opacity:.8;font-size:.22em">Press Enter or R to play again</small>';
  showBanner(html);
}

/* ---------- Input ---------- */
const keys = new Set();

function getInput() {
  let x = 0;
  let z = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) z -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) z += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  const len = Math.hypot(x, z);
  if (len > 0) {
    x /= len;
    z /= len;
  }
  return { x, z, len };
}

function getKeyboard() {
  return {
    ...getInput(),
    sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
  };
}

/* ---------- Controller slots ---------- */
const controllers = createControllers({
  teams,
  ball,
  KICK_RANGE,
  getState: () => state,
  startMatch: () => startMatch(),
  getKeyboard,
  distToBall,
  assistAim,
  kickBall,
  doTackle: (p) => startTackle(p),
});

function applyMode(next) {
  controllers.setMode(next);
  controllers.slots.forEach((s, i) => {
    s.marker = markers[i] || null;
  });
  $modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === next));
  updatePadUI();
}

function updatePadUI() {
  const n = padCount();
  $helpPad.style.display = n ? '' : 'none';
  $modeButtons.forEach((b) => {
    b.disabled = b.dataset.mode !== 'solo' && n < 2;
  });
  $modeHint.textContent =
    n >= 2 ? `${n} controllers connected` : 'Connect a second controller for 2-player modes';
}

let toastTimer = 0;
function showToast(msg) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 2200);
}

onPadChange((ev) => {
  controllers.rebind();
  showToast(ev.type === 'connected' ? `Controller connected — ${ev.id.slice(0, 30)}` : 'Controller disconnected');
  updatePadUI();
});

$modeButtons.forEach((b) =>
  b.addEventListener('click', () => {
    if (!b.disabled) applyMode(b.dataset.mode);
  })
);

window.addEventListener('keydown', (e) => {
  if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);

  if (e.code === 'Enter' && (state === 'menu' || state === 'ended')) startMatch();
  else if (e.code === 'KeyR' && state !== 'menu') startMatch();
  else if (e.code === 'KeyQ' || e.code === 'KeyE' || e.code === 'Tab') {
    if (state === 'playing' || state === 'kickoff') controllers.switchPlayer(controllers.slots[0]);
  } else if (e.code === 'Space') {
    controllers.startCharge(controllers.slots[0]);
  } else if (e.code === 'KeyF') {
    controllers.startTackle(controllers.slots[0]);
  }
});

window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'Space') controllers.release(controllers.slots[0]);
});

// a click also lunges the driven player (slot 0)
window.addEventListener('mousedown', (e) => {
  if (e.button === 0 && state === 'playing') controllers.startTackle(controllers.slots[0]);
});

window.addEventListener('blur', () => {
  keys.clear();
  controllers.resetCharges();
});

$startBtn.addEventListener('click', startMatch);

/* ---------- Kicking ---------- */
function kickBall(p, dirX, dirZ, power) {
  ball.owner = null;
  const len = Math.hypot(dirX, dirZ) || 1;
  const speed = 9 + power * 23;
  ball.vel.x = (dirX / len) * speed;
  ball.vel.z = (dirZ / len) * speed;
  ball.vel.y = Math.max(0, power - 0.3) * 11;
  p.kickCd = 0.35;
  p.kickAnim = 0.25;
}

/* ---------- Tackling ---------- */
// press a button to lunge: a short dash faster than sprint that homes toward
// the ball ("magnetised"), so you connect with the ball/opponent and win
// possession quickly instead of just skating past.
function startTackle(p) {
  if (state !== 'playing' || p.tackle > 0 || p.tackleCd > 0) return;
  const v = p.vel;
  const sp = Math.hypot(v.x, v.z);
  // launch face-first down your movement direction (or current facing)
  p.heading = sp > 0.5 ? Math.atan2(v.x, v.z) : p.heading;
  p.tackle = TACKLE_TIME;
  p.tackleCd = TACKLE_CD;
  p.sprinting = true;
}

// one fixed step of the lunge + homing pull
function updateTackleMove(p, dt) {
  p.tackle -= dt;
  const pos = p.group.position;
  let dx = Math.sin(p.heading);
  let dz = Math.cos(p.heading);

  // magnet: while lunging, bend your run toward the ball so a pass can't
  // be dodged by moving half a metre — you arrive and it still connects
  const bdx = ball.pos.x - pos.x;
  const bdz = ball.pos.z - pos.z;
  const bd = Math.hypot(bdx, bdz);
  if (bd < TACKLE_MAGNET_R && bd > 0.001) {
    const nose = dx * bdx + dz * bdz; // is the ball ahead of you?
    if (nose > -0.3 * bd) {
      const tx = bdx + ball.vel.x * 0.12; // small lead on a moving ball
      const tz = bdz + ball.vel.z * 0.12;
      const tl = Math.hypot(tx, tz) || 1;
      dx = tx / tl;
      dz = tz / tl;
    }
  }

  const speed = TACKLE_SPEED;
  p.vel.x = dx * speed;
  p.vel.z = dz * speed;
  pos.x += p.vel.x * dt;
  pos.z += p.vel.z * dt;
  pos.x = clamp(pos.x, -HALF_L + 0.3, HALF_L - 0.3);
  pos.z = clamp(pos.z, -HALF_W + PLAYER_R, HALF_W - PLAYER_R);
  p.heading = lerpAngle(p.heading, Math.atan2(dx, dz), Math.min(1, 20 * dt));
}

// a successful tackle shoves the dispossessed opponent aside
function tackleShove(tackler, victim) {
  const tp = tackler.group.position;
  const vp = victim.group.position;
  let dx = vp.x - tp.x;
  let dz = vp.z - tp.z;
  const dl = Math.hypot(dx, dz) || 1;
  dx /= dl;
  dz /= dl;
  victim.vel.x += dx * TACKLE_KNOCK;
  victim.vel.z += dz * TACKLE_KNOCK;
}

/* ---------- Possession ---------- */
// opponent wins the ball: pop it out, blending the carrier's direction with
// the tackler's momentum, and lock the carrier out of an instant re-grab
function dispossess(carrier, tackler) {
  if (!ball.owner) return;
  ball.owner = null;
  ball.looseCd = POSSESS_DELAY;
  carrier.lostCd = POSSESS_LOCK;

  const cp = carrier.group.position;
  let dx = ball.pos.x - cp.x;
  let dz = ball.pos.z - cp.z;
  const dl = Math.hypot(dx, dz) || 1;
  dx /= dl;
  dz /= dl;

  const tv = tackler.vel;
  const tl = Math.hypot(tv.x, tv.z);
  if (tl > 0.5) {
    const mx = dx * 0.5 + (tv.x / tl) * 0.5;
    const mz = dz * 0.5 + (tv.z / tl) * 0.5;
    const ml = Math.hypot(mx, mz) || 1;
    dx = mx / ml;
    dz = mz / ml;
  }

  const a = rand(-0.5, 0.5);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const speed = POP_SPEED + 0.35 * tl;
  ball.vel.set((dx * ca - dz * sa) * speed, 1.2, (dx * sa + dz * ca) * speed);
}

// nearest eligible player picks up a loose ball
function tryPossess() {
  if (ball.owner || ball.looseCd > 0 || ball.pos.y > 1.0) return;
  if (Math.hypot(ball.vel.x, ball.vel.z) > POSSESS_MAX_V) return;
  let best = null;
  let bd = POSSESS_R;
  for (const pl of players) {
    if (pl.lostCd > 0 || pl.kickCd > 0) continue;
    const d = distToBall(pl);
    if (d < bd) {
      bd = d;
      best = pl;
    }
  }
  if (best) ball.owner = best;
}

function distToBall(p) {
  const pp = p.group.position;
  return Math.hypot(ball.pos.x - pp.x, ball.pos.z - pp.z);
}

// small aim assist: if you're roughly pointing at the goal, nudge the shot toward it
function assistAim(dirX, dirZ, team) {
  const goalX = team.dir * HALF_L;
  const toGoalAngle = Math.atan2(goalX - ball.pos.x, 0 - ball.pos.z);
  const da = Math.atan2(dirX, dirZ);
  const diff = ((((toGoalAngle - da + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  if (Math.abs(diff) < 0.4) {
    const a = da + diff * 0.7;
    return { x: Math.sin(a), z: Math.cos(a) };
  }
  return { x: dirX, z: dirZ };
}

/* ---------- Movement helpers ---------- */
function steer(p, dx, dz, speed, dt) {
  const k = 1 - Math.exp(-9 * dt);
  p.vel.x += (dx * speed - p.vel.x) * k;
  p.vel.z += (dz * speed - p.vel.z) * k;
  const pos = p.group.position;
  pos.x += p.vel.x * dt;
  pos.z += p.vel.z * dt;
  pos.x = clamp(pos.x, -(HALF_L - 0.3), HALF_L - 0.3);
  pos.z = clamp(pos.z, -(HALF_W - PLAYER_R), HALF_W - PLAYER_R);
  if (Math.hypot(p.vel.x, p.vel.z) > 0.6) {
    p.heading = lerpAngle(p.heading, Math.atan2(p.vel.x, p.vel.z), 1 - Math.exp(-14 * dt));
  }
}

function choosePresser(team) {
  let best = team.players[0];
  let bd = Infinity;
  for (const p of team.players) {
    const d = distToBall(p);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  // hysteresis so two players don't flip-flop
  if (!team.presser || distToBall(team.presser) - bd > 1.5) team.presser = best;
}

/* ---------- AI ---------- */
function updateAI(p, team, dt) {
  const pos = p.group.position;
  const bp = ball.pos;
  const goalX = team.dir * HALF_L;
  const ownX = -team.dir * HALF_L;
  const owner = ball.owner;
  const hasIt = owner === p;
  const teammateHasIt = owner && !hasIt && owner.team === team.name;
  let tx = pos.x;
  let tz = pos.z;
  let speed = AI_SPEED;
  p.sprinting = false;

  if (hasIt) {
    // carrying: drive at the goal, shoot once in range
    const distToGoal = Math.abs(goalX - pos.x);
    tx = goalX;
    tz = clamp(bp.z * 0.4, -7, 7);
    speed = distToGoal > 26 ? AI_SPRINT : AI_SPEED;

    const inOwnThird = Math.abs(ownX - pos.x) < 15;
    if (p.kickCd <= 0 && (distToGoal < 19 || inOwnThird)) {
      p.aiTimer += dt;
      if (p.aiTimer > 0.22) {
        const power = distToGoal >= 19 ? 0.75 : rand(0.85, 1);
        kickBall(p, goalX - bp.x, p.aiAimZ - bp.z, power);
        p.aiAimZ = rand(-(GOAL_HALF - 0.9), GOAL_HALF - 0.9);
        p.aiTimer = 0;
      }
    } else {
      p.aiTimer = 0;
    }
  } else if (team.presser === p && owner && !teammateHasIt) {
    // press the opponent carrier: run at an interception point
    tx = owner.group.position.x + owner.vel.x * 0.15;
    tz = owner.group.position.z + owner.vel.z * 0.15;
    speed = AI_SPRINT;
    p.aiTimer = 0;

    // lunge once the carrier is in range — the homing magnet does the rest
    const td = Math.hypot(tx - pos.x, tz - pos.z);
    if (td < 1.6 && p.tackleCd <= 0 && Math.random() < 0.3) startTackle(p);
  } else if (team.presser === p && !owner) {
    // chase a loose ball
    const bx = bp.x + ball.vel.x * 0.25;
    const bz = bp.z + ball.vel.z * 0.25;
    let gx = goalX - bx;
    let gz = 0 - bz;
    const gl = Math.hypot(gx, gz) || 1;
    gx /= gl;
    gz /= gl;
    const rx = pos.x - bx;
    const rz = pos.z - bz;
    const behind = rx * gx + rz * gz; // < 0: we are on the side away from the goal
    const dist = distToBall(p);

    if (behind < 0.2) {
      // run through the ball toward goal (dribble)
      tx = bx + gx * 1.2;
      tz = bz + gz * 1.2;
      speed = dist > 7 ? AI_SPRINT : AI_SPEED;
    } else {
      // get around the ball first so we don't push it backwards
      const side = rx * -gz + rz * gx >= 0 ? 1 : -1;
      tx = bx - gx * 2.4 + -gz * side * 2.0;
      tz = bz - gz * 2.4 + gx * side * 2.0;
      speed = AI_SPRINT;
    }

    // shoot or clear
    const distToGoal = Math.abs(goalX - bp.x);
    const inOwnThird = Math.abs(ownX - bp.x) < 15;
    const canTouch = dist < KICK_RANGE && bp.y < 1.3 && p.kickCd <= 0 && behind < 0.6;
    if (canTouch && (distToGoal < 19 || inOwnThird)) {
      p.aiTimer += dt;
      if (p.aiTimer > 0.22) {
        const power = distToGoal >= 19 ? 0.75 : rand(0.85, 1);
        kickBall(p, goalX - bp.x, p.aiAimZ - bp.z, power);
        p.aiAimZ = rand(-(GOAL_HALF - 0.9), GOAL_HALF - 0.9);
        p.aiTimer = 0;
      }
    } else {
      p.aiTimer = 0;
    }
  } else {
    // support / cover: teammate has the ball, or ball is loose elsewhere
    const ballInOwnHalf = (bp.x - ownX) * team.dir < HALF_L;
    if (ballInOwnHalf) {
      // offer an outlet ahead of the ball, on the opposite side
      tx = clamp(bp.x + team.dir * 9, -HALF_L + 3, HALF_L - 3);
      tz = bp.z > 0 ? -7 : 7;
    } else {
      // drop back and cover the goal
      tx = ownX + team.dir * 13;
      tz = clamp(bp.z * 0.4, -7, 7);
    }
    speed = AI_SPEED * 0.9;
    p.aiTimer = 0;
  }

  p.sprinting = speed >= AI_SPRINT;

  const dx = tx - pos.x;
  const dz = tz - pos.z;
  const d = Math.hypot(dx, dz);
  const arrive = Math.min(1, d / 1.5);
  if (d > 0.15) steer(p, dx / d, dz / d, speed * arrive, dt);
  else steer(p, 0, 0, 0, dt);
}

/* ---------- Ball physics ---------- */
function stepBall(dt) {
  const p = ball.pos;
  const v = ball.vel;
  const owner = ball.owner;

  if (owner) {
    // ---- carried: glued to a point ahead of the carrier by a tight spring ----
    p.y = BALL_R;
    v.y = 0;
    const op = owner.group.position;
    const reach = DRIBBLE_D + (owner.sprinting ? DRIBBLE_SPRINT : 0);
    const tx = op.x + Math.sin(owner.heading) * reach;
    const tz = op.z + Math.cos(owner.heading) * reach;
    const px = p.x;
    const pz = p.z;
    const k = 1 - Math.exp(-SPRING_K * dt);
    p.x += (tx - p.x) * k;
    p.z += (tz - p.z) * k;
    // velocity from actual movement so a release keeps the right momentum
    v.x = (p.x - px) / dt;
    v.z = (p.z - pz) / dt;
  } else {
    v.y -= GRAVITY * dt;
    p.addScaledVector(v, dt);

    // ground
    if (p.y < BALL_R) {
      p.y = BALL_R;
      if (v.y < -1.2) {
        v.y = -v.y * 0.58;
        v.x *= 0.98;
        v.z *= 0.98;
      } else {
        v.y = 0;
      }
    }

    const onGround = p.y <= BALL_R + 0.01 && v.y === 0;
    const speed = Math.hypot(v.x, v.z);
    if (onGround && speed > 0) {
      const ns = Math.max(0, speed * Math.exp(-0.9 * dt) - 2.0 * dt);
      const k = ns / speed;
      v.x *= k;
      v.z *= k;
    } else if (!onGround) {
      const k = Math.exp(-0.08 * dt);
      v.x *= k;
      v.z *= k;
    }
  }

  // players kick / bump the ball
  for (const pl of players) {
    if (p.y > 2.2) break;
    const pp = pl.group.position;
    const dx = p.x - pp.x;
    const dz = p.z - pp.z;
    const d = Math.hypot(dx, dz);
    const min = PLAYER_R + BALL_R;
    if (owner) {
      // carrier passes through; an opponent touching the ball wins it
      if (pl !== owner && pl.team !== owner.team && d < min) dispossess(owner, pl);
      continue;
    }
    if (d < min && d > 0.0001) {
      const nx = dx / d;
      const nz = dz / d;
      p.x += nx * (min - d);
      p.z += nz * (min - d);
      const rel = (v.x - pl.vel.x) * nx + (v.z - pl.vel.z) * nz;
      if (rel < 0) {
        const j = -(1 + 0.25) * rel;
        v.x += nx * j;
        v.z += nz * j;
      }
    }
  }

  // goal posts
  for (const s of [1, -1]) {
    for (const zz of [GOAL_HALF, -GOAL_HALF]) {
      if (p.y > GOAL_H + BALL_R) continue;
      const dx = p.x - s * HALF_L;
      const dz = p.z - zz;
      const d = Math.hypot(dx, dz);
      const min = BALL_R + 0.1;
      if (d < min && d > 0.0001) {
        const nx = dx / d;
        const nz = dz / d;
        p.x += nx * (min - d);
        p.z += nz * (min - d);
        const vn = v.x * nx + v.z * nz;
        if (vn < 0) {
          v.x -= 1.6 * vn * nx;
          v.z -= 1.6 * vn * nz;
        }
      }
    }
  }

  // side boards
  const zMax = HALF_W - BALL_R;
  if (p.z > zMax) {
    p.z = zMax;
    if (v.z > 0) v.z *= -0.6;
  } else if (p.z < -zMax) {
    p.z = -zMax;
    if (v.z < 0) v.z *= -0.6;
  }

  // end line / goal mouth / net
  for (const s of [1, -1]) {
    const xs = p.x * s;
    if (xs <= HALF_L - BALL_R) continue;

    const mouthOK = Math.abs(p.z) < GOAL_HALF - BALL_R * 0.6 && p.y < GOAL_H - BALL_R * 0.6;
    if (xs < HALF_L && !mouthOK) {
      p.x = s * (HALF_L - BALL_R);
      if (v.x * s > 0) v.x *= -0.6;
      continue;
    }

    if (xs >= HALF_L) {
      const zl = GOAL_HALF - BALL_R;
      if (Math.abs(p.z) > zl) {
        p.z = Math.sign(p.z) * zl;
        v.z *= -0.3;
      }
      if (p.y > GOAL_H - BALL_R) {
        p.y = GOAL_H - BALL_R;
        if (v.y > 0) v.y *= -0.3;
      }
      if (xs > HALF_L + GOAL_DEPTH - BALL_R) {
        p.x = s * (HALF_L + GOAL_DEPTH - BALL_R);
        if (v.x * s > 0) v.x *= -0.25;
      }
      const k = Math.exp(-2.5 * dt); // the net soaks up energy
      v.x *= k;
      v.z *= k;
    }
  }

  // if the ball is pinned against a board, nudge the player instead
  if (!ball.owner) {
    for (const pl of players) {
      if (p.y > 1.2) break;
      const pp = pl.group.position;
      const dx = pp.x - p.x;
      const dz = pp.z - p.z;
      const d = Math.hypot(dx, dz);
      const min = PLAYER_R + BALL_R - 0.02;
      if (d < min && d > 0.0001) {
        pp.x += (dx / d) * (min - d);
        pp.z += (dz / d) * (min - d);
      }
    }
  }

  // safety net: if a wall/post clamp pushed the ball away, drop it
  if (ball.owner) {
    const o = ball.owner;
    const op = o.group.position;
    if (Math.hypot(p.x - op.x, p.z - op.z) > DROP_R) {
      ball.owner = null;
      o.lostCd = POSSESS_LOCK;
    }
  }

  // ball roll visual
  const hs = Math.hypot(v.x, v.z);
  if (hs > 0.01) {
    const axis = new THREE.Vector3(v.z, 0, -v.x).normalize();
    ball.mesh.rotateOnWorldAxis(axis, (hs * dt) / BALL_R);
  }
}

/* ---------- Simulation step ---------- */
function simulate(dt) {
  if (state === 'menu') return;

  for (const p of players) {
    p.kickCd = Math.max(0, p.kickCd - dt);
    p.lostCd = Math.max(0, p.lostCd - dt);
    p.tackleCd = Math.max(0, p.tackleCd - dt);
  }
  ball.looseCd = Math.max(0, ball.looseCd - dt);

  const live = state === 'playing';
  if (live) {
    choosePresser(teams.blue);
    choosePresser(teams.red);
  } else if (ball.owner) {
    ball.owner = null; // no dribbling during kickoff / celebrations / full time
  }

  for (const team of Object.values(teams)) {
    for (const p of team.players) {
      if (!live) {
        p.sprinting = false;
        p.tackle = 0;
        steer(p, 0, 0, 0, dt);
        continue;
      }
      const slot = controllers.slotFor(p);
      const input = slot && controllers.isPlayable(slot) ? controllers.inputFor(slot) : null;
      if (p.tackle > 0) {
        // a lunge overrides normal steering so neither stick nor AI can direct it
        updateTackleMove(p, dt);
      } else if (!input) {
        updateAI(p, team, dt);
      } else {
        p.sprinting = input.sprint;
        steer(p, input.x, input.z, input.len ? (input.sprint ? HUMAN_SPRINT : HUMAN_SPEED) : 0, dt);
      }
    }
  }

  // body check: an opponent crashing into the carrier knocks the ball loose.
  // a lunging tackle reaches further and bulldozes the carrier aside
  const carrier = ball.owner;
  if (carrier && ball.pos.y < 1.2) {
    for (const pl of players) {
      if (pl === carrier || pl.team === carrier.team) continue;
      const a = carrier.group.position;
      const b = pl.group.position;
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      const reach = pl.tackle > 0 ? TACKLE_RANGE : PLAYER_R * 1.9;
      if (d < reach && d > 0.0001) {
        dispossess(carrier, pl);
        if (pl.tackle > 0) tackleShove(pl, carrier);
        break;
      }
    }
  }

  // keep players from stacking on each other
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i].group.position;
      const b = players[j].group.position;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const min = PLAYER_R * 1.9;
      if (d < min && d > 0.0001) {
        const o = (min - d) / 2;
        a.x -= (dx / d) * o;
        a.z -= (dz / d) * o;
        b.x += (dx / d) * o;
        b.z += (dz / d) * o;
      }
    }
  }

  controllers.tickCharge(dt);

  stepBall(dt);
  if (live) tryPossess();

  // goal detection
  if (live) {
    for (const s of [1, -1]) {
      if (ball.pos.x * s > HALF_L + 0.2) {
        scoreGoal(s > 0 ? 'blue' : 'red');
        break;
      }
    }
  }

  // timers / state flow
  if (state === 'playing') {
    matchTime -= dt;
    if (matchTime <= 0) {
      matchTime = 0;
      endMatch();
    }
  } else if (state === 'kickoff') {
    stateTimer -= dt;
    if (stateTimer <= 0) {
      state = 'playing';
      hideBanner();
    }
  } else if (state === 'goal') {
    stateTimer -= dt;
    if (stateTimer <= 0) {
      if (matchTime <= 0) {
        endMatch();
      } else {
        resetKickoff();
        state = 'kickoff';
        stateTimer = 1.2;
        showBanner('KICK OFF');
      }
    }
  }
}

/* ---------- Visuals (per frame) ---------- */
function animatePlayers(dt, time) {
  for (const p of players) {
    const g = p.group;
    g.rotation.y = p.heading;

    const sp = Math.hypot(p.vel.x, p.vel.z);
    p.phase += sp * dt * 1.5;
    const amp = Math.min(1, sp / 6) * 0.9;
    const s = Math.sin(p.phase) * amp;
    p.legs[0].rotation.x = s;
    p.legs[1].rotation.x = -s;
    p.arms[0].rotation.x = -s * 0.8;
    p.arms[1].rotation.x = s * 0.8;

    if (p.kickAnim > 0) {
      p.kickAnim -= dt;
      p.legs[0].rotation.x = -1.4 * Math.sin((1 - Math.max(0, p.kickAnim) / 0.25) * Math.PI);
    }

    if (p.tackle > 0) {
      // lunge pose: shoulder into it, braced, arms driving forward
      p.arms[0].rotation.x = -2.6;
      p.arms[1].rotation.x = -2.6;
      g.rotation.x = -0.3;
    } else {
      g.rotation.x = 0;
    }

    if (state === 'goal' && p.team === lastScorer) {
      g.position.y = Math.abs(Math.sin(time * 9 + p.phase)) * 0.35;
      p.arms[0].rotation.x = -2.8;
      p.arms[1].rotation.x = -2.8;
    } else {
      g.position.y = 0;
    }
  }
}

const camFocus = { x: 0 };
function updateCamera(dt) {
  const targetX = clamp(ball.pos.x * 0.8, -14, 14);
  camFocus.x += (targetX - camFocus.x) * (1 - Math.exp(-3 * dt));
  const zoom = Math.max(1, 1.7 / camera.aspect);
  camera.position.set(camFocus.x, 20 * zoom, 22 * zoom);
  camera.lookAt(camFocus.x, 0, 1.5);
}

function updateHud() {
  $score.textContent = `${teams.blue.score} - ${teams.red.score}`;
  const t = Math.ceil(matchTime);
  $clock.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  $power.classList.toggle('show', controllers.slots.some((s) => s.charging));
  $powerBars.forEach((bar, i) => {
    const s = controllers.slots[i];
    bar.classList.toggle('show', !!s && s.charging);
    if (s) bar.firstElementChild.style.width = `${s.charge * 100}%`;
  });
}

/* ---------- Main loop ---------- */
let last = performance.now();
let acc = 0;

function animate(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  clockTime += dt;

  pollGamepads();
  controllers.updatePads();

  acc += dt;
  while (acc >= STEP) {
    simulate(STEP);
    acc -= STEP;
  }

  animatePlayers(dt, clockTime);

  const showMarker = state === 'playing' || state === 'kickoff';
  for (const slot of controllers.slots) {
    const m = slot.marker;
    if (!m) continue;
    const pos = teams[slot.team].players[slot.player].group.position;
    const on = showMarker && controllers.isPlayable(slot);
    m.ring.visible = m.arrow.visible = on;
    if (!on) continue;
    m.ring.position.set(pos.x, 0.04, pos.z);
    m.arrow.position.set(pos.x, 2.9 + Math.sin(clockTime * 5) * 0.12, pos.z);
    m.arrow.rotation.y = clockTime * 2;
  }

  updateCamera(dt);
  updateHud();
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// initial arrangement behind the menu
applyMode('solo');
resetKickoff();