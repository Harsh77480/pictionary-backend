// redisClient.js
const { createClient } = require('redis');

const REDIS_URL = process.env.REDIS_URL || null;

let client = null;
let redisConnected = false;

if (REDIS_URL) {
  client = createClient({ url: REDIS_URL });

  client.on('error', (err) => {
    redisConnected = false;
    console.error('Redis Client Error', err);
  });

  (async () => {
    try {
      await client.connect();
      redisConnected = true;
      console.log('✅ Connected to Redis');
    } catch (err) {
      redisConnected = false;
      console.warn('⚠️ Redis connect failed, continuing without Redis:', err.message);
    }
  })();
} else {
  console.warn('⚠️ REDIS_URL not set — running without Redis. Scoring will be in-memory only.');
}

module.exports = {
  client,
  redisConnected: () => redisConnected
};
