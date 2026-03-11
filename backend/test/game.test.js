const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyInput,
  beginCountdown,
  createPlayer,
  createRoom,
  determineTimeoutWinner,
  finishRound,
  normalizeInput,
  tickRoom
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
