// Minimal fan-out relay for the yue-qin "live" feature: every message a
// connected client sends gets forwarded to every OTHER connected client,
// verbatim, no parsing or state kept. The actual note logic (what a
// message means, how to replay it) lives entirely in app.js on both ends —
// this is just a dumb pipe so multiple browser tabs can hear the same
// performance in real time.
//
// Meant to run only while actually playing (e.g. during a D&D session),
// not as an always-on service — start it, tunnel it out (ngrok or
// similar), share the resulting wss:// URL, stop it when done.
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8765;
const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  // ws always hands the callback a Buffer regardless of the original frame
  // type — forwarding it bare defaults to a binary frame, which browsers
  // deliver as a Blob instead of the JSON string app.js expects. Passing
  // the original isBinary flag through keeps our text frames as text.
  ws.on('message', (data, isBinary) => {
    for (const client of wss.clients) {
      if (client !== ws && client.readyState === client.OPEN) {
        client.send(data, { binary: isBinary });
      }
    }
  });
});

console.log(`yue-qin relay listening on ws://localhost:${PORT}`);
