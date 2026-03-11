const config = require("./config");

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const vectorLength = (vector) => Math.hypot(vector.x, vector.y);

const normalizeInput = (input) => {
  const length = Math.hypot(input.x || 0, input.y || 0);
  if (!length) {
    return { x: 0, y: 0 };
  }

  const scale = Math.min(1, 1 / length);
  return {
    x: (input.x || 0) * scale,
    y: (input.y || 0) * scale
  };
};

const createPlayerState = (slot) => ({
  slot,
  x: slot === 0 ? -70 : 70,
  y: 0,
  vx: 0,
  vy: 0,
  inputX: 0,
  inputY: 0,
  alive: true
});

const createRoundState = () => ({
  phase: "lobby",
  roundEndsAt: null,
  countdownEndsAt: null,
  winnerId: null,
  winReason: null,
  players: {}
});

function resetRound(room) {
  room.round = createRoundState();

  for (const player of room.players.values()) {
    player.ready = false;
    player.rematch = false;
    player.state = createPlayerState(player.slot);
  }
}

function beginCountdown(room, now) {
  room.round.phase = "countdown";
  room.round.countdownEndsAt = now + config.lobbyCountdownMs;
  room.round.roundEndsAt = now + config.lobbyCountdownMs + config.roundDurationMs;
  room.round.winnerId = null;
  room.round.winReason = null;

  for (const player of room.players.values()) {
    player.state = createPlayerState(player.slot);
    player.state.alive = true;
  }
}

function startRound(room) {
  room.round.phase = "playing";
  room.round.countdownEndsAt = null;
}

function finishRound(room, winnerId, winReason) {
  room.round.phase = "finished";
  room.round.winnerId = winnerId;
  room.round.winReason = winReason;

  for (const player of room.players.values()) {
    player.ready = false;
  }
}

function getRemainingTimeMs(room, now) {
  if (room.round.phase === "countdown" && room.round.countdownEndsAt) {
    return Math.max(0, room.round.countdownEndsAt - now);
  }

  if ((room.round.phase === "playing" || room.round.phase === "finished") && room.round.roundEndsAt) {
    return Math.max(0, room.round.roundEndsAt - now);
  }

  return 0;
}

function allPlayersReady(room) {
  if (room.players.size !== config.maxPlayersPerRoom) {
    return false;
  }

  for (const player of room.players.values()) {
    if (!player.ready) {
      return false;
    }
  }

  return true;
}

function allPlayersWantRematch(room) {
  if (room.players.size !== config.maxPlayersPerRoom) {
    return false;
  }

  for (const player of room.players.values()) {
    if (!player.rematch) {
      return false;
    }
  }

  return true;
}

function applyInput(player, input) {
  const normalized = normalizeInput(input);
  player.state.inputX = normalized.x;
  player.state.inputY = normalized.y;
}

function resolveCollision(playerA, playerB) {
  const dx = playerB.x - playerA.x;
  const dy = playerB.y - playerA.y;
  const distance = Math.hypot(dx, dy);
  const minDistance = config.playerRadius * 2;

  if (!distance || distance >= minDistance) {
    return;
  }

  const normalX = dx / distance;
  const normalY = dy / distance;
  const overlap = minDistance - distance;

  playerA.x -= normalX * overlap * 0.5;
  playerA.y -= normalY * overlap * 0.5;
  playerB.x += normalX * overlap * 0.5;
  playerB.y += normalY * overlap * 0.5;

  const relativeVelocityX = playerB.vx - playerA.vx;
  const relativeVelocityY = playerB.vy - playerA.vy;
  const impactSpeed = relativeVelocityX * normalX + relativeVelocityY * normalY;

  if (impactSpeed <= 0) {
    const impulse = Math.abs(impactSpeed) * 0.9 + 80;
    playerA.vx -= normalX * impulse;
    playerA.vy -= normalY * impulse;
    playerB.vx += normalX * impulse;
    playerB.vy += normalY * impulse;
  }
}

function updatePhysics(room, deltaSeconds) {
  const activePlayers = [...room.players.values()].filter((player) => player.state.alive);

  for (const player of activePlayers) {
    player.state.vx = player.state.inputX * config.playerSpeed;
    player.state.vy = player.state.inputY * config.playerSpeed;
    player.state.x += player.state.vx * deltaSeconds;
    player.state.y += player.state.vy * deltaSeconds;
  }

  if (activePlayers.length === 2) {
    resolveCollision(activePlayers[0].state, activePlayers[1].state);
  }

  for (const player of activePlayers) {
    if (vectorLength(player.state) > config.arenaRadius) {
      player.state.alive = false;
    }
  }
}

function determineTimeoutWinner(room) {
  const players = [...room.players.values()];

  if (players.length < 2) {
    return { winnerId: players[0]?.id || null, reason: "opponent_left" };
  }

  const [a, b] = players;
  const distanceA = Math.hypot(a.state.x, a.state.y);
  const distanceB = Math.hypot(b.state.x, b.state.y);

  if (Math.abs(distanceA - distanceB) < 6) {
    return { winnerId: null, reason: "draw" };
  }

  return distanceA < distanceB
    ? { winnerId: a.id, reason: "center_control" }
    : { winnerId: b.id, reason: "center_control" };
}

function tickRoom(room, now, deltaSeconds) {
  if (room.round.phase === "countdown" && room.round.countdownEndsAt && now >= room.round.countdownEndsAt) {
    startRound(room);
  }

  if (room.round.phase !== "playing") {
    return null;
  }

  updatePhysics(room, deltaSeconds);

  const alivePlayers = [...room.players.values()].filter((player) => player.state.alive);
  if (alivePlayers.length === 1) {
    return { winnerId: alivePlayers[0].id, reason: "ring_out" };
  }

  if (alivePlayers.length === 0) {
    return determineTimeoutWinner(room);
  }

  if (room.round.roundEndsAt && now >= room.round.roundEndsAt) {
    return determineTimeoutWinner(room);
  }

  return null;
}

function serializeRoom(room, now) {
  return {
    roomId: room.id,
    phase: room.round.phase,
    winnerId: room.round.winnerId,
    winReason: room.round.winReason,
    remainingMs: getRemainingTimeMs(room, now),
    players: [...room.players.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((player) => ({
        id: player.id,
        name: player.name,
        slot: player.slot,
        connected: player.connected,
        ready: player.ready,
        rematch: player.rematch,
        state: {
          x: Number(player.state.x.toFixed(2)),
          y: Number(player.state.y.toFixed(2)),
          vx: Number(player.state.vx.toFixed(2)),
          vy: Number(player.state.vy.toFixed(2)),
          alive: player.state.alive
        }
      }))
  };
}

function createRoom(id) {
  return {
    id,
    players: new Map(),
    round: createRoundState(),
    lastTickAt: Date.now()
  };
}

function createPlayer(id, name, socket, slot) {
  return {
    id,
    name,
    socket,
    slot,
    connected: true,
    ready: false,
    rematch: false,
    state: createPlayerState(slot)
  };
}

module.exports = {
  allPlayersReady,
  allPlayersWantRematch,
  applyInput,
  beginCountdown,
  clamp,
  createPlayer,
  createRoom,
  determineTimeoutWinner,
  finishRound,
  normalizeInput,
  resetRound,
  serializeRoom,
  tickRoom
};
