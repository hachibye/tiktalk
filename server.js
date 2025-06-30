const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

// 靜態檔案服務處理
const serveStatic = (req, res) => {
  const filePath = path.join(__dirname, "public", req.url === "/" ? "index.html" : req.url.slice(1));
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not Found");
    }

    const ext = path.extname(filePath);
    const mime = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css"
    }[ext] || "text/plain";

    res.writeHead(200, { "Content-Type": mime });
    res.end(data);
  });
};

const server = http.createServer(serveStatic);

// WebSocket 設定
const wss = new WebSocket.Server({ server });

let waiting = [];
const pairs = new Map();
const lastActive = new Map();
const messageFlags = new Map(); // 紀錄每一對雙方是否都有發言

wss.on("connection", (ws, req) => {
  const ip = req.socket.remoteAddress;
  ws.ip = ip;

  ws.on("message", (data) => {
    const str = data.toString();

    if (str.startsWith("start:")) {
      ws.nickname = str.slice(6);
      if (!ws.nickname) return;
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

        const pairKey = getPairKey(ws, partner);
        const prev = messageFlags.get(pairKey) || {};
        messageFlags.set(pairKey, {
          [ws.nickname]: true,
          [partner.nickname]: prev[partner.nickname] || false
        });

        ws.send(JSON.stringify({ type: "message", message: parsed.message, nickname: parsed.nickname }));
        partner.send(JSON.stringify({ type: "message", message: parsed.message, nickname: parsed.nickname }));

        const flags = messageFlags.get(pairKey);
        if (flags[ws.nickname] && flags[partner.nickname]) {
          clearTimeout(ws.inactivityTimer);
          clearTimeout(partner.inactivityTimer);
        }
      }
    } else if (parsed.type === "typing") {
      const partner = pairs.get(ws);
      if (partner && partner.readyState === WebSocket.OPEN) {
        partner.send(JSON.stringify({ type: "typing", nickname: parsed.nickname }));
      }
    } else if (parsed.type === "stopTyping") {
      const partner = pairs.get(ws);
      if (partner && partner.readyState === WebSocket.OPEN) {
        partner.send(JSON.stringify({ type: "stopTyping", nickname: parsed.nickname }));
      }
    } else if (parsed === "leave") {
      disconnect(ws);
    }
  });

  ws.on("close", () => disconnect(ws));
});

function tryPair() {
  if (waiting.length >= 2) {
    const ws1 = waiting.shift();
    const ws2 = waiting.shift();
    if (ws1.readyState !== WebSocket.OPEN || ws2.readyState !== WebSocket.OPEN) return;

    pairs.set(ws1, ws2);
    pairs.set(ws2, ws1);
    lastActive.set(ws1, Date.now());
    lastActive.set(ws2, Date.now());

    const pairKey = getPairKey(ws1, ws2);
    messageFlags.set(pairKey, {
      [ws1.nickname]: false,
      [ws2.nickname]: false
    });

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
  const fiveMinutes = 5 * 60 * 1000;

  if (now - last1 > fiveMinutes || now - last2 > fiveMinutes) {
    if (ws1.readyState === WebSocket.OPEN) {
      ws1.send(JSON.stringify({ type: "status", message: "連線已中斷，請重新整理。" }));
      ws1.send(JSON.stringify({ type: "reload" }));
    }
    if (ws2.readyState === WebSocket.OPEN) {
      ws2.send(JSON.stringify({ type: "status", message: "連線已中斷，請重新整理。" }));
      ws2.send(JSON.stringify({ type: "reload" }));
    }
    pairs.delete(ws1);
    pairs.delete(ws2);
    messageFlags.delete(getPairKey(ws1, ws2));
  }
}

function disconnect(ws) {
  const partner = pairs.get(ws);
  if (partner && partner.readyState === WebSocket.OPEN) {
    partner.send(JSON.stringify({ type: "status", message: "對方已離開聊天室" }));
    partner.send(JSON.stringify({ type: "reload" }));
    pairs.delete(partner);
    messageFlags.delete(getPairKey(ws, partner));
  }
  pairs.delete(ws);
  lastActive.delete(ws);
  waiting = waiting.filter(w => w !== ws);
}

function getPairKey(ws1, ws2) {
  const names = [ws1.nickname, ws2.nickname].sort();
  return names.join("_");
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
