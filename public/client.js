// 正確版 client.js - 支援配對成功開啟聊天室與等待邏輯（Tailwind 美化 UI）
let socket;
let matched = false;
let partnerName = "";
let countdownTimer;
let countdownSeconds = 300;
let messageSentBySelf = false;
let messageSentByOther = false;

const nicknameInput = document.getElementById("nickname");
const startButton = document.getElementById("start");
const status = document.getElementById("status");
const chat = document.getElementById("chat");
const lobby = document.getElementById("lobby");
const messageBox = document.getElementById("message");
const messages = document.getElementById("messages");
const typingIndicator = document.getElementById("typing-indicator");
const countdown = document.getElementById("countdown");
const partnerNameEl = document.getElementById("partner-name");
const waitingInfo = document.getElementById("waiting-info");

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function showWaitingInfo(counts) {
  waitingInfo.classList.remove("hidden");
  waitingInfo.textContent = `等待配對中：T(${counts.T}) P(${counts.P}) H(${counts.H})`;
}
function hideWaitingInfo() {
  waitingInfo.classList.add("hidden");
}

// 初始化 WebSocket
function initSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const protocol = window.location.protocol === "https:" ? "wss://" : "ws://";
  socket = new WebSocket(protocol + window.location.host);

  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "waiting") {
      showWaitingInfo(data.counts);
    }
  });
  socket.addEventListener("error", () => {
    status.textContent = "WebSocket 連線錯誤，請稍後重試。";
  });
}

initSocket();

function startChat() {
  const nickname = nicknameInput.value.trim();
  if (!nickname) {
    alert("請輸入暱稱");
    return;
  }
  const selfType = document.getElementById("selfType").value;
  const targetTypes = Array.from(document.querySelectorAll(".targetType:checked")).map(
    (el) => el.value
  );
  if (!targetTypes.length) {
    alert("請至少選擇一個想找的對象");
    return;
  }
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "leave" }));
    socket.close();
  }
  // 重新建立 WebSocket
  socket = null;
  initSocket();
  socket.addEventListener("open", () => {
    socket.send(
      JSON.stringify({
        type: "join",
        nickname,
        selfType,
        targetTypes,
      })
    );
  });
  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "matched") {
      matched = true;
      lobby.classList.add("hidden");
      chat.classList.remove("hidden");
      status.textContent = "已成功配對，開始聊天";
      partnerName = data.partner;
      partnerNameEl.textContent = partnerName;
      hideRoleSelection();
      hideWaitingInfo();
      startCountdown();
    }
    if (data.type === "message") {
      appendMessage(data.nickname, data.text);
      messageSentByOther = true;
    }
    if (data.type === "partner-left") {
      appendMessage("系統", "對方已離開聊天室。", "system");
      messageBox.disabled = true;
    }
    if (data.type === "waiting") {
      showWaitingInfo(data.counts);
    }
  });
  socket.addEventListener("close", () => {
    stopCountdown();
    if (matched) {
      appendMessage("系統", "連線中斷，將返回首頁。", "system");
      setTimeout(() => {
        chat.classList.add("hidden");
        lobby.classList.remove("hidden");
        messageBox.disabled = false;
        matched = false;
        messages.innerHTML = "";
        countdown.textContent = "05:00";
        messageSentBySelf = false;
        messageSentByOther = false;
        resetRoleInputs();
        showWaitingInfo({ T: 0, P: 0, H: 0 });
      }, 1500);
    } else {
      status.textContent = "連線已中斷，請重新開始。";
    }
  });
  socket.addEventListener("error", () => {
    status.textContent = "WebSocket 連線錯誤，請稍後重試。";
  });
}

function sendMessage() {
  const text = messageBox.value.trim();
  if (!text || !socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "message", text }));
  appendMessage("你", text, "self");
  messageBox.value = "";
  messageSentBySelf = true;
}

function appendMessage(sender, text, type = "partner") {
  const msg = document.createElement("div");
  let bubbleClass = "rounded-xl px-4 py-2 max-w-[70%] text-sm mb-2 ";
  if (type === "self") {
    bubbleClass += "bg-green-100 text-right self-end ml-auto";
  } else if (type === "system") {
    bubbleClass += "bg-gray-200 text-center italic text-gray-600 mx-auto";
  } else {
    bubbleClass += "bg-white border border-gray-300 text-left self-start";
  }
  msg.className = bubbleClass;
  msg.innerHTML = `<span class='font-semibold mr-1'>${escapeHTML(sender)}：</span><span>${escapeHTML(text)}</span>`;
  messages.appendChild(msg);
  messages.scrollTop = messages.scrollHeight;
}

function startCountdown() {
  countdownSeconds = 300;
  updateCountdownDisplay();
  countdownTimer = setInterval(() => {
    countdownSeconds--;
    updateCountdownDisplay();
    if (countdownSeconds <= 0 && (!messageSentBySelf || !messageSentByOther)) {
      appendMessage("系統", "閒置時間過久，自動離開聊天室。", "system");
      socket.close();
      clearInterval(countdownTimer);
      chat.classList.add("hidden");
      lobby.classList.remove("hidden");
      resetRoleInputs();
    }
  }, 1000);
}

function updateCountdownDisplay() {
  const minutes = Math.floor(countdownSeconds / 60).toString().padStart(2, "0");
  const seconds = (countdownSeconds % 60).toString().padStart(2, "0");
  countdown.textContent = `${minutes}:${seconds}`;
  if (messageSentBySelf && messageSentByOther) {
    clearInterval(countdownTimer);
  }
}

function stopCountdown() {
  clearInterval(countdownTimer);
}

function leaveChat() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "leave" }));
    socket.close();
  }
  chat.classList.add("hidden");
  lobby.classList.remove("hidden");
  messageBox.disabled = false;
  matched = false;
  messages.innerHTML = "";
  countdown.textContent = "05:00";
  messageSentBySelf = false;
  messageSentByOther = false;
  resetRoleInputs();
  waitingInfo.classList.remove("hidden");
}

function hideRoleSelection() {
  const identityBox = document.getElementById("identity-box");
  const preferenceBox = document.getElementById("preference-box");
  if (identityBox) identityBox.style.display = "none";
  if (preferenceBox) preferenceBox.style.display = "none";
}

function resetRoleInputs() {
  const identityBox = document.getElementById("identity-box");
  const preferenceBox = document.getElementById("preference-box");
  if (identityBox) identityBox.style.display = "block";
  if (preferenceBox) preferenceBox.style.display = "block";
}

messageBox?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});