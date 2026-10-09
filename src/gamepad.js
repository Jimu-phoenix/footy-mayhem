/* Thin wrapper over the browser Gamepad API.
   poll() once per frame; snapshots expose held state + press/release edges. */

export const MAP = {
  shoot: 2, // X (Xbox) / Square (PS)
  tackle: 1, // B (Xbox) / Circle (PS)
  switchPrev: 4, // LB / L1
  switchNext: 5, // RB / R1
  confirm: 0, // A / Cross
  restart: 9, // Start / Options
  sprint: 7, // RT / R2
};

const DEADZONE = 0.18;
const DPAD = { up: 12, down: 13, left: 14, right: 15 };
const STALE_MS = 1000;

const pads = new Map(); // index -> snapshot
const known = new Set();
const lastSeen = new Map();
const listeners = new Set();

function applyDeadzone(x, y) {
  const len = Math.hypot(x, y);
  if (len < DEADZONE) return [0, 0];
  // rescale magnitude to 0..1, keep the direction unit-length
  const mag = Math.min(1, (len - DEADZONE) / (1 - DEADZONE));
  return [(x / len) * mag, (y / len) * mag];
}

function emptySnapshot(index, id = '') {
  return {
    index,
    id,
    buttons: [],
    justPressed: [],
    justReleased: [],
    x: 0,
    z: 0,
    trigger: 0,
    sprint: false,
  };
}

function snapshot(g, prev) {
  const buttons = g.buttons.map((b) => b.pressed || b.value > 0.5);
  const justPressed = [];
  const justReleased = [];
  if (prev) {
    for (let i = 0; i < buttons.length; i++) {
      const before = prev.buttons[i] === true;
      if (buttons[i] && !before) justPressed.push(i);
      else if (!buttons[i] && before) justReleased.push(i);
    }
  }

  let [x, z] = applyDeadzone(g.axes[0] || 0, g.axes[1] || 0);
  const dx = (buttons[DPAD.right] ? 1 : 0) - (buttons[DPAD.left] ? 1 : 0);
  const dz = (buttons[DPAD.down] ? 1 : 0) - (buttons[DPAD.up] ? 1 : 0);
  const dl = Math.hypot(dx, dz);
  if (dl > 0 && dl > Math.hypot(x, z)) {
    x = dx / dl;
    z = dz / dl;
  }

  const trigger = g.buttons[MAP.sprint] ? g.buttons[MAP.sprint].value : 0;
  return {
    index: g.index,
    id: g.id,
    buttons,
    justPressed,
    justReleased,
    x,
    z,
    trigger,
    sprint: buttons[MAP.sprint] === true || trigger > 0.5,
  };
}

function emit(type, index, id) {
  for (const cb of listeners) cb({ type, index, id });
}

function noteConnected(index, id) {
  if (known.has(index)) return;
  known.add(index);
  lastSeen.set(index, performance.now());
  // empty button list so the first poll still reports that press as an edge
  pads.set(index, emptySnapshot(index, id));
  emit('connected', index, id);
}

function noteDisconnected(index) {
  if (!known.has(index)) return;
  known.delete(index);
  pads.delete(index);
  lastSeen.delete(index);
  emit('disconnected', index, '');
}

if (typeof window !== 'undefined') {
  window.addEventListener('gamepadconnected', (e) => noteConnected(e.gamepad.index, e.gamepad.id));
  window.addEventListener('gamepaddisconnected', (e) => noteDisconnected(e.gamepad.index));
}

export function onPadChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getPad(index) {
  return pads.get(index) || null;
}

export function connectedPads() {
  return [...pads.values()];
}

export function padCount() {
  return pads.size;
}

export function poll() {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
  const list = navigator.getGamepads();
  const live = new Set();
  const now = performance.now();

  for (const g of list) {
    if (!g || g.connected === false) continue;
    live.add(g.index);
    lastSeen.set(g.index, now);
    if (!known.has(g.index)) noteConnected(g.index, g.id);
    pads.set(g.index, snapshot(g, pads.get(g.index) || null));
  }

  for (const index of [...known]) {
    if (live.has(index)) continue;
    const seen = lastSeen.get(index) || 0;
    if (now - seen > STALE_MS) noteDisconnected(index);
  }
}
