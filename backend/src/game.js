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

const createPlayerState = (slot) => {
  const facingX = slot === 0 ? 1 : -1;

  return {
    slot,
    x: slot === 0 ? -70 : 70,
    y: 0,
    vx: 0,
    vy: 0,
    inputX: 0,
    inputY: 0,
    facingX,
    facingY: 0,
    knockbackX: 0,
    knockbackY: 0,
    pushX: facingX,
    pushY: 0,
    pushEndsAt: 0,
    pushCooldownEndsAt: 0,
    braceEndsAt: 0,
    braceCooldownEndsAt: 0,
    alive: true
  };
};

const createRoundState = () => ({
  phase: "lobby",
  roundEndsAt: null,
  countdownEndsAt: null,
  playStartsAt: null,
  winnerId: null,
  winReason: null,
  players: {}
});

function getConnectedPlayers(room) {
  return [...room.players.values()]
    .filter((player) => player.connected)
    .sort((a, b) => a.slot - b.slot);
}

function isPushActive(playerState, now) {
  return playerState.pushEndsAt > now;
}

function isBraceActive(playerState, now) {
  return playerState.braceEndsAt > now;
}

function getArenaRadius(room, now) {
  if (room.round.playStartsAt == null) {
    return config.arenaRadius;
  }

  const elapsedMs = Math.max(0, now - room.round.playStartsAt);
  if (elapsedMs <= config.arenaShrinkStartMs) {
    return config.arenaRadius;
  }

  const progress = clamp(
    (elapsedMs - config.arenaShrinkStartMs) / config.arenaShrinkDurationMs,
    0,
    1
  );

  return config.arenaRadius - (config.arenaRadius - config.arenaMinRadius) * progress;
}

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
  room.round.playStartsAt = now + config.lobbyCountdownMs;
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

  if (normalized.x || normalized.y) {
    player.state.facingX = normalized.x;
    player.state.facingY = normalized.y;
  }
}

function triggerPush(player, now) {
  if (!player.state.alive || player.state.pushCooldownEndsAt > now || isBraceActive(player.state, now)) {
    return false;
  }

  const direction = normalizeInput({
    x: player.state.facingX || (player.slot === 0 ? 1 : -1),
    y: player.state.facingY || 0
  });

  player.state.pushX = direction.x || (player.slot === 0 ? 1 : -1);
  player.state.pushY = direction.y || 0;
  player.state.pushEndsAt = now + config.pushDurationMs;
  player.state.pushCooldownEndsAt = now + config.pushCooldownMs;
  return true;
}

function triggerBrace(player, now) {
  if (!player.state.alive || player.state.braceCooldownEndsAt > now || isPushActive(player.state, now)) {
    return false;
  }

  player.state.braceEndsAt = now + config.braceDurationMs;
  player.state.braceCooldownEndsAt = now + config.braceCooldownMs;
  return true;
}

function resolveCollision(playerA, playerB, now) {
  const dx = playerB.x - playerA.x;
  const dy = playerB.y - playerA.y;
  const distance = Math.hypot(dx, dy);
  const minDistance = config.playerRadius * 2;

  if (distance >= minDistance) {
    return;
  }

  const safeDistance = distance || 0.001;
  const normalX = distance ? dx / safeDistance : 1;
  const normalY = distance ? dy / safeDistance : 0;
  const overlap = minDistance - safeDistance;

  playerA.x -= normalX * overlap * 0.5;
  playerA.y -= normalY * overlap * 0.5;
  playerB.x += normalX * overlap * 0.5;
  playerB.y += normalY * overlap * 0.5;

  const relativeVelocityX = playerB.vx - playerA.vx;
  const relativeVelocityY = playerB.vy - playerA.vy;
  const impactSpeed = relativeVelocityX * normalX + relativeVelocityY * normalY;
  const sharedImpulse = Math.max(
    config.baseCollisionImpulse,
    Math.abs(impactSpeed) * 0.75 + config.baseCollisionImpulse
  );
  const aPushBonus = isPushActive(playerA, now) ? config.pushCollisionImpulse : 0;
  const bPushBonus = isPushActive(playerB, now) ? config.pushCollisionImpulse : 0;
  const aBraceMultiplier = isBraceActive(playerA, now) ? config.braceKnockbackMultiplier : 1;
  const bBraceMultiplier = isBraceActive(playerB, now) ? config.braceKnockbackMultiplier : 1;

  playerA.knockbackX -= normalX * (sharedImpulse + bPushBonus) * aBraceMultiplier;
  playerA.knockbackY -= normalY * (sharedImpulse + bPushBonus) * aBraceMultiplier;
  playerB.knockbackX += normalX * (sharedImpulse + aPushBonus) * bBraceMultiplier;
  playerB.knockbackY += normalY * (sharedImpulse + aPushBonus) * bBraceMultiplier;
}

function updatePhysics(room, now, deltaSeconds) {
  const activePlayers = [...room.players.values()].filter((player) => player.state.alive);
  const arenaRadius = getArenaRadius(room, now);

  for (const player of activePlayers) {
    const knockbackDecay = Math.max(0, 1 - config.knockbackDragPerSecond * deltaSeconds);
    player.state.knockbackX *= knockbackDecay;
    player.state.knockbackY *= knockbackDecay;

    const bracing = isBraceActive(player.state, now);
    const dashVx = isPushActive(player.state, now) ? player.state.pushX * config.pushBoostSpeed : 0;
    const dashVy = isPushActive(player.state, now) ? player.state.pushY * config.pushBoostSpeed : 0;
    const moveSpeed = bracing ? 0 : config.playerSpeed;

    player.state.vx = player.state.inputX * moveSpeed + dashVx + player.state.knockbackX;
    player.state.vy = player.state.inputY * moveSpeed + dashVy + player.state.knockbackY;
    player.state.x += player.state.vx * deltaSeconds;
    player.state.y += player.state.vy * deltaSeconds;
  }

  if (activePlayers.length === 2) {
    resolveCollision(activePlayers[0].state, activePlayers[1].state, now);
  }

  for (const player of activePlayers) {
    if (vectorLength(player.state) > arenaRadius) {
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

function isPublicRoom(room) {
  return room.round.phase === "lobby" && getConnectedPlayers(room).length === 1;
}

function serializePublicRoom(room) {
  const [host] = getConnectedPlayers(room);

  return {
    roomId: room.id,
    hostName: host?.name || "Host",
    playerCount: getConnectedPlayers(room).length,
    maxPlayers: config.maxPlayersPerRoom,
    phase: room.round.phase
  };
}

function tickRoom(room, now, deltaSeconds) {
  if (room.round.phase === "countdown" && room.round.countdownEndsAt && now >= room.round.countdownEndsAt) {
    startRound(room);
  }

  if (room.round.phase !== "playing") {
    return null;
  }

  updatePhysics(room, now, deltaSeconds);

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
  const arenaRadius = getArenaRadius(room, now);

  return {
    roomId: room.id,
    phase: room.round.phase,
    winnerId: room.round.winnerId,
    winReason: room.round.winReason,
    remainingMs: getRemainingTimeMs(room, now),
    arena: {
      radius: Number(arenaRadius.toFixed(2)),
      baseRadius: config.arenaRadius,
      minRadius: config.arenaMinRadius,
      shrinking: arenaRadius < config.arenaRadius
    },
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
          facingX: Number(player.state.facingX.toFixed(3)),
          facingY: Number(player.state.facingY.toFixed(3)),
          isPushing: isPushActive(player.state, now),
          pushRemainingMs: Math.max(0, player.state.pushEndsAt - now),
          pushCooldownRemainingMs: Math.max(0, player.state.pushCooldownEndsAt - now),
          isBracing: isBraceActive(player.state, now),
          braceRemainingMs: Math.max(0, player.state.braceEndsAt - now),
          braceCooldownRemainingMs: Math.max(0, player.state.braceCooldownEndsAt - now),
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
    lastTickAt: Date.now(),
    createdAt: Date.now()
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
  getArenaRadius,
  getConnectedPlayers,
  isBraceActive,
  isPublicRoom,
  isPushActive,
  normalizeInput,
  resetRound,
  serializePublicRoom,
  serializeRoom,
  tickRoom,
  triggerBrace,
  triggerPush
};
