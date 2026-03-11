const state = {
  socket: null,
  connected: false,
  room: null,
  playerId: null,
  joystick: { active: false, x: 0, y: 0 },
  renderPlayers: new Map(),
  lastFrameAt: performance.now()
};

const menuPanel = document.getElementById("menu-panel");
const lobbyPanel = document.getElementById("lobby-panel");
const gamePanel = document.getElementById("game-panel");
const playerNameInput = document.getElementById("player-name");
const roomCodeInput = document.getElementById("room-code");
const createRoomButton = document.getElementById("create-room");
const joinRoomButton = document.getElementById("join-room");
const copyRoomButton = document.getElementById("copy-room");
const readyButton = document.getElementById("ready-button");
const rematchButton = document.getElementById("rematch-button");
const roomTitle = document.getElementById("room-title");
const playerCards = document.getElementById("player-cards");
const lobbyStatus = document.getElementById("lobby-status");
const phaseLabel = document.getElementById("phase-label");
const timerLabel = document.getElementById("timer-label");
const resultLabel = document.getElementById("result-label");
const gameStatus = document.getElementById("game-status");
const toast = document.getElementById("toast");
const canvas = document.getElementById("arena-canvas");
const ctx = canvas.getContext("2d");
const joystickZone = document.getElementById("joystick-zone");
const joystickBase = document.querySelector(".joystick-base");
const joystickKnob = document.getElementById("joystick-knob");

const ARENA_RADIUS = 180;
const PLAYER_RADIUS = 18;
const COLORS = ["#4fc3ff", "#ff7d4d"];

function setToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(setToast.timeout);
  setToast.timeout = setTimeout(() => toast.classList.add("hidden"), 2200);
}

function connectSocket() {
  if (state.socket && (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING)) {
    return state.socket;
  }

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}/ws`);

  socket.addEventListener("open", () => {
    state.connected = true;
  });

  socket.addEventListener("close", () => {
    state.connected = false;
    if (state.room) {
      setToast("Connection lost.");
    }
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    handleServerMessage(message.type, message.payload);
  });

  state.socket = socket;
  return socket;
}

function send(type, payload = {}) {
  const socket = connectSocket();

  if (socket.readyState !== WebSocket.OPEN) {
    socket.addEventListener(
      "open",
      () => {
        socket.send(JSON.stringify({ type, payload }));
      },
      { once: true }
    );
    return;
  }

  socket.send(JSON.stringify({ type, payload }));
}

function showPanel(target) {
  menuPanel.classList.toggle("hidden", target !== "menu");
  lobbyPanel.classList.toggle("hidden", target !== "lobby");
  gamePanel.classList.toggle("hidden", target !== "game");
}

function renderLobbyPlayers(players) {
  playerCards.innerHTML = "";

  for (const player of players) {
    const card = document.createElement("article");
    card.className = "player-card";
    const isSelf = player.id === state.playerId;
    card.innerHTML = `
      <div class="player-meta">
        <div class="avatar ${player.slot === 0 ? "one" : "two"}"></div>
        <div>
          <strong>${player.name}${isSelf ? " (You)" : ""}</strong>
          <div class="hint">Player ${player.slot + 1}</div>
        </div>
      </div>
      <span class="player-tag ${player.ready ? "ready" : ""}">
        ${player.ready ? "Ready" : player.connected ? "Waiting" : "Offline"}
      </span>
    `;
    playerCards.append(card);
  }
}

function describeWinner(room) {
  if (room.phase !== "finished") {
    return "Fight";
  }

  if (!room.winnerId) {
    return "Draw";
  }

  return room.winnerId === state.playerId ? "You win" : "You lose";
}

function describeStatus(room) {
  if (!room) {
    return "";
  }

  if (room.phase === "lobby") {
    if (room.players.length < 2) {
      return "상대 플레이어를 기다리는 중입니다.";
    }

    return "두 플레이어가 준비되면 카운트다운이 시작됩니다.";
  }

  if (room.phase === "countdown") {
    return "곧 시작합니다. 조이스틱을 준비하세요.";
  }

  if (room.phase === "playing") {
    return "상대를 경기장 밖으로 밀어내세요.";
  }

  if (room.winReason === "ring_out") {
    return "경기장 밖으로 밀려난 플레이어가 패배했습니다.";
  }

  if (room.winReason === "center_control") {
    return "시간 종료. 중심에 더 가까운 쪽이 승리했습니다.";
  }

  if (room.winReason === "player_left") {
    return "상대가 나가서 라운드가 종료되었습니다.";
  }

  return "재대결 또는 준비를 눌러 다시 시작하세요.";
}

function updateRoom(room) {
  state.room = room;
  roomTitle.textContent = room.roomId;
  renderLobbyPlayers(room.players);
  lobbyStatus.textContent = describeStatus(room);
  gameStatus.textContent = describeStatus(room);
  phaseLabel.textContent = room.phase.toUpperCase();
  timerLabel.textContent = `${Math.max(0, room.remainingMs / 1000).toFixed(1)}s`;
  resultLabel.textContent = describeWinner(room);

  readyButton.textContent = room.players.find((player) => player.id === state.playerId)?.ready ? "Ready on" : "Ready";
  rematchButton.classList.toggle("hidden", room.phase !== "finished");

  if (room.players.length > 0) {
    showPanel(room.phase === "playing" || room.phase === "countdown" ? "game" : "lobby");
  }

  for (const player of room.players) {
    const renderState = state.renderPlayers.get(player.id) || { x: player.state.x, y: player.state.y };
    renderState.targetX = player.state.x;
    renderState.targetY = player.state.y;
    renderState.alive = player.state.alive;
    renderState.slot = player.slot;
    renderState.name = player.name;
    state.renderPlayers.set(player.id, renderState);
  }
}

function handleServerMessage(type, payload) {
  if (type === "joined_room") {
    state.playerId = payload.playerId;
    roomCodeInput.value = payload.roomId;
    showPanel("lobby");
    setToast(`Joined room ${payload.roomId}`);
    return;
  }

  if (type === "state_update" || type === "round_end") {
    updateRoom(payload);
    return;
  }

  if (type === "error") {
    setToast(payload.message);
  }
}

function getSelfPlayer() {
  return state.room?.players.find((player) => player.id === state.playerId) || null;
}

function updateJoystick(x, y) {
  state.joystick.x = x;
  state.joystick.y = y;
  const baseRect = joystickBase.getBoundingClientRect();
  const knobRect = joystickKnob.getBoundingClientRect();
  const knobRange = Math.max(0, baseRect.width / 2 - knobRect.width / 2 - 4);
  joystickKnob.style.transform = `translate(calc(-50% + ${x * knobRange}px), calc(-50% + ${y * knobRange}px))`;
  send("input_move", { x, y });
}

function resetJoystick() {
  state.joystick.active = false;
  updateJoystick(0, 0);
}

function handleJoystickPointer(clientX, clientY) {
  const rect = joystickBase.getBoundingClientRect();
  const baseCenterX = rect.left + rect.width / 2;
  const baseCenterY = rect.top + rect.height / 2;
  const dx = clientX - baseCenterX;
  const dy = clientY - baseCenterY;
  const maxDistance = Math.max(1, rect.width / 2 - joystickKnob.getBoundingClientRect().width / 2 - 4);
  const distance = Math.min(maxDistance, Math.hypot(dx, dy));
  const angle = Math.atan2(dy, dx);
  const x = distance ? (Math.cos(angle) * distance) / maxDistance : 0;
  const y = distance ? (Math.sin(angle) * distance) / maxDistance : 0;
  updateJoystick(x, y);
}

joystickZone.addEventListener("pointerdown", (event) => {
  state.joystick.active = true;
  joystickZone.setPointerCapture(event.pointerId);
  handleJoystickPointer(event.clientX, event.clientY);
});

joystickZone.addEventListener("pointermove", (event) => {
  if (!state.joystick.active) {
    return;
  }

  handleJoystickPointer(event.clientX, event.clientY);
});

joystickZone.addEventListener("pointerup", resetJoystick);
joystickZone.addEventListener("pointercancel", resetJoystick);

createRoomButton.addEventListener("click", () => {
  send("create_room", { name: playerNameInput.value.trim() || "Player 1" });
});

joinRoomButton.addEventListener("click", () => {
  send("join_room", {
    roomId: roomCodeInput.value.trim().toUpperCase(),
    name: playerNameInput.value.trim() || "Player 2"
  });
});

copyRoomButton.addEventListener("click", async () => {
  if (!state.room) {
    return;
  }

  try {
    await navigator.clipboard.writeText(state.room.roomId);
    setToast("Room code copied.");
  } catch {
    setToast("Clipboard access failed.");
  }
});

readyButton.addEventListener("click", () => {
  const player = getSelfPlayer();
  send("player_ready", { ready: !player?.ready });
});

rematchButton.addEventListener("click", () => {
  send("rematch_request");
});

function worldToCanvas(value) {
  return canvas.width / 2 + value;
}

function drawArena() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);

  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.beginPath();
  ctx.arc(0, 0, ARENA_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(0, 0, ARENA_RADIUS, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,210,95,0.12)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 80, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawPlayers(deltaMs) {
  if (!state.room) {
    return;
  }

  const lerpFactor = Math.min(1, deltaMs / 40);
  for (const player of state.room.players) {
    const renderState = state.renderPlayers.get(player.id);
    if (!renderState) {
      continue;
    }

    renderState.x += (renderState.targetX - renderState.x) * lerpFactor;
    renderState.y += (renderState.targetY - renderState.y) * lerpFactor;

    const x = worldToCanvas(renderState.x);
    const y = worldToCanvas(renderState.y);
    ctx.globalAlpha = renderState.alive ? 1 : 0.35;
    ctx.fillStyle = COLORS[renderState.slot] || "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    if (player.id === state.playerId) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, PLAYER_RADIUS + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.globalAlpha = 1;
}

function animate(now) {
  const deltaMs = now - state.lastFrameAt;
  state.lastFrameAt = now;

  drawArena();
  drawPlayers(deltaMs);
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
showPanel("menu");
