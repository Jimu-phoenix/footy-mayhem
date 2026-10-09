# ⚽ Mini Football 3D

A tiny 2-vs-2 football (soccer) game built with **three.js**. One human drives a
player, the rest are AI; most goals in 2 minutes wins. Supports keyboard, one
controller (single player / co-op) and two controllers (local versus).

## Run

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # production bundle in dist/
npm run preview   # serve the production build
```

## Dependencies

| Package | Version | Role |
|---|---|---|
| `three` | `^0.186.1` | 3D rendering (runtime) |
| `vite` | `^8.3.0` | dev server + bundler (dev) |

**No new libraries were added for controller support.** Gamepads use the
built-in browser [Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API)
(`navigator.getGamepads()`), so there is nothing extra to install.

## Files

| File | Purpose |
|---|---|
| `index.html` | Entry page (loads `/src/main.js` as a module) |
| `src/main.js` | Scene, pitch, players, ball physics, AI, match state machine, HUD |
| `src/gamepad.js` | **New** — Gamepad API wrapper: per-frame polling, radial deadzone, D-pad as stick, press/release edge detection, connect/disconnect events |
| `src/controllers.js` | **New** — controller *slots*: binds one input source (keyboard + pad) to one player, per-slot shot charge/release, player switching, pad rebinding |
| `src/counter.js`, `src/style.css`, `src/assets/` | Unused leftovers from the Vite template |

## Game modes

Chosen on the menu card (2-player modes unlock once two controllers are
connected):

| Mode | Slot 0 | Slot 1 |
|---|---|---|
| **1P vs AI** | BLUE player 1 (keyboard + pad 1) | — (AI) |
| **Co-op 2P** | BLUE player 1 (keyboard + pad 1) | BLUE player 2 (pad 2) |
| **Versus 1v1** | BLUE player 1 (keyboard + pad 1) | RED player 1 (pad 2) |

- The **keyboard always mirrors slot 0**, so you can play with a controller, a
  keyboard, or both at once on the same player.
- A slot whose pad disconnects **falls back to AI** for the rest of the match.
- Player switching (Q/Tab/LB) is disabled in co-op, because both players are
  already bound to a controller.

## Controls

### Keyboard

| Action | Key |
|---|---|
| Move | `WASD` / `Arrows` |
| Sprint | `Shift` |
| Shoot (hold to charge) | `Space` |
| Tackle | `F` |
| Switch player | `Q` / `E` / `Tab` |
| Kick off / restart | `Enter` / `R` |

### Gamepad (standard mapping)

| Action | Button |
|---|---|
| Move | Left stick / D-pad |
| Sprint | `RT` (R2) |
| Shoot (hold to charge) | `X` (Xbox) / `□` (PS) — hold, release to kick |
| Tackle | `B` (Xbox) / `○` (PS) |
| Switch player | `LB` (L1) |
| Kick off / continue | `A` (Cross) or `Start` |
| Restart match | `Start` (Options) |

Button mapping lives in one place: the `MAP` constant at the top of
`src/gamepad.js`.

## Ball possession (dribbling)

Get near a slow ball and it sticks to your feet; turning carries it with you.

- **Pick up**: nearest player within `POSSESS_R` (1.0 m), ball below 1 m, ball
  slower than `POSSESS_MAX_V` (14 m/s — shots zip past instead of being caught),
  `kickCd`/`lostCd` clear. Humans and AI use the identical rule.
- **While carrying**: the ball is pulled to a point `DRIBBLE_D` (0.62 m) ahead
  of the carrier's heading by a spring (`SPRING_K` 40), so it settles ~0.40 m
  ahead at running speed, ~0.71 m while sprinting, and a sharp turn makes it lag
  for ~75 ms before swinging back. Velocity is derived from actual movement,
  so releasing keeps the right momentum.
- **Losing it**: an opponent touching the ball, or an opponent's body touching
  the carrier (within the player separation radius), pops the ball out — blended
  between "away from the carrier" and the tackler's momentum — for
  `POP_SPEED` + 0.35 × tackle speed. The carrier is locked out for
  `POSSESS_LOCK` (0.3 s); the ball stays loose for `POSSESS_DELAY` (0.15 s) so
  nobody re-glues it instantly. Teammates never disturb possession.
- **Also releases on**: shooting (`kickBall`), the ball drifting beyond
  `DROP_R` (1.15 m, e.g. after a wall clamp), kickoff/goal/full-time states.

Tuning knobs live with the other constants at the top of `src/main.js`.

## Tackling

Press the tackle button (`F` / `B` / click) for a **lunge**: a 0.26 s dash that
outruns sprinting and, while active, **homing-pulls you onto the ball** — so a
nearby ball or opponent carrier can't be dodged by drifting half a metre.

- **Lunge**: `TACKLE_SPEED` 13.5 m/s, launched face-first down your current
  movement direction. Steering (stick / buttons / AI) is locked out for the
  lunge — the ball is the only thing that bends your path. Ends in `TACKLE_TIME`
  seconds; next lunge available after `TACKLE_CD` 0.75 s.
- **Magnet**: within `TACKLE_MAGNET_R` 2.4 m and roughly ahead of you, the run
  bends toward a *lead point* on the ball (position + velocity × 0.12), so you
  connect even as the ball rolls or the carrier shifts.
- **On contact with an opponent carrier**: dispossession (same pop-out as before)
  is forced at the wider `TACKLE_RANGE` (1.21 m) instead of the usual 1.05 m,
  and the carrier is **shoved** with `TACKLE_KNOCK` 8 m/s away from you — the
  push is what lets you run off with the loose ball.
- **AI uses the identical mechanic**: the designated presser lunges once it
  closes to ~1.6 m of an opponent carrier, so human and CPU tackles behave the
  same way.
- Hitting the ball (or an opponent) during the lunge has no extra cooldown or
  wind-up; the trade-off is that you commit to the burst and can be beaten by a
  well-timed direction change.

## HUD notes

- Two shot-power bars (bottom centre), one per controller slot — only the bar of
  a charging player is visible.
- Player markers: **yellow** ring + arrow for slot 0, **green** for slot 1.
- The help box (bottom left) appends the gamepad legend as soon as a controller
  is detected; a toast appears when a controller connects or disconnects.
- Menu shows how many controllers are connected.

## Browser support / caveats

- Gamepad API works in Chrome, Edge, Firefox and Safari (desktop).
- Browsers only expose a controller after it is **pressed once**, and it must be
  plugged in **before** the page loads (or you can press a button — the
  `gamepadconnected` event still fires afterwards).
- Physics runs on a fixed 120 Hz step (`STEP` in `src/main.js`); controller
  state is polled once per animation frame and read by every sub-step.
