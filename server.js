const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const STATIC_DIR = path.join(__dirname, "public");
const MAX_SESSIONS_PER_IP = 2;
const INACTIVE_WAITING_MINUTES = 10;
const PARTNER_LEFT_MINUTES = 1;

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const serveStatic = (req, res) => {
  let reqPath = req.url === "/" ? "/index.html" : req.url;
  // 防止目錄穿越
  const safePath = path.normalize(reqPath).replace(/^\/+/, "");
  const filePath = path.join(STATIC_DIR, safePath);
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
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
const wss = new WebSocket.Server({ server });

const pool = { T: [], P: [], H: [] };
const ipSessions = new Map(); // { ip: Set<ws> }

function broadcastWaitingCounts() {
  const counts = {
    T: pool.T.length,
    P: pool.P.length,
    H: pool.H.length
  };
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && !client.matched) {
      client.send(JSON.stringify({ type: "waiting", counts }));
    }
  });
}

wss.on("connection", (ws, req) => {
  const ip = req.socket.remoteAddress;
  if (!ipSessions.has(ip)) ipSessions.set(ip, new Set());
  const sessionSet = ipSessions.get(ip);
  if (sessionSet.size >= MAX_SESSIONS_PER_IP) {
    ws.close();
    return;
  }
  sessionSet.add(ws);
  ws.lastActive = Date.now();
  ws.on("close", () => {
    cleanup(ws);
    sessionSet.delete(ws);
    if (sessionSet.size === 0) ipSessions.delete(ip);
  });
  ws.on("message", (message) => {
    ws.lastActive = Date.now();
    let data;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }
    if (data.type === "join") {
      ws.nickname = escapeHTML(data.nickname);
      ws.selfType = data.selfType;
      ws.targetTypes = data.targetTypes;
      ws.matched = false;
      const match = findMatch(ws);
      if (match) {
        ws.matched = match.matched = true;
        ws.partner = match;
        match.partner = ws;
        ws.send(JSON.stringify({ type: "matched", partner: match.nickname }));
        match.send(JSON.stringify({ type: "matched", partner: ws.nickname }));
      } else {
        pool[ws.selfType].push(ws);
        // pool 內 ws 監聽 close，避免 zombie
        ws.once("close", () => {
          const idx = pool[ws.selfType].indexOf(ws);
          if (idx !== -1) pool[ws.selfType].splice(idx, 1);
          broadcastWaitingCounts();
        });
        broadcastWaitingCounts();
      }
    }
    if (data.type === "message" && ws.matched && ws.partner) {
      const safeText = escapeHTML(data.text);
      if (ws.partner.readyState === WebSocket.OPEN) {
        ws.partner.send(JSON.stringify({ type: "message", nickname: ws.nickname, text: safeText }));
      }
    }
    if (data.type === "leave") {
      cleanup(ws);
    }
  });
});

function findMatch(ws) {
  for (const type of ws.targetTypes) {
    const candidates = pool[type];
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      if (candidate.targetTypes.includes(ws.selfType)) {
        candidates.splice(i, 1);
        return candidate;
      }
    }
  }
  return null;
}

function cleanup(ws) {
  if (ws.matched && ws.partner) {
    if (ws.partner.readyState === WebSocket.OPEN) {
      ws.partner.send(JSON.stringify({ type: "partner-left" }));
      ws.partner.partnerLeftAt = Date.now();
      ws.partner.matched = false;
      ws.partner.partner = null;
    }
    ws.matched = false;
    ws.partner = null;
  } else if (ws.selfType && pool[ws.selfType]) {
    const index = pool[ws.selfType].indexOf(ws);
    if (index !== -1) pool[ws.selfType].splice(index, 1);
    broadcastWaitingCounts();
  }
}

server.listen(3000, () => {
  console.log("Server listening on http://localhost:3000");
});

// 定期清理長時間未互動的 session
setInterval(() => {
  const now = Date.now();
  wss.clients.forEach((ws) => {
    if (!ws.matched && ws.lastActive && now - ws.lastActive > INACTIVE_WAITING_MINUTES * 60 * 1000) {
      console.log(`⏱ ${INACTIVE_WAITING_MINUTES} 分鐘未互動，自動清除等待連線`);
      ws.terminate();
    } else if (ws.partnerLeftAt && now - ws.partnerLeftAt > PARTNER_LEFT_MINUTES * 60 * 1000) {
      console.log(`⏱ 對方離開後已超過 ${PARTNER_LEFT_MINUTES} 分鐘，自動離開聊天室`);
      ws.terminate();
    }
  });
}, 60 * 1000);
