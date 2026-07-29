// --- music theory helpers ---
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function midiToName(midi) {
  const octave = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}${octave}`;
}

// yue-qin: two courses (paired strings), tuned a fifth apart, modern chromatic frets.
// G3 course and D4 course, verified against reference tuning (see project notes).
const FRET_COUNT = 12; // open string + 11 frets = one octave

const STRINGS = {
  low: { base: 55, keys: ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', '/', ';', '\''] }, // G3
  high: { base: 62, keys: ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '[', ']'] }, // D4
};

const KEY_TO_NOTE = {};
for (const [string, cfg] of Object.entries(STRINGS)) {
  cfg.keys.forEach((key, fret) => {
    KEY_TO_NOTE[key] = { string, fret };
  });
}

// Real yueqin have 18-20 chromatic frets (vs. our 12-per-string
// simplification) and a demonstrated range of at least C4-C6 in a real
// player's own tuning scale — wider than the single octave our 12 frets
// cover. Rather than adding more keys (the keyboard rows are already
// full), an octave-shift control moves both strings by whole octaves —
// same key, same relative fret, different absolute pitch — like a
// synth's octave up/down. -1..+1 covers the full range found in the
// reference recordings' scale + tune (C4 to B5).
const OCTAVE_STEP = 12;
const OCTAVE_MIN = -1;
const OCTAVE_MAX = 1;
let octaveShift = 0;

function setOctaveShift(shift) {
  octaveShift = Math.max(OCTAVE_MIN, Math.min(OCTAVE_MAX, shift));
  render();
  const el = document.getElementById('octave-readout');
  if (el) el.textContent = `octave: ${octaveShift > 0 ? '+' : ''}${octaveShift}`;
}

// Traditional Chinese pentatonic (gong-shang-jue-zhi-yu — scale degrees
// 1-2-3-5-6, no 4th/7th) underlies most yue-qin repertoire even though the
// frets themselves are chromatic. Tonic is the low string's open note.
const PENTATONIC_INTERVALS = [0, 2, 4, 7, 9];
const TONIC_PC = STRINGS.low.base % 12;

function isPentatonic(midi) {
  const diff = ((midi % 12) - TONIC_PC + 12) % 12;
  return PENTATONIC_INTERVALS.includes(diff);
}

// --- DOM rendering ---
function render() {
  for (const [string, cfg] of Object.entries(STRINGS)) {
    const container = document.getElementById(`frets-${string}`);
    container.innerHTML = '';
    for (let fret = 0; fret < FRET_COUNT; fret++) {
      const midi = cfg.base + fret + octaveShift * OCTAVE_STEP;
      const div = document.createElement('div');
      div.className = 'fret' + (isPentatonic(midi) ? ' scale-note' : '');
      div.dataset.fret = String(fret);
      div.innerHTML = `<span class="key">${cfg.keys[fret]}</span><span class="note">${midiToName(midi)}</span>`;
      container.appendChild(div);
    }
  }
}

function lightUpFret(string, fret) {
  const el = document.querySelector(`#frets-${string} .fret[data-fret="${fret}"]`);
  if (!el) return;
  el.classList.add('lit');
  setTimeout(() => el.classList.remove('lit'), 150);
}

// --- audio ---
let ctx = null;
let manifest = null;
let masterBus = null;
const sampleBufferCache = {};

// --- live-adjustable tone controls (for A/B-ing by ear, not fixed choices) ---
let plateMode = 'harmonic';
let brightness = 0; // 0-1
let plateAmount = 1; // multiplier on the metallic layers' amount, 0 = off

// Two "plate" (metallic rattle) ratio sets to compare:
const PLATE_RATIOS = {
  // Tuned-by-ear set: close to integer harmonics (2x/4x/6x). Read as
  // "shimmer" rather than a competing pitch when compared earlier in the
  // project against wilder inharmonic sets.
  harmonic: [
    [2.02, 3.97, 6.05],
    [2.07, 4.06, 6.18],
    [3.5, 5.2, 7.8],
  ],
  // Wider, less-integer spacing, closer to how a real yueqin's internal
  // wire actually resonates — per organology.net it's "one or more metal
  // wires attached at only one end," and a wire fixed at only one end has
  // bending-mode ratios around 1:6.3:17.6, far more spread out than a
  // plucked string's own harmonics. Scaled down from those literal ratios
  // to stay in a musically useful register, and keeps each layer's first
  // partial near the consonant octave so it anchors the ear rather than
  // reading as a separate pitch (a wider first partial was tried earlier
  // and read as "wrong notes").
  inharmonic: [
    [2.05, 5.15, 9.3],
    [2.15, 5.6, 10.1],
    [3.5, 7.4, 12.6],
  ],
};

function setStatus(text) {
  document.getElementById('status').textContent = `audio: ${text}`;
}

function ensureAudio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Shared bus every voice routes through, so stacked notes get
    // compressed instead of clipping the output when they sum.
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.5;

    compressor.connect(masterGain);
    masterGain.connect(ctx.destination);
    masterBus = compressor;

    setStatus('ready');
  }
  if (ctx.state === 'suspended') ctx.resume();
}

// Loads samples/manifest.json if present, e.g.:
// { "low": { "0": "low-0.mp3" }, "high": { "3": "high-3.mp3" } }
// Any note missing from the manifest (or if the file doesn't exist at all)
// falls back to the synthesized pluck below. Drop real recordings into
// samples/ and list them here to swap them in — no code changes needed.
async function initSamples() {
  try {
    const res = await fetch('samples/manifest.json');
    if (!res.ok) return;
    manifest = await res.json();
  } catch {
    manifest = null;
  }
}

function getSampleBuffer(string, fret) {
  const key = `${string}-${fret}`;
  if (key in sampleBufferCache) return sampleBufferCache[key];
  const path = manifest?.[string]?.[fret];
  if (!path) {
    sampleBufferCache[key] = null;
    return null;
  }
  const promise = fetch(`samples/${path}`)
    .then((r) => r.arrayBuffer())
    .then((buf) => ctx.decodeAudioData(buf))
    .catch(() => null);
  sampleBufferCache[key] = promise;
  return promise;
}

// Karplus-Strong plucked-string synthesis, computed sample-by-sample into a
// buffer (not a live Web Audio feedback loop): a DelayNode-based feedback
// loop can't hold delays shorter than one processing block (~128 samples,
// ~2.9ms), which every note above roughly D4 needs — computing the classic
// difference equation directly sidesteps that and works at any pitch.
// `sustain: true` is how tremolo is faked. Calling pluck() repeatedly for
// rapid re-hits sounds like a piano being hammered — each call is an
// independent buffer with its own fresh attack transient and its own
// metallic-onset timers starting from zero, so the ear hears discrete
// strikes. Real tremolo is a string that's already vibrating getting
// re-excited, not re-struck from silence. Sustain mode renders one long
// buffer with a single attack, then periodically blends a smaller fresh
// noise burst into the still-ringing KS buffer at tremolo rate — the
// metallic layers and filters never restart, only the core string energy
// gets "recharged," which reads as one continuous shimmering tone instead
// of a flurry of separate hits. Returns a handle to release it cleanly.
function pluck(freq, { velocity = 1, sustain = false, attack = true } = {}) {
  const sampleRate = ctx.sampleRate;
  const period = sampleRate / freq;
  const ringLength = Math.max(2, Math.round(period));
  const duration = sustain ? 20 : 3;
  const length = Math.floor(sampleRate * duration);
  // 0.996 rang noticeably longer than the reference recordings (measured
  // ~10dB quieter than ours at matching timestamps throughout the decay).
  // 0.991 was still too sustained/guitar-like, especially layered — cut further.
  // Nudged back up slightly for a bit more twang/ring (metallic layers below
  // extended proportionally, ~30% longer, to match).
  const decay = 0.983;

  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  // Seed with white noise, then smooth it slightly — a real pluck's
  // excitation isn't perfectly bright, and the raw full-bandwidth noise
  // is what reads as "electronic" rather than wooden.
  // The 0.5/0.5 mix below is a one-pole lowpass on the excitation noise —
  // real plucks aren't full-bandwidth, and this smoothing is what reads as
  // "wooden" rather than "electronic." A real pluck nearer the bridge
  // preserves more high-frequency content in the excitation (the smoothing
  // effectively models plucking further from the bridge), so brightness
  // dials that smoothing back rather than EQ-boosting the result after the
  // fact — brightness=0 reproduces the original fixed 0.5/0.5 mix exactly.
  const smoothWeight = 0.5 * (1 - brightness);
  const ring = new Float32Array(ringLength);
  for (let i = 0; i < ringLength; i++) ring[i] = Math.random() * 2 - 1;
  for (let i = 0; i < ringLength; i++) {
    const before = ring[(i - 1 + ringLength) % ringLength];
    ring[i] = (1 - smoothWeight) * ring[i] + smoothWeight * before;
  }

  // Tremolo re-excitation: blend a smaller fresh noise burst into the
  // still-ringing buffer at roughly tremolo-picking rate, instead of
  // restarting the pluck. reinjectStrength < 1 so it recharges energy
  // without fully erasing whatever phase/texture the ring already has —
  // full replacement (1.0) sounded like a hard re-attack again. Base rate
  // sped up (was 0.13s/~7.7Hz, felt like too much gap between jumps) and
  // both the interval and the strength of each jump get randomized —
  // a real tremolo stroke isn't a metronome, and identical fixed-strength
  // jumps read as mechanical.
  const reinjectBaseSamples = Math.round(0.09 * sampleRate);
  let nextReinject = reinjectBaseSamples;

  // The yue-qin's characteristic sound comes from an internal metal plate
  // that rattles against the body as the string vibrates. A noise-driven
  // resonator read as gritty/staticky rather than clean, so instead this
  // is a few short sine partials tuned to inharmonic ratios of the note's
  // own pitch (real metal/bell resonances aren't integer multiples of the
  // fundamental — that inharmonicity is what reads as "metallic" rather
  // than just another string harmonic). Being pitch-relative keeps it
  // sounding in tune with whatever note is played instead of clashing.
  // Close to (but slightly detuned from) real harmonics rather than wildly
  // inharmonic — enough detuning to shimmer, not so much it reads as a
  // separate, clashing pitch. Two layers with slightly different detuning
  // and decay times beat against each other as the note rings, instead of
  // one fixed layer that stays locked to the fundamental the whole decay
  // (which read as static/"flat" rather than alive).
  // The second layer starts slightly after the pluck (like a plate's
  // resonance building up after the strike) instead of firing in exact
  // sync with the string's own attack, which read as a second string
  // being plucked underneath rather than one texture — most noticeable on
  // higher notes since the metallic partials land further from the
  // fundamental there.
  // Third plate: same shape as the other two, but its ratios get a
  // per-note detuning offset derived deterministically from the note's own
  // frequency (a cheap hash, not Math.random) — so a given key always
  // sounds the same way twice, but different notes each have their own
  // slightly different plate character instead of all sharing one fixed
  // detuning.
  const plate3Seed = Math.sin(freq * 12.9898) * 43758.5453;
  const plate3Detune = (plate3Seed - Math.floor(plate3Seed) - 0.5) * 0.3; // +-15%

  const plateSet = PLATE_RATIOS[plateMode];
  const metallicLayers = [
    { ratios: plateSet[0], amount: 0.02 * plateAmount, decayTau: 0.33, onsetDelay: 0.012 },
    { ratios: plateSet[1], amount: 0.013 * plateAmount, decayTau: 0.45, onsetDelay: 0.03 },
    {
      ratios: plateSet[2].map((r) => r * (1 + plate3Detune)),
      amount: 0.035 * plateAmount,
      decayTau: 0.5,
      onsetDelay: 0.02,
    },
  ];
  // Plate ratios are fixed multiples of the fundamental, so on higher notes
  // they land in an already-busy, brighter register — turn the plates down
  // and the string itself up as pitch rises, referenced against the lowest
  // open string (G3). The lowest notes (near/at G3 itself) also got a
  // "bees"-like beating buzz from the plates — reduce there too, since
  // those notes were getting the least reduction of any note before.
  const highReduction = Math.max(0.35, Math.min(1, 196 / freq));
  const lowReduction = Math.max(0.4, Math.min(1, freq / 320));
  const metallicScale = highReduction * lowReduction;
  const mainBoost = Math.max(1, Math.min(1.25, freq / 196));
  for (const layer of metallicLayers) {
    layer.phaseInc = layer.ratios.map((r) => (2 * Math.PI * freq * r) / sampleRate);
    layer.phase = layer.ratios.map(() => 0);
    layer.delaySamples = Math.round(layer.onsetDelay * sampleRate);
    layer.amount *= metallicScale;
  }

  let index = 0;
  let prev = ring[ringLength - 1];
  for (let i = 0; i < length; i++) {
    if (sustain && i >= nextReinject) {
      const strength = 0.25 + Math.random() * 0.25; // 0.25-0.5, varies per jump
      for (let j = 0; j < ringLength; j++) {
        ring[j] = ring[j] * (1 - strength) + (Math.random() * 2 - 1) * strength;
      }
      // +-30% jitter on the interval itself so jumps don't land metronomically
      nextReinject = i + Math.round(reinjectBaseSamples * (0.7 + Math.random() * 0.6));
    }

    const current = ring[index];

    let rattle = 0;
    for (const layer of metallicLayers) {
      if (i < layer.delaySamples) continue;
      let metallic = 0;
      for (let m = 0; m < layer.ratios.length; m++) {
        metallic += Math.sin(layer.phase[m]);
        layer.phase[m] += layer.phaseInc[m];
      }
      const env = Math.exp(-((i - layer.delaySamples) / sampleRate) / layer.decayTau);
      rattle += (metallic / layer.ratios.length) * layer.amount * env;
    }

    data[i] = current * mainBoost + rattle;

    const next = decay * 0.5 * (current + prev);
    prev = current;
    ring[index] = next;
    index = (index + 1) % ringLength;
  }

  // Soften the instantaneous silence-to-noise jump at note-start so
  // simultaneous notes (chords) don't sum into a harsh digital edge, but
  // keep it short and front-loaded (sqrt curve reaches most of its volume
  // fast, then eases in the rest) rather than a slow linear ramp, which
  // read as too soft/"chill" instead of a percussive pluck.
  // Skipped when a note is escalating from a quick pluck into a held
  // tremolo sustain (see keydown handler) — that quick pluck already
  // provided the attack, so fading this buffer in too would sound like a
  // second, separate hit landing on top of the first.
  if (attack) {
    const fadeSamples = Math.min(Math.round(sampleRate * 0.018), length);
    for (let i = 0; i < fadeSamples; i++) data[i] *= Math.sqrt(i / fadeSamples);
  }

  const src = ctx.createBufferSource();
  src.buffer = buffer;

  // Tiny random variation so the same key played twice isn't identical,
  // like a real pluck never lands with perfectly repeatable force.
  const humanize = 0.93 + Math.random() * 0.14;

  const output = ctx.createGain();
  output.gain.value = velocity * 0.6 * humanize;

  // Reference recordings show the 2nd harmonic staying close to the
  // fundamental in level (not far below it, as plain Karplus-Strong
  // tends to produce) — a modest resonance boost there fills that in.
  const bodyResonance = ctx.createBiquadFilter();
  bodyResonance.type = 'peaking';
  bodyResonance.frequency.value = freq * 2;
  bodyResonance.Q.value = 4;
  bodyResonance.gain.value = 4;

  src.connect(bodyResonance);
  bodyResonance.connect(output);
  output.connect(masterBus);
  src.start();

  // Every pluck gets a stop handle, not just sustain ones — otherwise a
  // quick (non-tremolo) pluck's fixed-length buffer plays out in full no
  // matter when the key is released, which reads as the note being stuck.
  return {
    stop(releaseSeconds = 0.15) {
      const now = ctx.currentTime;
      output.gain.cancelScheduledValues(now);
      output.gain.setValueAtTime(output.gain.value, now);
      output.gain.linearRampToValueAtTime(0, now + releaseSeconds);
      src.stop(now + releaseSeconds + 0.05);
    },
  };
}

// --- live relay (optional) ---
// Broadcasts each pluck as a tiny JSON event ({senderId, string, fret,
// octaveShift}) over a WebSocket relay so anyone else with the page open
// hears the same note, re-synthesized locally through this exact same
// pluck() — no audio streaming, just re-triggering the instrument on their
// end. Held tremolo-sustain notes (escalateTimers below) aren't broadcast
// yet — smaller, separate lift, cut from this first pass since quick
// plucks and song playback already cover the main "hear me play" case.
const CLIENT_ID = Math.random().toString(36).slice(2);
const RELAY_URL_KEY = 'yueqinRelayUrl';
let relaySocket = null;

function relayStatus(text) {
  const el = document.getElementById('relay-status');
  if (el) el.textContent = `relay: ${text}`;
}

function connectRelay(url) {
  if (!url) return;
  if (relaySocket) relaySocket.close();
  relayStatus('connecting…');
  relaySocket = new WebSocket(url);
  relaySocket.addEventListener('open', () => relayStatus('connected'));
  relaySocket.addEventListener('close', () => relayStatus('disconnected'));
  relaySocket.addEventListener('error', () => relayStatus('error'));
  relaySocket.addEventListener('message', (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.senderId === CLIENT_ID) return;
    ensureAudio();
    playNote(msg.string, msg.fret, msg.octaveShift, { broadcast: false });
  });
  localStorage.setItem(RELAY_URL_KEY, url);
}

function sendRelay(payload) {
  if (relaySocket && relaySocket.readyState === WebSocket.OPEN) {
    relaySocket.send(JSON.stringify({ senderId: CLIENT_ID, ...payload }));
  }
}

async function playNote(string, fret, shift = octaveShift, { broadcast = true } = {}) {
  lightUpFret(string, fret);
  const midi = STRINGS[string].base + fret + shift * OCTAVE_STEP;
  const freq = midiToFreq(midi);

  if (broadcast) sendRelay({ string, fret, octaveShift: shift });

  const sampleBuf = manifest ? await getSampleBuffer(string, fret) : null;
  if (sampleBuf) {
    const src = ctx.createBufferSource();
    src.buffer = sampleBuf;
    const output = ctx.createGain();
    src.connect(output);
    output.connect(masterBus);
    src.start();
    return {
      stop(releaseSeconds = 0.15) {
        const now = ctx.currentTime;
        output.gain.cancelScheduledValues(now);
        output.gain.setValueAtTime(output.gain.value, now);
        output.gain.linearRampToValueAtTime(0, now + releaseSeconds);
        src.stop(now + releaseSeconds + 0.05);
      },
    };
  }
  return pluck(freq);
}

// --- songs ---
// Pre-programmed melodies that play back on their own, triggered by a
// button, instead of needing to be performed live. Notes are stored as
// [scaleDegreeOffset|null, durationInEighthNotes] pairs — offsets are
// semitones above the instrument's own tonic (the low string's open note),
// so a song written this way automatically follows whatever the tonic is,
// and reusing PENTATONIC_INTERVALS-style degrees keeps it landing on the
// scale-highlighted frets. `null` is a rest. offsetToStringFret() picks
// the low string when the offset fits on it, and spills onto the high
// string above that (the two strings overlap at a fifth apart, so this
// isn't the only valid fingering — just a simple one).
const STRING_INTERVAL = STRINGS.high.base - STRINGS.low.base; // fifth, in semitones

function offsetToStringFret(offset) {
  if (offset < FRET_COUNT) return { string: 'low', fret: offset };
  return { string: 'high', fret: offset - STRING_INTERVAL };
}

// For songs authored as absolute pitches (transcribed from a real
// recording) rather than tonic-relative scale degrees. Searches nearby
// octave-shift zones so a song can reach notes outside the current
// default view — playSong() re-points the visible octave per note so the
// board tracks where the melody actually is.
function midiToStringFretOctave(midi) {
  for (const shift of [0, 1, -1, 2, -2]) {
    if (shift < OCTAVE_MIN || shift > OCTAVE_MAX) continue;
    for (const [string, cfg] of Object.entries(STRINGS)) {
      const fret = midi - cfg.base - shift * OCTAVE_STEP;
      if (fret >= 0 && fret < FRET_COUNT) return { string, fret, octaveShift: shift };
    }
  }
  return null;
}

// Mo Li Hua (茉莉花 / "Jasmine Flower") — Jiangnan folk tune, Qing dynasty
// (18th c., possibly earlier). Transcribed from the melody as given in
// LilyPond notation on Wikipedia's Mo Li Hua article (itself traced to the
// John Barrow 1804 transcription lineage), then re-expressed as scale
// degrees so it transposes cleanly onto this instrument's tonic. Uses only
// do/re/mi/sol/la (offsets 0/2/4/7/9) — no 4th or 7th — matching the
// gong-shang-jue-zhi-yu pentatonic already highlighted on the fretboard.
const MOLIHUA_SEQUENCE = [
  [4, 2], [4, 1], [7, 1], [9, 1], [12, 1], [12, 1], [9, 1],
  [7, 2], [7, 1], [9, 1], [7, 2], [null, 2],
  [7, 2], [7, 2], [7, 2], [4, 1], [7, 1],
  [9, 2], [9, 2], [7, 4],
  [4, 2], [2, 1], [4, 1], [7, 2], [4, 1], [2, 1],
  [0, 2], [0, 1], [2, 1], [0, 4],
  [4, 1], [2, 1], [0, 1], [4, 1], [2, 3], [4, 1],
  [7, 2], [9, 1], [12, 1], [7, 4],
  [2, 2], [4, 1], [7, 1], [2, 1], [4, 1], [0, 1], [9, 1],
  [7, 4], [9, 2], [12, 2],
  [2, 3], [4, 1], [0, 1], [2, 1], [0, 1], [9, 1],
  [7, 4], [null, 4],
];

function buildSong(sequence, eighthSeconds) {
  const notes = [];
  let t = 0;
  for (const [offset, eighths] of sequence) {
    if (offset !== null) {
      const { string, fret } = offsetToStringFret(offset);
      notes.push({ string, fret, octaveShift: 0, sustain: false, time: t });
    }
    t += eighths * eighthSeconds;
  }
  return { notes, duration: t };
}

// Transcribed from a real solo yueqin recording: a straight ascending
// two-octave scale (C4-B5, technical range demo — not pentatonic, so not
// idiomatic repertoire). Split out as its own piece from what was
// originally one combined "scale + tune" transcription — see
// TUNE_SEQUENCE below for the melody that immediately follows it in the
// actual recording. Pitch/onset detection via autocorrelation (YIN-style)
// + RMS-rise onset finding, corrected for the pitch detector's octave and
// 1/3-subharmonic lock errors by cross-checking against the scale's own
// verified stepwise structure.
const SCALE_SEQUENCE = [
  // [midi, time, duration, sustain]
  [60, 0.00, 0.54, false], [62, 0.54, 0.44, false], [64, 0.98, 0.43, false],
  [65, 1.41, 0.37, false], [67, 1.78, 0.39, false], [69, 2.17, 0.37, false],
  [71, 2.54, 0.38, false], [72, 2.92, 0.37, false], [74, 3.29, 0.38, false],
  [76, 3.67, 0.34, false], [77, 4.01, 0.38, false], [79, 4.39, 0.35, false],
  [81, 4.74, 0.38, false], [83, 5.12, 0.47, false],
];

// The opening of the actual tune, immediately following the scale above in
// the same reference recording — split out as its own playable piece.
// Times re-zeroed to this section's own start (originally began at 5.59s
// into the combined recording). Same transcription method as the scale;
// for this section specifically, the pitch-detector correction was
// re-seeded at this boundary rather than assumed continuous from the
// scale's last note (an earlier pass got this wrong — see project notes).
// `sustain: true` notes are tremolo/held passages in the real performance
// (repeated rapid re-plucks the onset detector caught as distinct hits,
// merged back into one note each) — represented as one continuous sustain
// voice rather than rapid separate triggers, since the tremolo technique
// itself is the point, not simplified away.
const TUNE_SEQUENCE = [
  // [midi, time, duration, sustain]
  [72, 0.00, 5.45, true],
  [77, 5.45, 1.09, true],
  [72, 6.54, 1.03, true],
  [74, 7.57, 0.77, true],
  [76, 8.34, 0.78, true],
  [72, 9.12, 0.58, false],
  [69, 9.70, 1.91, true],
  [72, 11.61, 0.26, false],
  [74, 11.87, 0.80, true],
  [77, 12.67, 0.28, false],
  [72, 12.95, 0.26, false],
  [69, 13.21, 0.27, false],
  [72, 13.48, 0.55, false],
  [77, 14.03, 0.83, true],
  [76, 14.86, 1.99, true],
  [81, 16.85, 1.44, true],
];

function buildAbsoluteSong(sequence) {
  const notes = sequence.map(([midi, time, duration, sustain]) => {
    const loc = midiToStringFretOctave(midi);
    return { ...loc, time, duration, sustain };
  });
  const duration = Math.max(...notes.map((n) => n.time + n.duration));
  return { notes, duration };
}

const SONGS = {
  moliHua: {
    title: 'Mo Li Hua (茉莉花)',
    ...buildSong(MOLIHUA_SEQUENCE, 0.25), // 96 eighths @ 0.25s = 24s
  },
  scale: {
    title: 'Scale (reference recording)',
    ...buildAbsoluteSong(SCALE_SEQUENCE),
  },
  tune: {
    title: 'Tune (reference recording)',
    ...buildAbsoluteSong(TUNE_SEQUENCE),
  },
};

let activeSongTimeouts = [];
let activeSongSustainVoices = [];
let activeSongId = null;

function stopSong() {
  activeSongTimeouts.forEach(clearTimeout);
  activeSongTimeouts = [];
  activeSongSustainVoices.forEach((v) => v.stop());
  activeSongSustainVoices = [];
  activeSongId = null;
  document.querySelectorAll('.song-btn').forEach((b) => b.classList.remove('playing'));
  setOctaveShift(0);
}

function playSong(id) {
  ensureAudio();
  stopSong();
  activeSongId = id;
  const song = SONGS[id];
  document.querySelector(`.song-btn[data-song="${id}"]`)?.classList.add('playing');
  for (const note of song.notes) {
    const startTimeout = setTimeout(() => {
      // Songs authored with absolute pitches can span more than one
      // octave zone — jump the visible octave to match each note so the
      // board's highlighted fret always corresponds to what's playing.
      setOctaveShift(note.octaveShift);
      if (note.sustain) {
        lightUpFret(note.string, note.fret);
        const midi = STRINGS[note.string].base + note.fret + note.octaveShift * OCTAVE_STEP;
        const voice = pluck(midiToFreq(midi), { sustain: true });
        activeSongSustainVoices.push(voice);
        const stopTimeout = setTimeout(() => {
          voice.stop();
          activeSongSustainVoices = activeSongSustainVoices.filter((v) => v !== voice);
        }, note.duration * 1000);
        activeSongTimeouts.push(stopTimeout);
      } else {
        playNote(note.string, note.fret, note.octaveShift);
      }
    }, note.time * 1000);
    activeSongTimeouts.push(startTimeout);
  }
  const endTimeout = setTimeout(() => {
    if (activeSongId === id) stopSong();
  }, song.duration * 1000 + 500);
  activeSongTimeouts.push(endTimeout);
}

function renderSongs() {
  const container = document.getElementById('songs');
  for (const [id, song] of Object.entries(SONGS)) {
    const btn = document.createElement('button');
    btn.className = 'song-btn';
    btn.dataset.song = id;
    btn.textContent = `▶ ${song.title}`;
    btn.addEventListener('click', () => playSong(id));
    container.appendChild(btn);
  }
  const stopBtn = document.createElement('button');
  stopBtn.className = 'song-btn stop-btn';
  stopBtn.textContent = '■ stop';
  stopBtn.addEventListener('click', stopSong);
  container.appendChild(stopBtn);
}

document.getElementById('plate-toggle').addEventListener('click', (e) => {
  plateMode = plateMode === 'harmonic' ? 'inharmonic' : 'harmonic';
  e.target.textContent = `plates: ${plateMode}`;
});

document.getElementById('brightness').addEventListener('input', (e) => {
  brightness = Number(e.target.value) / 100;
});

document.getElementById('plate-amount').addEventListener('input', (e) => {
  plateAmount = Number(e.target.value) / 100;
});

document.getElementById('octave-down').addEventListener('click', () => setOctaveShift(octaveShift - 1));
document.getElementById('octave-up').addEventListener('click', () => setOctaveShift(octaveShift + 1));

const relayUrlInput = document.getElementById('relay-url');
const relayConnectBtn = document.getElementById('relay-connect');
const savedRelayUrl = localStorage.getItem(RELAY_URL_KEY);
if (savedRelayUrl && relayUrlInput) relayUrlInput.value = savedRelayUrl;
relayConnectBtn?.addEventListener('click', () => connectRelay(relayUrlInput.value.trim()));

// --- input ---
// A key press always starts as a normal, cheap quick pluck (unchanged,
// ~19ms to compute — matters for fast melodic runs where every note goes
// through this). Only if the key is *still held* after one tremolo
// interval do we pay the much larger cost (~115ms) of rendering a sustain
// voice — a rare, deliberate gesture, not something every note pays for.
const TREMOLO_ESCALATE_MS = 150;
// A held tremolo has no natural end (unlike a quick pluck's fixed decay) —
// it rides on the underlying sustain buffer's full 20s length otherwise,
// which is really just "however long the buffer happens to be," not a
// deliberate limit. Auto-release after a fixed max so an accidentally (or
// deliberately) long hold can't drone on that long — same graceful release
// fade as a normal keyup, just triggered by a timer instead of one.
const TREMOLO_MAX_MS = 6000;
const heldKeys = new Set();
const escalateTimers = {};
const maxDurationTimers = {};
const sustainVoices = {};
const quickVoices = {};

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const key = e.key.toLowerCase();
  const mapped = KEY_TO_NOTE[key];
  if (!mapped || heldKeys.has(key)) return;
  // Several mapped keys (notably '/' for Firefox's quick-find) have
  // browser-default behavior that would otherwise fire alongside the note.
  e.preventDefault();
  heldKeys.add(key);
  ensureAudio();
  // playNote() resolves asynchronously (sample-lookup path awaits a
  // fetch); track its stop handle so a fast tap-and-release can still cut
  // the quick pluck short instead of it always ringing out in full.
  playNote(mapped.string, mapped.fret).then((voice) => {
    if (!voice) return;
    if (heldKeys.has(key)) quickVoices[key] = voice;
    else voice.stop(0.05);
  });

  escalateTimers[key] = setTimeout(() => {
    if (!heldKeys.has(key)) return;
    const midi = STRINGS[mapped.string].base + mapped.fret + octaveShift * OCTAVE_STEP;
    // sample-backed notes don't support the sustain re-injection trick —
    // fine for now since no manifest exists yet, but would need handling
    // if/when real sample recordings are wired in.
    const voice = pluck(midiToFreq(midi), { sustain: true, attack: false });
    sustainVoices[key] = voice;
    maxDurationTimers[key] = setTimeout(() => {
      if (sustainVoices[key] !== voice) return;
      voice.stop();
      delete sustainVoices[key];
    }, TREMOLO_MAX_MS);
  }, TREMOLO_ESCALATE_MS);
});

function releaseKey(key) {
  heldKeys.delete(key);
  clearTimeout(escalateTimers[key]);
  delete escalateTimers[key];
  clearTimeout(maxDurationTimers[key]);
  delete maxDurationTimers[key];
  if (quickVoices[key]) {
    quickVoices[key].stop();
    delete quickVoices[key];
  }
  if (sustainVoices[key]) {
    sustainVoices[key].stop();
    delete sustainVoices[key];
  }
}

window.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  if (KEY_TO_NOTE[key]) e.preventDefault();
  releaseKey(key);
});

// If the window loses focus while a key is held (e.g. alt-tabbing to
// Foundry/Discord mid-session, which is the actual expected usage pattern
// here), the browser never fires keyup for it — the tremolo-sustain voice
// then has nothing to stop it and rings for its full 20s buffer instead of
// the intended ~0.15s release. Force-release everything still held so a
// held note can't outlive the window's focus.
window.addEventListener('blur', () => {
  [...heldKeys].forEach(releaseKey);
});

document.body.addEventListener('click', ensureAudio, { once: true });

render();
renderSongs();
initSamples();
