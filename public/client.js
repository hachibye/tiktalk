const socket = new WebSocket("ws://" + window.location.host);

const lobby = document.getElementById("lobby");
const chat = document.getElementById("chat");
const nicknameInput = document.getElementById("nickname");
const selfTypeInput = document.getElementById("selfType");
const targetTypeInputs = document.querySelectorAll(".targetType");
const messageInput = document.getElementById("message");
const messages = document.getElementById("messages");
const status = document.getElementById("status");
const countdownDisplay = document.getElementById("countdown");
const typingIndicator = document.getElementById("typing-indicator");

let matched = false;
let countdownTimer;
let countdown = 300;
let retryTimer;
let hasSpoken = false;
let partnerHasSpoken = false;
let typingTimeout;

function sendMessage() {
  const message = messageInput.value.trim();
  if (!message) return;
  socket.send(JSON.stringify({ type: "message", message, nickname: nicknameInput.value }));
  messageInput.value = "";
  appendMessage(nicknameInput.value, message, true);
  hasSpoken = true;
}

function appendMessage(sender, message, isSelf = false) {
  const div = document.createElement("div");
  div.className = isSelf ? "text-right" : "text-left";
  div.innerHTML = `<span class="inline-block bg-${isSelf ? "blue" : "gray"}-200 px-2 py-1 rounded">${sender}：${message}</span>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function leaveChat() {
  socket.send(JSON.stringify({ type: "leave" }));
  clearInterval(countdownTimer);
  status.textContent = "你已離開聊天室。";
  setTimeout(() => {
    window.location.href = "/";
  }, 3000);
}

function startCountdown() {
  clearInterval(countdownTimer);
  countdown = 300;
  countdownTimer = setInterval(() => {
    if (countdown <= 0) {
      clearInterval(countdownTimer);
      leaveChat();
    }
    const min = String(Math.floor(countdown / 60)).padStart(2, "0");
    const sec = String(countdown % 60).padStart(2, "0");
    countdownDisplay.textContent = `${min}:${sec}`;
    countdown--;
  }, 1000);
}

socket.addEventListener("open", () => {
  document.getElementById("start").addEventListener("click", () => {
    // ✅ 修正身份殘留錯誤
    matched = false;
    hasSpoken = false;
    partnerHasSpoken = false;

    const nickname = nicknameInput.value || "匿名";
    const selfType = selfTypeInput.value;
    const targetTypes = Array.from(targetTypeInputs)
      .filter((cb) => cb.checked)
      .map((cb) => cb.value);

    socket.send(JSON.stringify({
      type: "join",
      nickname,
      selfType,
      targetTypes
    }));

    status.textContent = "等待配對中...";
    retryTimer = setTimeout(() => {
      if (!matched) {
        socket.send(JSON.stringify({
          type: "join",
          nickname,
          selfType,
          targetTypes
        }));
        status.textContent = "仍在配對中，已自動重試...";
      }
    }, 10000);
  });
});

socket.addEventListener("message", (event) => {
  try {
    const data = JSON.parse(event.data);

    if (data.type === "matched") {
      if (matched) return; // ✅ 已配對過，不重複進聊天室
      matched = true;

      clearTimeout(retryTimer);
      lobby.classList.add("hidden");
      chat.classList.remove("hidden");

      status.textContent = "已成功配對，開始聊天";
      countdownDisplay.textContent = "⏳ 開始倒數計時...";
      startCountdown();
    }

    if (data.type === "message") {
      if (!partnerHasSpoken) partnerHasSpoken = true;
      if (hasSpoken && partnerHasSpoken) clearInterval(countdownTimer);
      appendMessage(data.nickname, data.message, false);
    }

    if (data.type === "typing") {
      typingIndicator.textContent = `${data.nickname} 輸入中...`;
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        typingIndicator.textContent = "";
      }, 3000);
    }

    if (data.type === "stopTyping") {
      typingIndicator.textContent = "";
    }

    if (data.type === "status") {
      status.textContent = data.message;
    }
  } catch (err) {
    console.error("無法解析訊息：", event.data);
  }
});

messageInput.addEventListener("input", () => {
  socket.send(JSON.stringify({ type: "typing", nickname: nicknameInput.value }));
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.send(JSON.stringify({ type: "stopTyping", nickname: nicknameInput.value }));
  }, 1000);
});

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
