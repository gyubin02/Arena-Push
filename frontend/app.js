const state = {
  socket: null,
  connected: false,
  reconnectTimer: null,
  room: null,
  playerId: null,
  publicRooms: [],
  joystick: { active: false, x: 0, y: 0, pointerId: null },
  push: { activeUntil: 0, cooldownUntil: 0, directionX: 1, directionY: 0 },
  renderPlayers: new Map(),
  scrollLocked: false,
  scrollLockY: 0,
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
const refreshRoomsButton = document.getElementById("refresh-rooms");
const pushButton = document.getElementById("push-button");
const pushMeta = document.getElementById("push-meta");
const publicRoomsElement = document.getElementById("public-rooms");
const roomsStatus = document.getElementById("rooms-status");
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
const joystickBase = document.getElementById("joystick-zone");
const joystickKnob = document.getElementById("joystick-knob");

const ARENA_RADIUS = 180;
const PLAYER_RADIUS = 18;
const PLAYER_SPEED = 240;
const PUSH_SPEED = 340;
const PUSH_DURATION_MS = 180;
const PUSH_COOLDOWN_MS = 900;
const JOYSTICK_DEADZONE = 0.12;
const SLIME_COLORS = [
  { base: "#7ee6ff", edge: "#2d89ff", label: "#9be9ff", glow: "rgba(76, 196, 255, 0.22)" },
  { base: "#ffb591", edge: "#ff6130", label: "#ffc7ab", glow: "rgba(255, 109, 79, 0.22)" }
];

function setToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(setToast.timeout);
  setToast.timeout = setTimeout(() => toast.classList.add("hidden"), 2200);
}

function getPlayerName() {
  return playerNameInput.value.trim() || "Player";
}

function isGameInteractive() {
  return Boolean(state.room && (state.room.phase === "countdown" || state.room.phase === "playing"));
}

function setScrollLock(locked) {
  if (state.scrollLocked === locked) {
    return;
  }

  state.scrollLocked = locked;

  if (locked) {
    state.scrollLockY = window.scrollY;
    document.documentElement.classList.add("game-lock");
    document.body.classList.add("game-lock");
    document.body.style.top = `-${state.scrollLockY}px`;
    return;
  }

  document.documentElement.classList.remove("game-lock");
  document.body.classList.remove("game-lock");
  document.body.style.top = "";
  window.scrollTo(0, state.scrollLockY);
}

function preventGameGesture(event) {
  if (isGameInteractive()) {
    event.preventDefault();
  }
}

function sendOpenSocket(type, payload = {}) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return false;
  }

  state.socket.send(JSON.stringify({ type, payload }));
  return true;
}

function connectSocket(forceReconnect = false) {
  if (!forceReconnect && state.socket) {
    if (state.socket.readyState === WebSocket.OPEN || state.socket.readyState === WebSocket.CONNECTING) {
      return state.socket;
    }
  }

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}/ws`);

  socket.addEventListener("open", () => {
    state.connected = true;
    renderPublicRooms();
    sendOpenSocket("list_rooms");
  });

  socket.addEventListener("close", () => {
    const hadRoom = Boolean(state.room);
    state.connected = false;
    state.room = null;
    state.playerId = null;
    state.joystick.active = false;
    state.joystick.pointerId = null;
    state.push.activeUntil = 0;
    state.push.cooldownUntil = 0;
    state.renderPlayers.clear();
    setScrollLock(false);
    showPanel("menu");
    renderPublicRooms();

    if (hadRoom) {
      setToast("연결이 끊겨 로비로 돌아왔습니다.");
    }

    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(() => {
      connectSocket(true);
    }, 1200);
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

function renderPublicRooms() {
  publicRoomsElement.innerHTML = "";

  if (!state.connected) {
    roomsStatus.textContent = "서버 연결 중입니다.";
    return;
  }

  if (!state.publicRooms.length) {
    roomsStatus.textContent = "지금 공개된 대기방이 없습니다. 먼저 방을 만들면 바로 목록에 뜹니다.";
    return;
  }

  roomsStatus.textContent = `${state.publicRooms.length}개의 공개 대기방이 보입니다.`;

  state.publicRooms.forEach((room, index) => {
    const card = document.createElement("article");
    card.className = "room-card";

    const roomMain = document.createElement("div");
    roomMain.className = "room-main";

    const avatar = document.createElement("div");
    avatar.className = `avatar ${index % 2 === 0 ? "one" : "two"}`;
    roomMain.append(avatar);

    const meta = document.createElement("div");
    meta.className = "room-meta";

    const title = document.createElement("strong");
    title.textContent = `${room.hostName}의 방`;
    meta.append(title);

    const sub = document.createElement("span");
    sub.className = "hint";
    sub.textContent = `${room.playerCount}/${room.maxPlayers} waiting · ${room.roomId}`;
    meta.append(sub);
    roomMain.append(meta);

    const joinButton = document.createElement("button");
    joinButton.className = "primary small";
    joinButton.textContent = "바로 참가";
    joinButton.addEventListener("click", () => {
      send("join_room", {
        roomId: room.roomId,
        name: getPlayerName()
      });
    });

    card.append(roomMain, joinButton);
    publicRoomsElement.append(card);
  });
}

function describePlayerTag(room, player) {
  if (room.phase === "finished") {
    if (!room.winnerId) {
      return { text: "DRAW", className: "draw" };
    }

    return room.winnerId === player.id
      ? { text: "WIN", className: "win" }
      : { text: "LOSE", className: "lose" };
  }

  if (!player.connected) {
    return { text: "Offline", className: "" };
  }

  if (player.ready) {
    return { text: "Ready", className: "ready" };
  }

  return { text: "Waiting", className: "" };
}

function renderLobbyPlayers(room) {
  playerCards.innerHTML = "";

  for (const player of room.players) {
    const card = document.createElement("article");
    card.className = "player-card";

    const meta = document.createElement("div");
    meta.className = "player-meta";

    const avatar = document.createElement("div");
    avatar.className = `avatar ${player.slot === 0 ? "one" : "two"}`;
    meta.append(avatar);

    const copy = document.createElement("div");
    const isSelf = player.id === state.playerId;
    const name = document.createElement("strong");
    name.textContent = `${player.name}${isSelf ? " (You)" : ""}`;
    copy.append(name);

    const label = document.createElement("div");
    label.className = "hint";
    label.textContent = `Player ${player.slot + 1}`;
    copy.append(label);
    meta.append(copy);

    const tag = document.createElement("span");
    const status = describePlayerTag(room, player);
    tag.className = `player-tag ${status.className}`.trim();
    tag.textContent = status.text;

    card.append(meta, tag);
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
      return "공개 대기방으로 노출 중입니다. 상대가 들어오면 준비를 누르세요.";
    }

    return "두 플레이어가 준비되면 카운트다운이 시작됩니다.";
  }

  if (room.phase === "countdown") {
    return "곧 시작합니다. 화면은 고정되고, 이동 입력은 시작과 동시에 반영됩니다.";
  }

  if (room.phase === "playing") {
    return "오른쪽으로 움직이고, 왼쪽 버튼으로 짧게 돌진하며 강하게 밀어내세요.";
  }

  if (room.winReason === "ring_out") {
    return "경기장 밖으로 밀려난 플레이어가 패배했습니다.";
  }

  if (room.winReason === "center_control") {
    return "시간 종료. 중심에 더 가까운 쪽이 승리했습니다.";
  }

  if (room.winReason === "player_left") {
    return "상대가 나가서 방이 다시 공개 대기 상태로 돌아갑니다.";
  }

  return "재대결을 눌러 바로 다시 붙을 수 있습니다.";
}

function syncRenderPlayers(room) {
  const nextIds = new Set();

  for (const player of room.players) {
    nextIds.add(player.id);
    let renderState = state.renderPlayers.get(player.id);

    if (!renderState) {
      renderState = {
        x: player.state.x,
        y: player.state.y,
        serverX: player.state.x,
        serverY: player.state.y,
        vx: player.state.vx,
        vy: player.state.vy,
        serverVx: player.state.vx,
        serverVy: player.state.vy,
        facingX: player.state.facingX || 1,
        facingY: player.state.facingY || 0,
        isPushing: player.state.isPushing,
        alive: player.state.alive,
        slot: player.slot,
        name: player.name,
        wobbleOffset: player.slot * 1.7
      };
    }

    renderState.serverX = player.state.x;
    renderState.serverY = player.state.y;
    renderState.serverVx = player.state.vx;
    renderState.serverVy = player.state.vy;
    renderState.facingX = player.state.facingX || renderState.facingX;
    renderState.facingY = player.state.facingY || renderState.facingY;
    renderState.isPushing = player.state.isPushing;
    renderState.alive = player.state.alive;
    renderState.slot = player.slot;
    renderState.name = player.name;

    if (player.id === state.playerId && room.phase !== "playing") {
      renderState.x = player.state.x;
      renderState.y = player.state.y;
      renderState.vx = player.state.vx;
      renderState.vy = player.state.vy;
    }

    state.renderPlayers.set(player.id, renderState);
  }

  for (const playerId of [...state.renderPlayers.keys()]) {
    if (!nextIds.has(playerId)) {
      state.renderPlayers.delete(playerId);
    }
  }
}

function syncSelfActionState(room) {
  const selfPlayer = room.players.find((player) => player.id === state.playerId);
  if (!selfPlayer) {
    return;
  }

  const now = performance.now();
  if (selfPlayer.state.facingX || selfPlayer.state.facingY) {
    state.push.directionX = selfPlayer.state.facingX;
    state.push.directionY = selfPlayer.state.facingY;
  }

  if (room.phase !== "playing") {
    state.push.activeUntil = 0;
    state.push.cooldownUntil = 0;
    return;
  }

  if (selfPlayer.state.isPushing) {
    state.push.activeUntil = Math.max(state.push.activeUntil, now + selfPlayer.state.pushRemainingMs);
  }

  state.push.cooldownUntil = Math.max(state.push.cooldownUntil, now + selfPlayer.state.pushCooldownRemainingMs);
}

function renderPushButton(now = performance.now()) {
  const cooldownMs = Math.max(0, state.push.cooldownUntil - now);
  const isActive = now < state.push.activeUntil;
  const canUse = Boolean(state.room && state.room.phase === "playing" && cooldownMs === 0);

  pushButton.classList.toggle("active", isActive);
  pushButton.classList.toggle("cooldown", cooldownMs > 0);
  pushButton.disabled = !canUse;

  if (!state.room) {
    pushMeta.textContent = "Ready";
    return;
  }

  if (state.room.phase === "countdown") {
    pushMeta.textContent = "Wait";
    return;
  }

  if (cooldownMs > 0) {
    pushMeta.textContent = `${(cooldownMs / 1000).toFixed(1)}s`;
    return;
  }

  pushMeta.textContent = "Ready";
}

function updateRoom(room) {
  state.room = room;
  syncRenderPlayers(room);
  syncSelfActionState(room);

  roomTitle.textContent = room.roomId;
  renderLobbyPlayers(room);
  renderPublicRooms();
  renderPushButton();
  lobbyStatus.textContent = describeStatus(room);
  gameStatus.textContent = describeStatus(room);
  phaseLabel.textContent = room.phase.toUpperCase();
  timerLabel.textContent = `${Math.max(0, room.remainingMs / 1000).toFixed(1)}s`;
  resultLabel.textContent = describeWinner(room);

  const selfPlayer = room.players.find((player) => player.id === state.playerId);
  readyButton.textContent = selfPlayer?.ready ? "준비 완료" : "준비";
  readyButton.classList.toggle("hidden", room.phase === "finished");
  rematchButton.classList.toggle("hidden", room.phase !== "finished");

  setScrollLock(room.phase === "countdown" || room.phase === "playing");
  showPanel(room.phase === "playing" || room.phase === "countdown" ? "game" : "lobby");
}

function handleServerMessage(type, payload) {
  if (type === "joined_room") {
    state.playerId = payload.playerId;
    roomCodeInput.value = payload.roomId;
    showPanel("lobby");
    setToast(`Joined room ${payload.roomId}`);
    return;
  }

  if (type === "rooms_update") {
    state.publicRooms = payload.rooms || [];
    renderPublicRooms();
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

function getCurrentFacingVector() {
  if (state.joystick.x || state.joystick.y) {
    const length = Math.hypot(state.joystick.x, state.joystick.y) || 1;
    return { x: state.joystick.x / length, y: state.joystick.y / length };
  }

  const self = getSelfPlayer();
  if (self?.state.facingX || self?.state.facingY) {
    return { x: self.state.facingX || 0, y: self.state.facingY || 0 };
  }

  return { x: state.push.directionX || 1, y: state.push.directionY || 0 };
}

function triggerPushAction() {
  if (!state.room || state.room.phase !== "playing") {
    return;
  }

  const now = performance.now();
  if (now < state.push.cooldownUntil) {
    return;
  }

  const direction = getCurrentFacingVector();
  state.push.directionX = direction.x;
  state.push.directionY = direction.y;
  state.push.activeUntil = now + PUSH_DURATION_MS;
  state.push.cooldownUntil = now + PUSH_COOLDOWN_MS;
  renderPushButton(now);
  sendOpenSocket("trigger_push");
}

function applyJoystickVisual(x, y) {
  const baseRect = joystickBase.getBoundingClientRect();
  const knobRect = joystickKnob.getBoundingClientRect();
  const knobRange = Math.max(0, baseRect.width / 2 - knobRect.width / 2 - 6);
  joystickKnob.style.transform = `translate(calc(-50% + ${x * knobRange}px), calc(-50% + ${y * knobRange}px))`;
}

function updateJoystick(x, y, transmit = true) {
  state.joystick.x = x;
  state.joystick.y = y;
  applyJoystickVisual(x, y);

  if (x || y) {
    state.push.directionX = x;
    state.push.directionY = y;
  }

  if (transmit) {
    sendOpenSocket("input_move", { x, y });
  }
}

function resetJoystick(event = null) {
  if (event && state.joystick.pointerId !== null && event.pointerId !== state.joystick.pointerId) {
    return;
  }

  state.joystick.active = false;
  state.joystick.pointerId = null;
  updateJoystick(0, 0);
}

function handleJoystickPointer(event) {
  event.preventDefault();

  const rect = joystickBase.getBoundingClientRect();
  const knobRect = joystickKnob.getBoundingClientRect();
  const baseCenterX = rect.left + rect.width / 2;
  const baseCenterY = rect.top + rect.height / 2;
  const dx = event.clientX - baseCenterX;
  const dy = event.clientY - baseCenterY;
  const maxDistance = Math.max(1, rect.width / 2 - knobRect.width / 2 - 6);
  const rawDistance = Math.min(maxDistance, Math.hypot(dx, dy));
  const angle = Math.atan2(dy, dx);
  const normalizedDistance = rawDistance / maxDistance;

  if (normalizedDistance <= JOYSTICK_DEADZONE) {
    updateJoystick(0, 0);
    return;
  }

  const scaledDistance = (normalizedDistance - JOYSTICK_DEADZONE) / (1 - JOYSTICK_DEADZONE);
  const x = Math.cos(angle) * scaledDistance;
  const y = Math.sin(angle) * scaledDistance;
  updateJoystick(Number(x.toFixed(4)), Number(y.toFixed(4)));
}

joystickBase.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  if (state.joystick.active && state.joystick.pointerId !== event.pointerId) {
    return;
  }

  state.joystick.active = true;
  state.joystick.pointerId = event.pointerId;
  joystickBase.setPointerCapture(event.pointerId);
  handleJoystickPointer(event);
});

joystickBase.addEventListener("pointermove", (event) => {
  if (!state.joystick.active || event.pointerId !== state.joystick.pointerId) {
    return;
  }

  handleJoystickPointer(event);
});

joystickBase.addEventListener("pointerup", resetJoystick);
joystickBase.addEventListener("pointercancel", resetJoystick);
joystickBase.addEventListener("lostpointercapture", resetJoystick);

pushButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  triggerPushAction();
});

createRoomButton.addEventListener("click", () => {
  send("create_room", { name: getPlayerName() });
});

joinRoomButton.addEventListener("click", () => {
  send("join_room", {
    roomId: roomCodeInput.value.trim().toUpperCase(),
    name: getPlayerName()
  });
});

refreshRoomsButton.addEventListener("click", () => {
  send("list_rooms");
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

[gamePanel, canvas, joystickBase, pushButton].forEach((element) => {
  element.addEventListener("touchstart", preventGameGesture, { passive: false });
  element.addEventListener("touchmove", preventGameGesture, { passive: false });
});

setInterval(() => {
  if (!state.room) {
    return;
  }

  if (state.room.phase !== "countdown" && state.room.phase !== "playing") {
    return;
  }

  sendOpenSocket("input_move", {
    x: state.joystick.x,
    y: state.joystick.y
  });
}, 80);

function worldToCanvas(value) {
  return canvas.width / 2 + value;
}

function drawArena(now) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);

  const pulse = 0.88 + Math.sin(now / 420) * 0.04;
  const outerGlow = ctx.createRadialGradient(0, 0, 48, 0, 0, ARENA_RADIUS + 36);
  outerGlow.addColorStop(0, "rgba(255, 255, 255, 0.08)");
  outerGlow.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = outerGlow;
  ctx.beginPath();
  ctx.arc(0, 0, ARENA_RADIUS + 34, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.beginPath();
  ctx.arc(0, 0, ARENA_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = `rgba(255,255,255,${0.22 * pulse})`;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(0, 0, ARENA_RADIUS, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,210,95,0.14)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 84, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawSlime(renderState, isSelf, now) {
  const x = worldToCanvas(renderState.x);
  const y = worldToCanvas(renderState.y);
  const palette = SLIME_COLORS[renderState.slot] || SLIME_COLORS[0];
  const localPushActive = isSelf && now < state.push.activeUntil;
  const pushing = renderState.isPushing || localPushActive;
  const speed = Math.min(1, Math.hypot(renderState.vx, renderState.vy) / (PLAYER_SPEED + PUSH_SPEED * 0.5));
  const wobble = Math.sin(now / 150 + renderState.wobbleOffset) * 0.08;
  const rotation = Math.atan2(renderState.vy || 0.001, renderState.vx || 0.001) * 0.18;
  const stretchX = 1 + speed * 0.16 + wobble * 0.22 + (pushing ? 0.14 : 0);
  const stretchY = 1 - speed * 0.1 - wobble * 0.1 - (pushing ? 0.08 : 0);
  const droop = renderState.alive ? 0 : 5;

  if (pushing) {
    ctx.save();
    ctx.fillStyle = palette.glow;
    ctx.beginPath();
    ctx.arc(x, y, PLAYER_RADIUS + 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(x, y + 14);
  ctx.scale(1 + speed * 0.18, 0.72 - speed * 0.08);
  ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
  ctx.beginPath();
  ctx.arc(0, 0, PLAYER_RADIUS * 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(stretchX, stretchY);
  ctx.globalAlpha = renderState.alive ? 1 : 0.56;

  const gradient = ctx.createLinearGradient(-PLAYER_RADIUS, -PLAYER_RADIUS, PLAYER_RADIUS, PLAYER_RADIUS);
  gradient.addColorStop(0, palette.base);
  gradient.addColorStop(1, palette.edge);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(0, -PLAYER_RADIUS * 1.08);
  ctx.bezierCurveTo(
    PLAYER_RADIUS * 0.92,
    -PLAYER_RADIUS,
    PLAYER_RADIUS * 1.06,
    PLAYER_RADIUS * 0.18,
    PLAYER_RADIUS * 0.76,
    PLAYER_RADIUS * 0.94
  );
  ctx.quadraticCurveTo(0, PLAYER_RADIUS * 1.34 + droop, -PLAYER_RADIUS * 0.76, PLAYER_RADIUS * 0.94);
  ctx.bezierCurveTo(
    -PLAYER_RADIUS * 1.08,
    PLAYER_RADIUS * 0.18,
    -PLAYER_RADIUS * 0.92,
    -PLAYER_RADIUS,
    0,
    -PLAYER_RADIUS * 1.08
  );
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  ctx.ellipse(-5, -8, 7, 10, -0.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(14, 22, 42, 0.92)";
  if (renderState.alive) {
    ctx.beginPath();
    ctx.ellipse(-6, -2, 2.4, 4.1, 0, 0, Math.PI * 2);
    ctx.ellipse(6, -2, 2.4, 4.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, 6, pushing ? 7 : 6, 0.12 * Math.PI, 0.88 * Math.PI);
    ctx.stroke();
  } else {
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-9, -3);
    ctx.lineTo(-3, 1);
    ctx.moveTo(-9, 1);
    ctx.lineTo(-3, -3);
    ctx.moveTo(3, -3);
    ctx.lineTo(9, 1);
    ctx.moveTo(3, 1);
    ctx.lineTo(9, -3);
    ctx.moveTo(-5, 8);
    ctx.lineTo(5, 8);
    ctx.stroke();
  }
  ctx.restore();

  if (isSelf) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, PLAYER_RADIUS + 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.font = "600 12px Trebuchet MS";
  ctx.textAlign = "center";
  ctx.fillStyle = palette.label;
  ctx.fillText(renderState.name, x, y - 32);
  ctx.restore();
}

function drawPlayers(deltaMs, now) {
  if (!state.room) {
    return;
  }

  const deltaSeconds = Math.min(0.05, deltaMs / 1000);

  for (const player of state.room.players) {
    const renderState = state.renderPlayers.get(player.id);
    if (!renderState) {
      continue;
    }

    const isSelf = player.id === state.playerId;

    if (isSelf && state.room.phase === "playing") {
      const pushActive = now < state.push.activeUntil;
      const pushVx = pushActive ? state.push.directionX * PUSH_SPEED : 0;
      const pushVy = pushActive ? state.push.directionY * PUSH_SPEED : 0;

      renderState.x += (state.joystick.x * PLAYER_SPEED + pushVx) * deltaSeconds;
      renderState.y += (state.joystick.y * PLAYER_SPEED + pushVy) * deltaSeconds;
      renderState.vx += (state.joystick.x * PLAYER_SPEED + pushVx - renderState.vx) * 0.28;
      renderState.vy += (state.joystick.y * PLAYER_SPEED + pushVy - renderState.vy) * 0.28;
      renderState.x += (renderState.serverX - renderState.x) * 0.18;
      renderState.y += (renderState.serverY - renderState.y) * 0.18;
      renderState.vx += (renderState.serverVx - renderState.vx) * 0.08;
      renderState.vy += (renderState.serverVy - renderState.vy) * 0.08;
      renderState.isPushing = pushActive || renderState.isPushing;
    } else {
      const positionLerp = Math.min(1, deltaMs / 55);
      renderState.x += (renderState.serverX - renderState.x) * positionLerp;
      renderState.y += (renderState.serverY - renderState.y) * positionLerp;
      renderState.vx += (renderState.serverVx - renderState.vx) * positionLerp;
      renderState.vy += (renderState.serverVy - renderState.vy) * positionLerp;
    }

    drawSlime(renderState, isSelf, now);
  }
}

function animate(now) {
  const deltaMs = now - state.lastFrameAt;
  state.lastFrameAt = now;
  drawArena(now);
  drawPlayers(deltaMs, now);
  renderPushButton(now);
  requestAnimationFrame(animate);
}

renderPublicRooms();
renderPushButton();
connectSocket();
requestAnimationFrame(animate);
showPanel("menu");
