module.exports = {
  port: Number(process.env.PORT || 3000),
  arenaRadius: 180,
  playerRadius: 18,
  playerSpeed: 240,
  pushBoostSpeed: 340,
  pushDurationMs: 180,
  pushCooldownMs: 900,
  pushCollisionImpulse: 180,
  baseCollisionImpulse: 95,
  knockbackDragPerSecond: 4.4,
  tickRate: 30,
  roundDurationMs: 35000,
  lobbyCountdownMs: 3000,
  rematchWaitMs: 10000,
  broadcastRate: 30,
  maxPlayersPerRoom: 2
};
