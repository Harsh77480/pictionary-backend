// utils/validation.js
const {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  MAX_POINTS_PER_BATCH,
  MIN_POINT_COUNT,
  MAX_SIZE
} = require('../config');

const COLOR_REGEX = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
const NAME_REGEX = /^[a-zA-Z0-9 _-]{1,20}$/; // allowed characters and length
const CHAT_MAX_LENGTH = 200;

function isNumberInRange(n, min, max) {
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
}

function isValidPoint(p) {
  if (!p || typeof p !== 'object') return false;
  return isNumberInRange(p.x, 0, CANVAS_WIDTH) && isNumberInRange(p.y, 0, CANVAS_HEIGHT);
}

function validateStrokeStart(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const { x, y, color, size } = payload;
  if (!isValidPoint({ x, y })) return false;
  if (!COLOR_REGEX.test(color)) return false;
  if (!isNumberInRange(size, 1, MAX_SIZE)) return false;
  return true;
}

function validateDrawBatch(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const { points, color, size } = payload;
  if (!Array.isArray(points)) return false;
  const count = points.length;
  if (!isNumberInRange(count, MIN_POINT_COUNT, MAX_POINTS_PER_BATCH)) return false;
  for (const p of points) {
    if (!isValidPoint(p)) return false;
  }
  if (!COLOR_REGEX.test(color)) return false;
  if (!isNumberInRange(size, 1, MAX_SIZE)) return false;
  return true;
}

function validateName(name) {
  return typeof name === 'string' && NAME_REGEX.test(name);
}

function validateChatMessage(msg) {
  return typeof msg === 'string' && msg.trim().length > 0 && msg.trim().length <= CHAT_MAX_LENGTH;
}

module.exports = {
  validateStrokeStart,
  validateDrawBatch,
  validateName,
  validateChatMessage
};
