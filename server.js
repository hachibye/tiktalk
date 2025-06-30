const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    const file = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(file);
  } else if (req.url === "/client.js") {
    res.writeHead(200, { "Content-Type": "application/javascript" });
    res.end(fs.readFileSync(path.join(__dirname, "public", "client.js"), "utf8"));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocket.Server({ server });

let waiting = [];
const pairs = new Map();
const lastActive = new Map();
const ipConnections = new Map();
const ipAttempts = new Map();

function getIP(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress;
}

wss.on("connection", (ws, req) => {
  const ip = getIP(req);

  const now = Date.now();
  ipConnections.set(ip, (ipConnections.get(ip) || 0) + 1);
  ipAttempts.set(ip, (ipAttempts.get(ip) || []).filter(t => now - t < 60000));
  ipAttempts.get(ip).push(now);

  if (ipConnections.get(ip) > 2) {
    ws.close();
    return;
  }

  if (ipAttempts.get(ip).length > 2) {
    ws.send(JSON.stringify({ type: "status", message: "同 IP 每分鐘僅可配對 2 次" }));
    ws.close();
    return;
  }

  ws.hasSent = false;

  ws.on("message", (data) => {
    const str = data.toString();
    if (str.startsWith("start:")) {
      ws.nickname = str.slice(6);
      ws.ip = ip;
      waiting.push(ws);
      tryPair();
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(str);
    } catch {
      return;
    }

    if (parsed.type === "message") {
      const partner = pairs.get(ws);
      if (partner && partner.readyState === WebSocket.OPEN) {
        lastActive.set(ws, Date.now());
        lastActive.set(partner, Date.now());

        partner.send(JSON.stringify({ type: "message", message: parsed.message, nickname: parsed.nickname }));
        ws.send(JSON.stringify({ type: "message", message: parsed.message, nickname: parsed.nickname }));

        ws.hasSent = true;
        partner.hasSent = partner.hasSent || false;

        if (ws.hasSent && partner.hasSent) {
          clearTimeout(ws.inactivityTimer);
          clearTimeout(partner.inactivityTimer);
        }
      }
    } else if (parsed.type === "typing") {
      const partner = pairs.get(ws);
      if (partner?.readyState === WebSocket.OPEN) {
        partner.send(JSON.stringify({ type: "typing", nickname: parsed.nickname }));
      }
    } else if (parsed.type === "stopTyping") {
      const partner = pairs.get(ws);
      if (partner?.readyState === WebSocket.OPEN) {
        partner.send(JSON.stringify({ type: "stopTyping", nickname: parsed.nickname }));
      }
    } else if (parsed === "leave") {
      disconnect(ws);
    }
  });

  ws.on("close", () => {
    ipConnections.set(ip, ipConnections.get(ip) - 1);
    disconnect(ws);
  });
});

function tryPair() {
  if (waiting.length >= 2) {
    const ws1 = waiting.shift();
    const ws2 = waiting.shift();

    if (ws1.readyState !== WebSocket.OPEN || ws2.readyState !== WebSocket.OPEN) return;

    pairs.set(ws1, ws2);
    pairs.set(ws2, ws1);

    ws1.hasSent = false;
    ws2.hasSent = false;

    lastActive.set(ws1, Date.now());
    lastActive.set(ws2, Date.now());

    ws1.send(JSON.stringify({ type: "matched", partner: ws2.nickname }));
    ws2.send(JSON.stringify({ type: "matched", partner: ws1.nickname }));

    const timer = setTimeout(() => checkInactivity(ws1, ws2), 5 * 60 * 1000);
    ws1.inactivityTimer = timer;
    ws2.inactivityTimer = timer;
  }
}

function checkInactivity(ws1, ws2) {
  const now = Date.now();
  const last1 = lastActive.get(ws1) || 0;
  const last2 = lastActive.get(ws2) || 0;
  const timeout = 5 * 60 * 1000;

  if (now - last1 > timeout || now - last2 > timeout) {
    [ws1, ws2].forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "status", message: "連線已中斷，請重新整理。" }));
        ws.send(JSON.stringify({ type: "reload" }));
      }
      pairs.delete(ws);
    });
  }
}

function disconnect(ws) {
  const partner = pairs.get(ws);
  if (partner && partner.readyState === WebSocket.OPEN) {
    partner.send(JSON.stringify({ type: "status", message: "對方已離開聊天室" }));
    partner.send(JSON.stringify({ type: "reload" }));
    pairs.delete(partner);
  }
  clearTimeout(ws.inactivityTimer);
  pairs.delete(ws);
  lastActive.delete(ws);
  waiting = waiting.filter((w) => w !== ws);
}

server.listen(3000, () => {
  console.log("✅ 伺服器啟動： http://localhost:3000");
});
