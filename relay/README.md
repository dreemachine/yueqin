# yue-qin live relay

A tiny WebSocket fan-out server: every "note played" message a connected
browser tab sends gets forwarded to every other connected tab. That's it —
no accounts, no persistence, no note logic (that all lives in `app.js` on
both ends). Meant to run only while you're actually playing, not as an
always-on service.

## Run it (during a session)

```
cd relay
npm install     # first time only
npm start
```

This starts the relay on `ws://localhost:8765`.

## Expose it to the internet for that session

The relay is only reachable on your own machine until you tunnel it out.
[ngrok](https://ngrok.com) is the simplest option — free tier includes one
reserved static domain, so the URL stays the same across restarts instead
of changing every time:

1. Sign up at ngrok.com (free), install the CLI, `ngrok config add-authtoken <your token>`.
2. Reserve a static domain once, in the ngrok dashboard (Domains → Create Domain) — e.g. `dree-yueqin.ngrok-free.app`.
3. Each session, after starting the relay above, run:
   ```
   ngrok http 8765 --domain=dree-yueqin.ngrok-free.app
   ```
4. On the yue-qin page (yueqin.dreemachine.com), paste `wss://dree-yueqin.ngrok-free.app`
   into the "relay url" field and hit connect. Do the same on your own tab
   (the performer's tab also connects, so it can send — everyone, including
   you, should be connected).
5. When the session's over, stop ngrok and the relay (Ctrl+C both). Nothing
   is left running or reachable until you start it again next time.

## How it works

Every pluck (manual key press or a song button) sends a small JSON message
— `{senderId, string, fret, octaveShift}` — to the relay, which echoes it
to everyone else. Each receiving tab replays it through its own copy of the
same `pluck()` synthesis, so it sounds like the same instrument, not a
streamed recording. Held tremolo-sustain notes aren't broadcast yet (only
quick plucks and song playback) — a possible follow-up if it's missed.
