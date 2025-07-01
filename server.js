const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

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
  if (sessionSet.size >= 2) {
    ws.close();
    return;
  }
  sessionSet.add(ws);

  ws.lastActive = Date.now();

  ws.on("message", (message) => {
    ws.lastActive = Date.now();

    const data = JSON.parse(message);

    if (data.type === "join") {
      ws.nickname = data.nickname;
      ws.selfType = data.selfType;
      ws.targetTypes = data.targetTypes;
      ws.matched = false;

      const match = findMatch(ws);
      if (match) {
        ws.matched = match.matched = true;
        ws.partner = match.nickname;
        match.partner = ws.nickname;

        ws.send(JSON.stringify({ type: "matched", partner: match.nickname }));
        match.send(JSON.stringify({ type: "matched", partner: ws.nickname }));
      } else {
        pool[ws.selfType].push(ws);
        broadcastWaitingCounts();
      }
    }

    if (data.type === "message" && ws.matched && ws.partner) {
      wss.clients.forEach(client => {
        if (client.nickname === ws.partner && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: "message", nickname: ws.nickname, text: data.text }));
        }
      });
    }

    if (data.type === "leave") {
      cleanup(ws);
    }
  });

  ws.on("close", () => {
    cleanup(ws);
    sessionSet.delete(ws);
    if (sessionSet.size === 0) ipSessions.delete(ip);
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
    wss.clients.forEach(client => {
      if (client.nickname === ws.partner && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "partner-left" }));
        client.partnerLeftAt = Date.now();
        client.matched = false;
        delete client.partner;
      }
    });
  } else {
    const index = pool[ws.selfType]?.indexOf(ws);
    if (index !== -1) pool[ws.selfType].splice(index, 1);
    broadcastWaitingCounts();
  }
}

server.listen(3000, () => {
  console.log("Server listening on http://localhost:3000");
});

setInterval(() => {
  const now = Date.now();
  wss.clients.forEach((ws) => {
    // 超過 10 分鐘未配對自動關閉
    if (!ws.matched && ws.lastActive && now - ws.lastActive > 10 * 60 * 1000) {
      console.log("⏱ 10 分鐘未互動，自動清除等待連線");
      ws.terminate();
    }
    // 對方離開後 1 分鐘未互動也自動踢除
    else if (ws.partnerLeftAt && now - ws.partnerLeftAt > 60 * 1000) {
      console.log("⏱ 對方離開後已超過 1 分鐘，自動離開聊天室");
      ws.terminate();
    }
  });
}, 60 * 1000);
