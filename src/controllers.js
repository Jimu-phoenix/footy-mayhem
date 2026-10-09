/* Controller slots: one slot = one input source driving one player.
   Slot 0 always mirrors the keyboard; extra slots are filled by gamepads.
   Modes:   solo   -> slot 0 on BLUE
            coop   -> slots 0+1 on BLUE (second pad takes the other player)
            versus -> slot 0 on BLUE, slot 1 on RED
   A slot with no usable input source falls back to AI. */

import { MAP, getPad, connectedPads } from './gamepad.js';

export function createControllers(deps) {
  const slots = [];
  let mode = 'solo';

  const makeSlot = (id, team, player, hasKeyboard) => ({
    id,
    team,
    player,
    hasKeyboard,
    padIndex: null,
    charging: false,
    charge: 0,
    marker: null,
  });

  function setMode(next) {
    mode = next;
    slots.length = 0;
    slots.push(makeSlot(0, 'blue', 0, true));
    if (next === 'coop') slots.push(makeSlot(1, 'blue', 1, false));
    if (next === 'versus') slots.push(makeSlot(1, 'red', 0, false));
    rebind();
  }

  function rebind() {
    const pool = connectedPads().map((p) => p.index);
    for (const s of slots) {
      const at = s.padIndex == null ? -1 : pool.indexOf(s.padIndex);
      if (at >= 0) pool.splice(at, 1);
      else s.padIndex = null;
    }
    for (const s of slots) if (s.padIndex == null && pool.length) s.padIndex = pool.shift();
    for (const s of slots) {
      if (!isPlayable(s)) {
        s.charging = false;
        s.charge = 0;
      }
    }
  }

  function isPlayable(slot) {
    return !!slot && (slot.hasKeyboard || slot.padIndex != null);
  }

  function slotFor(player) {
    for (const s of slots) {
      if (deps.teams[s.team].players[s.player] === player) return s;
    }
    return null;
  }

  function inputFor(slot) {
    let x = 0;
    let z = 0;
    let len = 0;
    let sprint = false;

    const k = slot.hasKeyboard ? deps.getKeyboard() : null;
    if (k && k.len > 0) {
      x = k.x;
      z = k.z;
      len = k.len;
      sprint = k.sprint;
    } else {
      const pad = slot.padIndex != null ? getPad(slot.padIndex) : null;
      if (pad) {
        const pl = Math.hypot(pad.x, pad.z);
        if (pl > 0) {
          x = pad.x / pl; // direction is always unit-length
          z = pad.z / pl;
          len = pl;
        }
        sprint = pad.sprint;
      }
      if (k) sprint = sprint || k.sprint;
    }
    return { x, z, len, sprint };
  }

  function startCharge(slot) {
    if (!isPlayable(slot) || deps.getState() !== 'playing') return;
    slot.charging = true;
    slot.charge = 0;
  }

  function tickCharge(dt) {
    for (const s of slots) {
      if (s.charging) s.charge = Math.min(1, s.charge + dt / 0.9);
    }
  }

  function release(slot) {
    if (!slot) return;
    const wasCharging = slot.charging;
    const power = 0.25 + 0.75 * slot.charge;
    slot.charging = false;
    slot.charge = 0;
    if (!wasCharging || deps.getState() !== 'playing') return;

    const team = deps.teams[slot.team];
    const p = team.players[slot.player];
    if (p.kickCd > 0 || deps.distToBall(p) > deps.KICK_RANGE || deps.ball.pos.y > 1.4) return;

    const input = inputFor(slot);
    let dx = input.len ? input.x : Math.sin(p.heading);
    let dz = input.len ? input.z : Math.cos(p.heading);
    const aimed = deps.assistAim(dx, dz, team);
    deps.kickBall(p, aimed.x, aimed.z, power);
  }

  function resetCharges() {
    for (const s of slots) {
      s.charging = false;
      s.charge = 0;
    }
  }

  function switchPlayer(slot) {
    if (!slot) return;
    const other = slot.player === 0 ? 1 : 0;
    const taken = slots.some((s) => s !== slot && s.team === slot.team && s.player === other);
    if (taken) return; // teammate is already driven by another controller
    slot.player = other;
  }

  function updatePads() {
    for (const s of slots) {
      if (s.padIndex == null) continue;
      const pad = getPad(s.padIndex);
      if (!pad) continue;
      const state = deps.getState();

      if (pad.justPressed.includes(MAP.shoot)) startCharge(s);
      if (pad.justReleased.includes(MAP.shoot)) release(s);
      if (pad.justPressed.includes(MAP.switchPrev) || pad.justPressed.includes(MAP.switchNext)) switchPlayer(s);
      if (pad.justPressed.includes(MAP.confirm) && (state === 'menu' || state === 'ended')) deps.startMatch();
      else if (pad.justPressed.includes(MAP.restart) && state !== 'menu') deps.startMatch();
    }
  }

  return {
    slots,
    mode: () => mode,
    setMode,
    rebind,
    isPlayable,
    slotFor,
    inputFor,
    startCharge,
    tickCharge,
    release,
    resetCharges,
    switchPlayer,
    updatePads,
  };
}
