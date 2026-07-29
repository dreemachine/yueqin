# 月琴 yue-qin

A digital yue-qin (moon lute) web instrument — keyboard-played, synthesized
live in the browser with Karplus-Strong plucked-string synthesis plus a
modeled internal metal-plate rattle, tuned by ear against real reference
recordings.

Live at [yueqin.dreemachine.com](https://yueqin.dreemachine.com).

- **z**–**'** (bottom row) plays the low G3 string, one semitone per key.
- **q**–**]** (top row) plays the high D4 string, one semitone per key.
- Octave up/down shifts both strings by a full octave.
- Song buttons play pre-transcribed melodies on their own.

## Playing live for others

See [`relay/README.md`](relay/README.md) — a small local relay server (run
only during a session, tunneled out with something like ngrok) lets anyone
else with this page open hear every note as it's played, in real time.

## Samples

Pure synthesis by default. Drop real recordings into `samples/` and list
them in `samples/manifest.json` to swap them in note-by-note — see
[`samples/README.md`](samples/README.md).
