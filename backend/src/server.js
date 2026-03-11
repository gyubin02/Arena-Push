const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { WebSocketServer } = require("ws");

const config = require("./config");
const {
  allPlayersReady,
  allPlayersWantRematch,
  applyInput,
  beginCountdown,
  createPlayer,
  createRoom,
  finishRound,
  resetRound,
  serializeRoom,
  tickRoom
} = require("./game");

const frontendDir = path.resolve(__dirname, "../../frontend");
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const rooms = new Map();
const sockets = new Map();

function send(socket, type, payload) {
  if (socket.readyState !== socket.OPEN) {
    return;
  }

  socket.send(JSON.stringify({ type, payload }));
}

function broadcastRoom(room, type, payloadFactory) {
  const now = Date.now();
  const payload = payloadFactory(now);

  for (const player of room.players.values()) {
    if (player.connected) {
      send(player.socket, type, payload);
    }
  }
}

function broadcastState(room) {
  broadcastRoom(room, "state_update", (now) => serializeRoom(room, now));
}

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  while (code.length < 4) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return rooms.has(code) ? makeRoomCode() : code;
}

function getAvailableSlot(room) {
  const usedSlots = new Set([...room.players.values()].map((player) => player.slot));
  for (let slot = 0; slot < config.maxPlayersPerRoom; slot += 1) {
    if (!usedSlots.has(slot)) {
      return slot;
    }
  }

  return null;
}

function removeRoomIfEmpty(roomId) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  const connectedCount = [...room.players.values()].filter((player) => player.connected).length;
  if (!connectedCount) {
    rooms.delete(roomId);
  }
}

function handlePlayerDeparture(playerRecord, reason = "player_left") {
  const room = rooms.get(playerRecord.roomId);
  if (!room) {
    return;
  }

  const player = room.players.get(playerRecord.playerId);
  if (!player) {
    return;
  }

  player.connected = false;
  player.ready = false;
  player.rematch = false;

  if (room.round.phase === "playing" || room.round.phase === "countdown") {
    const remaining = [...room.players.values()].find(
      (candidate) => candidate.id !== player.id && candidate.connected
    );

    finishRound(room, remaining?.id || null, reason);
    broadcastRoom(room, "round_end", () => serializeRoom(room, Date.now()));
  }

  room.players.delete(player.id);
  broadcastState(room);
  removeRoomIfEmpty(room.id);
}

function validateRoomJoin(room, socket) {
  if (!room) {
    send(socket, "error", { message: "Room not found." });
    return false;
  }

  if (room.players.size >= config.maxPlayersPerRoom) {
    send(socket, "error", { message: "Room is full." });
    return false;
  }

  if (room.round.phase === "playing" || room.round.phase === "countdown") {
    send(socket, "error", { message: "Match is already in progress." });
    return false;
  }

  return true;
}

function attachPlayerToRoom(room, socket, name) {
  const playerId = crypto.randomUUID();
  const slot = getAvailableSlot(room);
  const player = createPlayer(playerId, name, socket, slot);
  room.players.set(playerId, player);
  sockets.set(socket, { roomId: room.id, playerId });
  send(socket, "joined_room", {
    playerId,
    roomId: room.id,
    slot
  });
  broadcastState(room);
}

function handleMessage(socket, rawMessage) {
  let message;

  try {
    message = JSON.parse(rawMessage.toString());
  } catch {
    send(socket, "error", { message: "Invalid JSON payload." });
    return;
  }

  const { type, payload = {} } = message;
  const playerRecord = sockets.get(socket);

  if (type === "create_room") {
    const room = createRoom(makeRoomCode());
    rooms.set(room.id, room);
    attachPlayerToRoom(room, socket, String(payload.name || "Player 1").slice(0, 20));
    return;
  }

  if (type === "join_room") {
    const room = rooms.get(String(payload.roomId || "").toUpperCase());
    if (!validateRoomJoin(room, socket)) {
      return;
    }

    attachPlayerToRoom(room, socket, String(payload.name || "Player 2").slice(0, 20));
    return;
  }

  if (!playerRecord) {
    send(socket, "error", { message: "Join a room first." });
    return;
  }

  const room = rooms.get(playerRecord.roomId);
  const player = room?.players.get(playerRecord.playerId);
  if (!room || !player) {
    send(socket, "error", { message: "Room session is no longer valid." });
    return;
  }

  if (type === "player_ready") {
    if (room.round.phase !== "lobby" && room.round.phase !== "finished") {
      send(socket, "error", { message: "Cannot ready right now." });
      return;
    }

    player.ready = Boolean(payload.ready);
    player.rematch = false;
    if (room.round.phase === "finished") {
      room.round.phase = "lobby";
      room.round.winnerId = null;
      room.round.winReason = null;
    }

    if (allPlayersReady(room)) {
      beginCountdown(room, Date.now());
    }

    broadcastState(room);
    return;
  }

  if (type === "input_move") {
    if (room.round.phase !== "playing") {
      return;
    }

    applyInput(player, payload);
    return;
  }

  if (type === "rematch_request") {
    if (room.round.phase !== "finished") {
      return;
    }

    player.rematch = true;

    if (allPlayersWantRematch(room)) {
      resetRound(room);
      for (const participant of room.players.values()) {
        participant.ready = true;
      }
      beginCountdown(room, Date.now());
    }

    broadcastState(room);
    return;
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(frontendDir, pathname));

  if (!filePath.startsWith(frontendDir)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404).end("Not found");
      return;
    }

    const extension = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream"
    });
    res.end(content);
  });
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket) => {
  socket.on("message", (message) => {
    handleMessage(socket, message);
  });

  socket.on("close", () => {
    const playerRecord = sockets.get(socket);
    if (!playerRecord) {
      return;
    }

    sockets.delete(socket);
    handlePlayerDeparture(playerRecord);
  });
});

const tickMs = 1000 / config.tickRate;
setInterval(() => {
  const now = Date.now();

  for (const room of rooms.values()) {
    const deltaSeconds = Math.min(0.05, (now - room.lastTickAt) / 1000);
    room.lastTickAt = now;

    const result = tickRoom(room, now, deltaSeconds);
    if (result) {
      finishRound(room, result.winnerId, result.reason);
      broadcastRoom(room, "round_end", () => serializeRoom(room, Date.now()));
    }

    broadcastState(room);
  }
}, tickMs);

server.listen(config.port, () => {
  console.log(`Arena Push server listening on http://localhost:${config.port}`);
});
