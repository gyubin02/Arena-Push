const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyInput,
  beginCountdown,
  createPlayer,
  createRoom,
  determineTimeoutWinner,
  finishRound,
  getArenaRadius,
  isPublicRoom,
  isPushActive,
  normalizeInput,
  serializePublicRoom,
  serializeRoom,
  tickRoom,
  triggerBrace,
  triggerPush
} = require("../src/game");

test("normalizeInput clamps diagonal input to unit length", () => {
  const result = normalizeInput({ x: 1, y: 1 });
  assert.ok(result.x < 1);
  assert.ok(result.y < 1);
  assert.ok(Math.abs(Math.hypot(result.x, result.y) - 1) < 0.0001);
});

test("tickRoom awards ring out winner when one player leaves arena", () => {
  const room = createRoom("TEST");
  const socket = { readyState: 1, OPEN: 1 };
  const a = createPlayer("a", "A", socket, 0);
  const b = createPlayer("b", "B", socket, 1);
  room.players.set(a.id, a);
  room.players.set(b.id, b);

  beginCountdown(room, 0);
  room.round.phase = "playing";
  a.state.x = 200;
  a.state.y = 0;
  b.state.x = 0;
  b.state.y = 0;

  const result = tickRoom(room, 1, 1 / 30);
  assert.equal(result.winnerId, "b");
  assert.equal(result.reason, "ring_out");
});

test("determineTimeoutWinner picks player closest to center", () => {
  const room = createRoom("TIME");
  const socket = { readyState: 1, OPEN: 1 };
  const a = createPlayer("a", "A", socket, 0);
  const b = createPlayer("b", "B", socket, 1);
  room.players.set(a.id, a);
  room.players.set(b.id, b);
  a.state.x = 10;
  b.state.x = 100;

  const result = determineTimeoutWinner(room);
  assert.equal(result.winnerId, "a");
  assert.equal(result.reason, "center_control");
});

test("applyInput updates player movement vector", () => {
  const player = createPlayer("a", "A", null, 0);
  applyInput(player, { x: 0.5, y: 0.5 });
  assert.ok(player.state.inputX > 0);
  assert.ok(player.state.inputY > 0);
});

test("finishRound stores winner metadata", () => {
  const room = createRoom("END");
  finishRound(room, "a", "ring_out");
  assert.equal(room.round.phase, "finished");
  assert.equal(room.round.winnerId, "a");
  assert.equal(room.round.winReason, "ring_out");
});

test("single-player lobby room is discoverable in public room list", () => {
  const room = createRoom("OPEN");
  const socket = { readyState: 1, OPEN: 1 };
  const host = createPlayer("host", "Host", socket, 0);
  room.players.set(host.id, host);

  assert.equal(isPublicRoom(room), true);
  assert.deepEqual(serializePublicRoom(room), {
    roomId: "OPEN",
    hostName: "Host",
    playerCount: 1,
    maxPlayers: 2,
    phase: "lobby"
  });
});

test("countdown rooms are hidden from public room list", () => {
  const room = createRoom("HIDE");
  const socket = { readyState: 1, OPEN: 1 };
  const host = createPlayer("host", "Host", socket, 0);
  room.players.set(host.id, host);

  beginCountdown(room, Date.now());
  assert.equal(isPublicRoom(room), false);
});

test("triggerPush enables temporary push state and cooldown", () => {
  const player = createPlayer("a", "A", null, 0);
  const now = 1000;

  assert.equal(triggerPush(player, now), true);
  assert.equal(isPushActive(player.state, now + 20), true);
  assert.equal(player.state.pushCooldownEndsAt > now, true);
  assert.equal(triggerPush(player, now + 10), false);
});

test("triggerBrace enables temporary brace state and blocks push", () => {
  const player = createPlayer("a", "A", null, 0);
  const now = 1000;

  assert.equal(triggerBrace(player, now), true);
  assert.equal(player.state.braceEndsAt > now, true);
  assert.equal(player.state.braceCooldownEndsAt > now, true);
  assert.equal(triggerPush(player, now + 20), false);
  assert.equal(triggerBrace(player, now + 20), false);
});

test("serializeRoom includes push metadata for clients", () => {
  const room = createRoom("PUSH");
  const socket = { readyState: 1, OPEN: 1 };
  const player = createPlayer("a", "A", socket, 0);
  room.players.set(player.id, player);
  triggerPush(player, 1000);

  const snapshot = serializeRoom(room, 1050);
  assert.equal(snapshot.players[0].state.isPushing, true);
  assert.ok(snapshot.players[0].state.pushRemainingMs > 0);
  assert.ok(snapshot.players[0].state.pushCooldownRemainingMs > 0);
});

test("serializeRoom includes brace and arena metadata for clients", () => {
  const room = createRoom("BRCE");
  const socket = { readyState: 1, OPEN: 1 };
  const player = createPlayer("a", "A", socket, 0);
  room.players.set(player.id, player);
  room.round.playStartsAt = 0;
  triggerBrace(player, 12500);

  const snapshot = serializeRoom(room, 13000);
  assert.equal(snapshot.arena.shrinking, true);
  assert.ok(snapshot.arena.radius < snapshot.arena.baseRadius);
  assert.equal(snapshot.players[0].state.isBracing, false);
  assert.ok(snapshot.players[0].state.braceCooldownRemainingMs > 0);
});

test("tickRoom uses shrinking arena radius for ring outs", () => {
  const room = createRoom("SHRK");
  const socket = { readyState: 1, OPEN: 1 };
  const a = createPlayer("a", "A", socket, 0);
  const b = createPlayer("b", "B", socket, 1);
  room.players.set(a.id, a);
  room.players.set(b.id, b);

  beginCountdown(room, 0);
  room.round.phase = "playing";
  room.round.playStartsAt = 0;
  a.state.x = getArenaRadius(room, 999999) + 1;
  b.state.x = 0;

  const result = tickRoom(room, 999999, 1 / 30);
  assert.equal(result.winnerId, "b");
  assert.equal(result.reason, "ring_out");
});

test("bracing prevents movement input from moving the player", () => {
  const room = createRoom("HOLD");
  const socket = { readyState: 1, OPEN: 1 };
  const a = createPlayer("a", "A", socket, 0);
  const b = createPlayer("b", "B", socket, 1);
  room.players.set(a.id, a);
  room.players.set(b.id, b);

  beginCountdown(room, 0);
  room.round.phase = "playing";
  a.state.x = -70;
  b.state.x = 70;

  triggerBrace(a, 0);
  applyInput(a, { x: 1, y: 0 });
  tickRoom(room, 100, 0.1);

  assert.equal(a.state.x, -70);
});
