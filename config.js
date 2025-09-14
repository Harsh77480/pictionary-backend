require('dotenv').config();

module.exports = {
  PORT: parseInt(process.env.PORT || '4000', 10),
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',

  MAX_GAMES: parseInt(process.env.MAX_GAMES || '5', 10),
  MAX_USERS_PER_GAME: parseInt(process.env.MAX_USERS_PER_GAME || '4', 10),
  DRAW_TURNS_PER_PLAYER: parseInt(process.env.DRAW_TURNS_PER_PLAYER || '4', 10),

  GAME_TTL_MS: parseInt(process.env.GAME_TTL_MS || String(6 * 60 * 1000), 10), // destroy if empty / TTL
  ROUND_DURATION_MS: parseInt(process.env.ROUND_DURATION_MS || String(60 * 1000), 10), // default 60s per round

  // Canvas validation (must match frontend)
  CANVAS_WIDTH: parseInt(process.env.CANVAS_WIDTH || '800', 10),
  CANVAS_HEIGHT: parseInt(process.env.CANVAS_HEIGHT || '600', 10),

  MAX_POINTS_PER_BATCH: parseInt(process.env.MAX_POINTS_PER_BATCH || '200', 10),
  MIN_POINT_COUNT: parseInt(process.env.MIN_POINT_COUNT || '1', 10),
  MAX_SIZE: parseInt(process.env.MAX_SIZE || '40', 10),

  // scoring
  POINTS_GUESSER: parseInt(process.env.POINTS_GUESSER || '10', 10),
  POINTS_DRAWER: parseInt(process.env.POINTS_DRAWER || '5', 10)
};
