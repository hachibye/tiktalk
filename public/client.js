let ws;
let nickname = "";
let typing = false;
let typingTimeout;
let partnerName = "";
let hasSentMessage = false;
let partnerHasSentMessage = false;
let countdownInterval;
let secondsLeft = 300;

const lobby = document.getElementById("lobby");
const chat = document.getElementById("chat");
const status = document.getElementById("status");
const messages = document.getElementById("messages");
const messageInput = document.getElementById("message");
const partnerDisplay = document.getElementById("partner-name");
const typingIndicator = document.getElementById("typing-indicator");
const countdownDisplay = document.getElementById("countdown");

function startChat() {
  nickname = document.getElementById("nickname").value.trim();
  if (!nickname) {
    status.textContent = "請先輸入暱稱";
    return;
  }

  const protocol = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${protocol}://${location.host}`);

  ws.onopen = () => {
    ws.send("start:" + nickname);
    status.textContent = "建立連線中...";
  };

  ws.onmessage = (event) => {
    const data = event.data;

    if (data.startsWith("{")) {
      const msg = JSON.parse(data);

      if (msg.type === "matched") {
        partnerName = msg.partner;
        partnerDisplay.textContent = partnerName;
        status.textContent = "";
        lobby.classList.add("hidden");
        chat.classList.remove("hidden");

        resetChatState();
        startCountdown();
      }

      if (msg.type === "message") {
        addMessage(msg.message, msg.nickname !== nickname ? "partner" : "self", msg.nickname);

        if (msg.nickname === nickname) {
          hasSentMessage = true;
        } else {
          partnerHasSentMessage = true;
        }

        if (hasSentMessage && partnerHasSentMessage) {
          stopCountdown();
        }
      }

      if (msg.type === "typing" && msg.nickname !== nickname) {
        typingIndicator.textContent = `${msg.nickname} 正在輸入...`;
      }

      if (msg.type === "stopTyping" && msg.nickname !== nickname) {
        typingIndicator.textContent = "";
      }

      if (msg.type === "status") {
        status.textContent = msg.message;
      }

      if (msg.type === "reload") {
        setTimeout(() => location.reload(), 3000);
      }
    }
  };

  ws.onclose = () => {
    status.textContent = "連線已關閉";
  };
}

function addMessage(text, sender, senderName) {
  const div = document.createElement("div");
  const now = new Date();
  const timestamp = now.toLocaleTimeString("zh-TW", { hour: '2-digit', minute: '2-digit' });

  div.className = `px-3 py-2 rounded max-w-[80%] text-sm ${
    sender === "self" ? "self-end bg-blue-200" : "self-start bg-green-200"
  }`;
  div.innerHTML = `<span class="block font-semibold">${senderName}</span>
                   <span>${text}</span>
                   <span class="block text-xs text-gray-500 text-right mt-1">${timestamp}</span>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;

  ws.send(JSON.stringify({ type: "message", message: text, nickname }));
  messageInput.value = "";
  stopTyping();
}

function leaveChat() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify("leave"));
    ws.close();
  }
  location.reload();
}

messageInput.addEventListener("input", () => {
  if (!typing && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "typing", nickname }));
    typing = true;
  }

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    stopTyping();
  }, 1500);
});

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function stopTyping() {
  if (typing && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "stopTyping", nickname }));
    typing = false;
  }
}

function startCountdown() {
  secondsLeft = 300;
  countdownDisplay.textContent = formatTime(secondsLeft);
  countdownInterval = setInterval(() => {
    secondsLeft--;
    if (secondsLeft <= 0) {
      clearInterval(countdownInterval);
      status.textContent = "聊天時間已結束，請重新整理。";
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify("leave"));
      }
      setTimeout(() => location.reload(), 3000);
    } else {
      countdownDisplay.textContent = formatTime(secondsLeft);
    }
  }, 1000);
}

function stopCountdown() {
  clearInterval(countdownInterval);
  countdownDisplay.textContent = "";
}

function formatTime(seconds) {
  const m = String(Math.floor(seconds / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${m}:${s}`;
}

function resetChatState() {
  hasSentMessage = false;
  partnerHasSentMessage = false;
}
