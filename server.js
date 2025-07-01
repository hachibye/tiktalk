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

wss.on("connection", (ws, req) => {
  const ip = req.socket.remoteAddress;
  ws.ip = ip;

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    if (msg.type === "join") {
      ws.meta = {
        nickname: msg.nickname || "匿名",
        selfType: msg.selfType,
        targetTypes: msg.targetTypes || []
      };

      // 移除舊身份殘留
      if (ws.meta.selfType && pool[ws.meta.selfType]) {
        pool[ws.meta.selfType] = pool[ws.meta.selfType].filter((u) => u !== ws);
      }

const match = findMatch(ws);
if (!match || !match.meta) {
  pool[ws.meta.selfType].push(ws);
  ws.send(JSON.stringify({ message: "尚未配對成功，請稍候..." }));
  return;
}

// ✅ 雙方確認後才送 matched
ws.send(JSON.stringify({ type: "matched", partner: match.meta.nickname }));
match.send(JSON.stringify({ type: "matched", partner: ws.meta.nickname }));

      // ✅ 雙方確認後才配對
      ws.send(JSON.stringify({ type: "matched", partner: match.meta.nickname }));
      match.send(JSON.stringify({ type: "matched", partner: ws.meta.nickname }));
    }

    if (msg.type === "message") {
      const payload = JSON.stringify({
        type: "message",
        message: msg.message,
        nickname: msg.nickname
      });

      wss.clients.forEach(client => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      });
    }

    if (msg.type === "typing" || msg.type === "stopTyping") {
      const payload = JSON.stringify({ type: msg.type, nickname: msg.nickname });
      wss.clients.forEach(client => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      });
    }

    if (msg === "leave") {
      ws.close();
    }
  });

  ws.on("close", () => {
    if (ws.meta?.selfType) {
      pool[ws.meta.selfType] = pool[ws.meta.selfType].filter((u) => u !== ws);
    }

    wss.clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: "status",
          message: "對方已離開聊天室。"
        }));
      }
    });
  });
});

function findMatch(ws) {
  for (const target of ws.meta.targetTypes) {
    const candidates = pool[target];
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];

      if (candidate.readyState !== WebSocket.OPEN) {
        candidates.splice(i, 1);
        i--;
        continue;
      }

      if (candidate.meta?.targetTypes.includes(ws.meta.selfType)) {
        candidates.splice(i, 1);
        return candidate;
      }
    }
  }
  return null;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`伺服器已啟動：http://localhost:${PORT}`);
});
