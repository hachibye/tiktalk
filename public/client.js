let ws;
let nickname = "";
let typing = false;
let typingTimeout;
let partnerName = "";
let timerInterval;

const lobby = document.getElementById("lobby");
const chat = document.getElementById("chat");
const status = document.getElementById("status");
const messages = document.getElementById("messages");
const messageInput = document.getElementById("message");
const partnerDisplay = document.getElementById("partner-name");
const typingIndicator = document.getElementById("typing-indicator");
const countdown = document.getElementById("countdown");

let hasSentMessage = false;
let countdownTime = 5 * 60; // 5 minutes in seconds

function startChat() {
  nickname = document.getElementById("nickname").value.trim();
  if (!nickname) {
    status.textContent = "請先輸入暱稱";
    return;
  }

  ws = new WebSocket(`ws://${location.host}`);
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
        startCountdown();
      }

      if (msg.type === "message") {
        const sender = msg.nickname === nickname ? "self" : "partner";
        addMessage(msg.message, sender, msg.nickname);

        if (msg.nickname !== nickname) {
          // 對方發過訊息了，取消倒數需要雙方都有發言
          hasSentMessage = true;
          if (window.partnerSentMessage) {
            stopCountdown();
          } else {
            window.partnerSentMessage = true;
          }
        } else {
          // 我發過訊息了
          hasSentMessage = true;
          if (window.partnerSentMessage) {
            stopCountdown();
          }
        }
      }

      if (msg.type === "typing") {
        if (msg.nickname !== nickname) {
          typingIndicator.textContent = `${msg.nickname} 正在輸入...`;
        }
      }

      if (msg.type === "stopTyping") {
        if (msg.nickname !== nickname) {
          typingIndicator.textContent = "";
        }
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

  hasSentMessage = true;
  if (window.partnerSentMessage) {
    stopCountdown();
  }
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
  countdownTime = 5 * 60;
  countdown.classList.remove("hidden");
  updateCountdown();
  timerInterval = setInterval(() => {
    countdownTime--;
    updateCountdown();

    if (countdownTime <= 0) {
      clearInterval(timerInterval);
      status.textContent = "連線已中斷，請重新整理。";
      leaveChat();
    }
  }, 1000);
}

function stopCountdown() {
  clearInterval(timerInterval);
  countdown.classList.add("hidden");
}

function updateCountdown() {
  const min = Math.floor(countdownTime / 60);
  const sec = countdownTime % 60;
  countdown.textContent = `剩餘時間：${min}:${sec < 10 ? "0" : ""}${sec}`;
}
