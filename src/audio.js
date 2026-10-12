import kickUrl from './assets/audio/kick.ogg';
import crowdUrl from './assets/audio/crowd.mp3';
import cheerUrl from './assets/audio/cheer.mp3';
import whistleUrl from './assets/audio/whistle.ogg';

// Tiny Web Audio engine. Clips: kick + referee whistle are CC0 (BigSoundBank);
// the live-stadium crowd bed and goal roar are from Mixkit (Mixkit Free License).
// Browsers block audio until a user gesture, so nothing starts until
// unlockAudio() is called from a click/keypress; everything else no-ops before.

let ctx = null;
let master = null;
let loaded = false;
const bufs = {};

let fansSrc = null;
let fansGain = null;
let fansTarget = 0; // desired gain, smoothed toward

function init() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  Promise.all([
    decode('kick', kickUrl),
    decode('crowd', crowdUrl),
    decode('cheer', cheerUrl),
    decode('whistle', whistleUrl),
  ]).then(() => {
    loaded = true;
    if (fansTarget > 0) ensureFans();
  });
  return ctx;
}

async function decode(key, url) {
  try {
    const res = await fetch(url);
    bufs[key] = await ctx.decodeAudioData(await res.arrayBuffer());
  } catch {
    /* missing/undecodable clip: just play without it */
  }
}

function resume() {
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

// call from the first click / keypress so the audio context can start
export function unlockAudio() {
  const c = init();
  if (c) resume();
}

// shot or pass — the same crisp hit, volume scaled by power (no random pitch)
export function playKick(power = 0.6) {
  const c = init();
  if (!c || !bufs.kick) return;
  resume();
  const src = c.createBufferSource();
  src.buffer = bufs.kick;
  const g = c.createGain();
  g.gain.value = 0.18 + 0.7 * Math.min(1, Math.max(0, power));
  src.connect(g);
  g.connect(master);
  src.start();
}

// one-shot roar for a goal
export function playCheer() {
  const c = init();
  if (!c || !bufs.cheer) return;
  resume();
  const src = c.createBufferSource();
  src.buffer = bufs.cheer;
  const g = c.createGain();
  g.gain.value = 0.6;
  src.connect(g);
  g.connect(master);
  src.start();
}

export function playWhistle() {
  const c = init();
  if (!c || !bufs.whistle) return;
  resume();
  const src = c.createBufferSource();
  src.buffer = bufs.whistle;
  const g = c.createGain();
  g.gain.value = 0.35;
  src.connect(g);
  g.connect(master);
  src.start();
}

// looping crowd ambience; level lets a goal briefly swell the fans
export function setFans(on, level = 1) {
  fansTarget = on ? level : 0;
  const c = init();
  if (!c) return;
  resume();
  if (fansTarget > 0) ensureFans();
  applyFansGain();
}

function ensureFans() {
  if (!loaded || !bufs.crowd || fansSrc) return;
  fansSrc = ctx.createBufferSource();
  fansSrc.buffer = bufs.crowd;
  fansSrc.loop = true;
  fansGain = ctx.createGain();
  fansGain.gain.value = 0.0001;
  fansSrc.connect(fansGain);
  fansGain.connect(master);
  fansSrc.start();
}

function applyFansGain() {
  if (!fansGain) return;
  const t = ctx.currentTime;
  const target = Math.max(0.0001, fansTarget * 0.55);
  fansGain.gain.cancelScheduledValues(t);
  fansGain.gain.setTargetAtTime(target, t, 0.35); // smooth fade in/out
}
