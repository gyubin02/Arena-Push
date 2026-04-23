const state = {
  socket: null,
  connected: false,
  reconnectTimer: null,
  room: null,
  playerId: null,
  publicRooms: [],
  joystick: { active: false, x: 0, y: 0, pointerId: null },
  push: { activeUntil: 0, cooldownUntil: 0, directionX: 1, directionY: 0 },
  brace: { activeUntil: 0, cooldownUntil: 0 },
  renderPlayers: new Map(),
  scrollLocked: false,
  scrollLockY: 0,
  lastFrameAt: performance.now(),
  stageFx: {
    phase: "menu",
    phaseChangedAt: performance.now(),
    winnerId: null
  }
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
const braceButton = document.getElementById("brace-button");
const braceMeta = document.getElementById("brace-meta");
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

const BASE_ARENA_RADIUS = 180;
const PLAYER_RADIUS = 18;
const PLAYER_SPEED = 240;
const PUSH_SPEED = 340;
const PUSH_DURATION_MS = 180;
const PUSH_COOLDOWN_MS = 900;
const BRACE_DURATION_MS = 420;
const BRACE_COOLDOWN_MS = 1700;
const JOYSTICK_DEADZONE = 0.12;
const COUNTDOWN_DURATION_MS = 3000;
const SLIME_COLORS = [
  { base: "#7ee6ff", edge: "#2d89ff", label: "#9be9ff", glow: "rgba(76, 196, 255, 0.22)" },
  { base: "#ffb591", edge: "#ff6130", label: "#ffc7ab", glow: "rgba(255, 109, 79, 0.22)" }
];
const spotlightAssets = {
  beam: createCanvasAsset("/assets/spotlight-beam-v1.png"),
  burst: createCanvasAsset("/assets/spotlight-burst-v1.png")
};

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function createCanvasAsset(src) {
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  return image;
}

function isCanvasAssetReady(image) {
  return Boolean(image?.complete && image.naturalWidth > 0);
}

function setToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(setToast.timeout);
  setToast.timeout = setTimeout(() => toast.classList.add("hidden"), 2200);
}

function getPlayerName() {
  return playerNameInput.value.trim() || "Player";
}

function getArenaRadius() {
  return state.room?.arena?.radius || BASE_ARENA_RADIUS;
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
    state.brace.activeUntil = 0;
    state.brace.cooldownUntil = 0;
    state.renderPlayers.clear();
    resetStageFx();
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

function resetStageFx() {
  state.stageFx.phase = "menu";
  state.stageFx.phaseChangedAt = performance.now();
  state.stageFx.winnerId = null;
}

function syncStageFx(room) {
  const now = performance.now();

  if (state.stageFx.phase !== room.phase) {
    state.stageFx.phase = room.phase;
    state.stageFx.phaseChangedAt = now;
  }

  if (room.phase === "finished" && state.stageFx.winnerId !== room.winnerId) {
    state.stageFx.phaseChangedAt = now;
  }

  state.stageFx.winnerId = room.winnerId || null;
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
    return "곧 시작합니다. 밀치기와 버티기를 준비하세요. 잠시 뒤 경기장이 서서히 좁아집니다.";
  }

  if (room.phase === "playing") {
    return room.arena?.shrinking
      ? "경기장이 줄어드는 중입니다. 버티기로 받아내고 밀치기로 반격하세요."
      : "이동으로 각을 만들고, 밀치기와 버티기 타이밍으로 주도권을 잡으세요.";
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
        isBracing: player.state.isBracing,
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
    renderState.isBracing = player.state.isBracing;
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
    state.brace.activeUntil = 0;
    state.brace.cooldownUntil = 0;
    return;
  }

  if (selfPlayer.state.isPushing) {
    state.push.activeUntil = Math.max(state.push.activeUntil, now + selfPlayer.state.pushRemainingMs);
  }

  if (selfPlayer.state.isBracing) {
    state.brace.activeUntil = Math.max(state.brace.activeUntil, now + selfPlayer.state.braceRemainingMs);
  }

  state.push.cooldownUntil = Math.max(state.push.cooldownUntil, now + selfPlayer.state.pushCooldownRemainingMs);
  state.brace.cooldownUntil = Math.max(state.brace.cooldownUntil, now + selfPlayer.state.braceCooldownRemainingMs);
}

function renderPushButton(now = performance.now()) {
  const cooldownMs = Math.max(0, state.push.cooldownUntil - now);
  const isActive = now < state.push.activeUntil;
  const braceActive = now < state.brace.activeUntil;
  const canUse = Boolean(state.room && state.room.phase === "playing" && cooldownMs === 0 && !braceActive);

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

  if (braceActive) {
    pushMeta.textContent = "Brace";
    return;
  }

  if (cooldownMs > 0) {
    pushMeta.textContent = `${(cooldownMs / 1000).toFixed(1)}s`;
    return;
  }

  pushMeta.textContent = "Ready";
}

function renderBraceButton(now = performance.now()) {
  const cooldownMs = Math.max(0, state.brace.cooldownUntil - now);
  const isActive = now < state.brace.activeUntil;
  const pushActive = now < state.push.activeUntil;
  const canUse = Boolean(state.room && state.room.phase === "playing" && cooldownMs === 0 && !pushActive);

  braceButton.classList.toggle("active", isActive);
  braceButton.classList.toggle("cooldown", cooldownMs > 0);
  braceButton.disabled = !canUse;

  if (!state.room) {
    braceMeta.textContent = "Ready";
    return;
  }

  if (state.room.phase === "countdown") {
    braceMeta.textContent = "Wait";
    return;
  }

  if (pushActive) {
    braceMeta.textContent = "Push";
    return;
  }

  if (isActive) {
    braceMeta.textContent = "Hold";
    return;
  }

  if (cooldownMs > 0) {
    braceMeta.textContent = `${(cooldownMs / 1000).toFixed(1)}s`;
    return;
  }

  braceMeta.textContent = "Ready";
}

function updateRoom(room) {
  syncStageFx(room);
  state.room = room;
  syncRenderPlayers(room);
  syncSelfActionState(room);

  roomTitle.textContent = room.roomId;
  renderLobbyPlayers(room);
  renderPublicRooms();
  renderPushButton();
  renderBraceButton();
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
  if (now < state.push.cooldownUntil || now < state.brace.activeUntil) {
    return;
  }

  const direction = getCurrentFacingVector();
  state.push.directionX = direction.x;
  state.push.directionY = direction.y;
  state.push.activeUntil = now + PUSH_DURATION_MS;
  state.push.cooldownUntil = now + PUSH_COOLDOWN_MS;
  renderPushButton(now);
  renderBraceButton(now);
  sendOpenSocket("trigger_push");
}

function triggerBraceAction() {
  if (!state.room || state.room.phase !== "playing") {
    return;
  }

  const now = performance.now();
  if (now < state.brace.cooldownUntil || now < state.push.activeUntil) {
    return;
  }

  state.brace.activeUntil = now + BRACE_DURATION_MS;
  state.brace.cooldownUntil = now + BRACE_COOLDOWN_MS;
  renderBraceButton(now);
  renderPushButton(now);
  sendOpenSocket("trigger_brace");
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

braceButton.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  triggerBraceAction();
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

[gamePanel, canvas, joystickBase, pushButton, braceButton].forEach((element) => {
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

function getCountdownProgress() {
  if (state.room?.phase !== "countdown") {
    return 0;
  }

  return clampNumber(1 - (state.room.remainingMs || COUNTDOWN_DURATION_MS) / COUNTDOWN_DURATION_MS, 0, 1);
}

function getShrinkProgress() {
  const arena = state.room?.arena;
  if (!arena) {
    return 0;
  }

  return clampNumber((arena.baseRadius - arena.radius) / Math.max(1, arena.baseRadius - arena.minRadius), 0, 1);
}

function getStageIntensity(now) {
  if (!state.room) {
    return 0.18;
  }

  if (state.room.phase === "countdown") {
    return lerp(0.36, 0.9, getCountdownProgress());
  }

  if (state.room.phase === "playing") {
    return state.room.arena?.shrinking ? lerp(0.74, 1.04, getShrinkProgress()) : 0.66;
  }

  if (state.room.phase === "finished") {
    const reveal = clampNumber((now - state.stageFx.phaseChangedAt) / 750, 0, 1);
    return lerp(0.84, 1.08, reveal);
  }

  return 0.24;
}

function getWinnerSpotlightTarget() {
  const winnerRenderState = state.room?.winnerId ? state.renderPlayers.get(state.room.winnerId) : null;
  if (winnerRenderState) {
    return {
      x: worldToCanvas(winnerRenderState.x),
      y: worldToCanvas(winnerRenderState.y)
    };
  }

  return {
    x: canvas.width / 2,
    y: canvas.height / 2
  };
}

function drawSpotlightBurst(x, y, size, alpha, rotation = 0) {
  const radius = size / 2;

  if (!isCanvasAssetReady(spotlightAssets.burst)) {
    ctx.save();
    const burstGradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    burstGradient.addColorStop(0, `rgba(255, 246, 208, ${alpha})`);
    burstGradient.addColorStop(0.55, `rgba(255, 214, 126, ${alpha * 0.48})`);
    burstGradient.addColorStop(1, "rgba(255, 214, 126, 0)");
    ctx.fillStyle = burstGradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = alpha;
  ctx.drawImage(spotlightAssets.burst, -radius, -radius, size, size);
  ctx.restore();
}

function drawTargetedSpotlight(sourceX, sourceY, targetX, targetY, options = {}) {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const distance = Math.hypot(dx, dy);
  const rotation = Math.atan2(dy, dx) - Math.PI / 2;
  const height = options.height || distance + 118;
  const width = options.width || Math.min(canvas.width * 0.56, height * 0.45);
  const alpha = options.alpha || 0.24;
  const bottomOffset = options.bottomOffset || 10;

  ctx.save();
  ctx.translate(targetX, targetY);
  ctx.rotate(rotation);
  ctx.globalCompositeOperation = "screen";

  if (!isCanvasAssetReady(spotlightAssets.beam)) {
    const fallbackGradient = ctx.createLinearGradient(0, -height, 0, bottomOffset);
    fallbackGradient.addColorStop(0, "rgba(255, 255, 255, 0)");
    fallbackGradient.addColorStop(0.3, `rgba(255, 250, 232, ${alpha * 0.54})`);
    fallbackGradient.addColorStop(1, `rgba(112, 216, 255, ${alpha * 0.26})`);
    ctx.fillStyle = fallbackGradient;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(-width * 0.14, -height);
    ctx.lineTo(-width * 0.5, bottomOffset);
    ctx.lineTo(width * 0.5, bottomOffset);
    ctx.lineTo(width * 0.14, -height);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.globalAlpha = alpha * 0.58;
  ctx.filter = "blur(9px)";
  ctx.drawImage(spotlightAssets.beam, -width / 2, -height + bottomOffset, width, height);
  ctx.filter = "none";
  ctx.globalAlpha = alpha;
  ctx.drawImage(spotlightAssets.beam, -width / 2, -height + bottomOffset, width, height);
  ctx.restore();
}

function drawArenaBackdrop(now) {
  const stageIntensity = getStageIntensity(now);
  const baseGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  baseGradient.addColorStop(0, "#173055");
  baseGradient.addColorStop(0.46, "#0a1730");
  baseGradient.addColorStop(1, "#050915");
  ctx.fillStyle = baseGradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const topGlow = ctx.createRadialGradient(
    canvas.width / 2,
    canvas.height * 0.06,
    18,
    canvas.width / 2,
    canvas.height * 0.08,
    canvas.width * 0.8
  );
  topGlow.addColorStop(0, `rgba(255, 235, 184, ${0.18 + stageIntensity * 0.14})`);
  topGlow.addColorStop(0.4, `rgba(121, 213, 255, ${0.1 + stageIntensity * 0.08})`);
  topGlow.addColorStop(1, "rgba(8, 12, 22, 0)");
  ctx.fillStyle = topGlow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let index = 0; index < 7; index += 1) {
    const progress = index / 6;
    const x = 42 + progress * (canvas.width - 84);
    const y = 34 + Math.sin(now / 520 + index * 0.9) * 2.5;
    const radius = 4.5 + (index % 2) * 1.5;
    const lightGradient = ctx.createRadialGradient(x, y, 0, x, y, radius * 3);
    lightGradient.addColorStop(0, `rgba(255, 225, 148, ${0.22 + stageIntensity * 0.12})`);
    lightGradient.addColorStop(1, "rgba(255, 225, 148, 0)");
    ctx.fillStyle = lightGradient;
    ctx.beginPath();
    ctx.arc(x, y, radius * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  const vignette = ctx.createRadialGradient(
    canvas.width / 2,
    canvas.height / 2,
    canvas.width * 0.12,
    canvas.width / 2,
    canvas.height / 2,
    canvas.width * 0.68
  );
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.36)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawStageSpotlights(now) {
  if (!state.room || state.room.phase === "lobby") {
    return;
  }

  const stageIntensity = getStageIntensity(now);
  const countdownProgress = getCountdownProgress();
  const shrinkProgress = getShrinkProgress();
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2 + 12;
  const sweepRate = state.room.phase === "countdown" ? 560 : state.room.arena?.shrinking ? 360 : 760;
  const beamWidth = 132 + stageIntensity * 54 + countdownProgress * 34 + shrinkProgress * 22;
  const leftTarget = {
    x: centerX - 66 + Math.sin(now / sweepRate) * (72 + shrinkProgress * 18),
    y: centerY + 16 + Math.cos(now / (sweepRate + 120)) * 18
  };
  const rightTarget = {
    x: centerX + 66 + Math.sin(now / (sweepRate + 160) + 1.6) * (72 + shrinkProgress * 18),
    y: centerY + 16 + Math.cos(now / (sweepRate + 90) + 0.8) * 18
  };

  drawTargetedSpotlight(60 + Math.sin(now / 930) * 18, -28, leftTarget.x, leftTarget.y, {
    width: beamWidth,
    alpha: 0.15 + stageIntensity * 0.2
  });
  drawTargetedSpotlight(canvas.width - 60 + Math.cos(now / 860) * 18, -28, rightTarget.x, rightTarget.y, {
    width: beamWidth,
    alpha: 0.14 + stageIntensity * 0.19
  });

  if (state.room.phase === "countdown" || state.room.phase === "playing") {
    const pulse = 1 + Math.sin(now / 240) * 0.04;
    drawSpotlightBurst(centerX, centerY, (170 + stageIntensity * 78) * pulse, 0.06 + stageIntensity * 0.06, now / 2200);
  }

  if (state.room.arena?.shrinking) {
    const hazardX = centerX + Math.sin(now / 260) * (48 + shrinkProgress * 32);
    const hazardY = centerY + Math.cos(now / 310) * 18;
    drawSpotlightBurst(hazardX, hazardY, 92 + shrinkProgress * 56, 0.08 + shrinkProgress * 0.1, now / 1200);
  }

  if (state.room.phase === "finished") {
    const winnerTarget = getWinnerSpotlightTarget();
    const reveal = clampNumber((now - state.stageFx.phaseChangedAt) / 420, 0, 1);
    drawTargetedSpotlight(canvas.width / 2, -38, winnerTarget.x, winnerTarget.y + 10, {
      width: 118 + reveal * 54,
      alpha: 0.28 + reveal * 0.18,
      bottomOffset: 14
    });
    drawSpotlightBurst(
      winnerTarget.x,
      winnerTarget.y,
      156 + reveal * 124 + Math.sin(now / 170) * 8,
      0.16 + reveal * 0.16,
      now / 1400
    );
  }
}

function drawArena(now) {
  const arenaRadius = getArenaRadius();
  const shrinking = Boolean(state.room?.arena?.shrinking);
  const shrinkProgress = getShrinkProgress();
  const stageIntensity = getStageIntensity(now);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawArenaBackdrop(now);
  drawStageSpotlights(now);
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);

  const pulse = 0.88 + Math.sin(now / 420) * 0.04;
  const outerGlow = ctx.createRadialGradient(0, 0, 48, 0, 0, arenaRadius + 40);
  outerGlow.addColorStop(
    0,
    shrinking
      ? `rgba(255, 214, 176, ${0.1 + shrinkProgress * 0.14})`
      : `rgba(172, 231, 255, ${0.08 + stageIntensity * 0.08})`
  );
  outerGlow.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = outerGlow;
  ctx.beginPath();
  ctx.arc(0, 0, arenaRadius + 38, 0, Math.PI * 2);
  ctx.fill();

  const floorGradient = ctx.createRadialGradient(0, 0, 18, 0, 0, arenaRadius);
  floorGradient.addColorStop(0, shrinking ? "rgba(255, 219, 170, 0.18)" : "rgba(177, 238, 255, 0.16)");
  floorGradient.addColorStop(0.58, shrinking ? "rgba(97, 40, 24, 0.28)" : "rgba(18, 39, 67, 0.24)");
  floorGradient.addColorStop(1, "rgba(255, 255, 255, 0.03)");
  ctx.fillStyle = floorGradient;
  ctx.beginPath();
  ctx.arc(0, 0, arenaRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = shrinking
    ? `rgba(255, 150, 110, ${0.36 + shrinkProgress * 0.16})`
    : `rgba(230, 246, 255, ${(0.22 + stageIntensity * 0.06) * pulse})`;
  ctx.lineWidth = shrinking ? 7 : 6;
  ctx.beginPath();
  ctx.arc(0, 0, arenaRadius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = `rgba(255, 210, 95, ${0.12 + stageIntensity * 0.08})`;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, 84 + Math.sin(now / 500) * 2.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawSlime(renderState, isSelf, now) {
  const x = worldToCanvas(renderState.x);
  const y = worldToCanvas(renderState.y);
  const palette = SLIME_COLORS[renderState.slot] || SLIME_COLORS[0];
  const localPushActive = isSelf && now < state.push.activeUntil;
  const localBraceActive = isSelf && now < state.brace.activeUntil;
  const pushing = renderState.isPushing || localPushActive;
  const bracing = renderState.isBracing || localBraceActive;
  const speed = Math.min(1, Math.hypot(renderState.vx, renderState.vy) / (PLAYER_SPEED + PUSH_SPEED * 0.5));
  const wobble = Math.sin(now / 150 + renderState.wobbleOffset) * 0.08;
  const rotation = Math.atan2(renderState.vy || 0.001, renderState.vx || 0.001) * 0.18;
  const stretchX = 1 + speed * 0.16 + wobble * 0.22 + (pushing ? 0.14 : 0) - (bracing ? 0.08 : 0);
  const stretchY = 1 - speed * 0.1 - wobble * 0.1 - (pushing ? 0.08 : 0) + (bracing ? 0.06 : 0);
  const droop = renderState.alive ? 0 : 5;

  if (pushing) {
    ctx.save();
    ctx.fillStyle = palette.glow;
    ctx.beginPath();
    ctx.arc(x, y, PLAYER_RADIUS + 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  if (bracing) {
    ctx.save();
    ctx.strokeStyle = "rgba(115, 214, 255, 0.9)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, PLAYER_RADIUS + 12, 0, Math.PI * 2);
    ctx.stroke();
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
      const braceActive = now < state.brace.activeUntil;
      const pushVx = pushActive ? state.push.directionX * PUSH_SPEED : 0;
      const pushVy = pushActive ? state.push.directionY * PUSH_SPEED : 0;
      const moveVx = braceActive ? 0 : state.joystick.x * PLAYER_SPEED;
      const moveVy = braceActive ? 0 : state.joystick.y * PLAYER_SPEED;

      renderState.x += (moveVx + pushVx) * deltaSeconds;
      renderState.y += (moveVy + pushVy) * deltaSeconds;
      renderState.vx += (moveVx + pushVx - renderState.vx) * 0.28;
      renderState.vy += (moveVy + pushVy - renderState.vy) * 0.28;
      renderState.x += (renderState.serverX - renderState.x) * 0.18;
      renderState.y += (renderState.serverY - renderState.y) * 0.18;
      renderState.vx += (renderState.serverVx - renderState.vx) * 0.08;
      renderState.vy += (renderState.serverVy - renderState.vy) * 0.08;
      renderState.isPushing = pushActive || renderState.isPushing;
      renderState.isBracing = braceActive || renderState.isBracing;
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

function drawWinnerAccent(now) {
  if (!state.room || state.room.phase !== "finished" || !state.room.winnerId) {
    return;
  }

  const winnerTarget = getWinnerSpotlightTarget();
  const reveal = clampNumber((now - state.stageFx.phaseChangedAt) / 360, 0, 1);
  const ringRadius = PLAYER_RADIUS + 16 + Math.sin(now / 150) * 2.2;

  ctx.save();
  ctx.strokeStyle = `rgba(255, 243, 194, ${0.34 + reveal * 0.24})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(winnerTarget.x, winnerTarget.y, ringRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  drawSpotlightBurst(
    winnerTarget.x,
    winnerTarget.y,
    112 + reveal * 60 + Math.sin(now / 210) * 5,
    0.08 + reveal * 0.06,
    now / 900
  );
}

function animate(now) {
  const deltaMs = now - state.lastFrameAt;
  state.lastFrameAt = now;
  drawArena(now);
  drawPlayers(deltaMs, now);
  drawWinnerAccent(now);
  renderPushButton(now);
  renderBraceButton(now);
  requestAnimationFrame(animate);
}

renderPublicRooms();
renderPushButton();
renderBraceButton();
connectSocket();
requestAnimationFrame(animate);
showPanel("menu");
