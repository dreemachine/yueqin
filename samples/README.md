# Samples

Drop real yue-qin note recordings here to replace the synthesized pluck, per note.

1. Name each file however you like (e.g. `low-open.mp3`, `high-fret3.wav`).
2. List them in `manifest.json` in this folder, keyed by string (`low`/`high`) and fret number (`0`-`11`):

```json
{
  "low": { "0": "low-open.mp3", "3": "low-fret3.mp3" },
  "high": { "0": "high-open.mp3" }
}
```

3. Any note you don't list (or don't have a recording for) falls back to the synthesized pluck automatically — partial coverage is fine.

String/fret reference (fret = semitones above the open string):

- `low` course, open = G3
- `high` course, open = D4

No manifest.json = no samples loaded, pure synthesis, and that's the current default (there's no manifest.json in this folder yet).
