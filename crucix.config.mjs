// Crucix Configuration — all settings with env var overrides

import "./apis/utils/env.mjs"; // Load .env first

export default {
  port: parseInt(process.env.PORT) || 3117,
  // Network interface to bind. Defaults to loopback so the dashboard is not
  // exposed to the local network. Set HOST=0.0.0.0 to expose it (e.g. Docker).
  host: process.env.HOST || '127.0.0.1',
  publicUrl: process.env.PUBLIC_URL || null,
  refreshIntervalMinutes: parseInt(process.env.REFRESH_INTERVAL_MINUTES) || 15,

  // Local-area intelligence panel. Defaults to the Seattle / Puget Sound area.
  // Override via LOCAL_LAT / LOCAL_LON / LOCAL_LABEL / LOCAL_RADIUS_KM in .env.
  // `civicDataset` is a keyless Socrata (data.seattle.gov) resource id used for
  // the local emergency-response feed; set LOCAL_CIVIC_DATASET='' to disable.
  local: {
    lat: parseFloat(process.env.LOCAL_LAT) || 47.6062,
    lon: parseFloat(process.env.LOCAL_LON) || -122.3321,
    label: process.env.LOCAL_LABEL || 'Seattle',
    radiusKm: parseFloat(process.env.LOCAL_RADIUS_KM) || 120,
    // Seattle Real-Time Fire 911 dispatch (keyless). Empty string disables it.
    civicHost: process.env.LOCAL_CIVIC_HOST || 'data.seattle.gov',
    civicDataset: process.env.LOCAL_CIVIC_DATASET ?? 'kzjm-xkqj',
  },

  llm: {
    provider: process.env.LLM_PROVIDER || null, // anthropic | openai | gemini | codex | openrouter | minimax | mistral | ollama | grok
    apiKey: process.env.LLM_API_KEY || null,
    model: process.env.LLM_MODEL || null,
    baseUrl: process.env.OLLAMA_BASE_URL || null,
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || null,
    chatId: process.env.TELEGRAM_CHAT_ID || null,
    botPollingInterval: parseInt(process.env.TELEGRAM_POLL_INTERVAL) || 5000,
    channels: process.env.TELEGRAM_CHANNELS || null, // Comma-separated extra channel IDs
  },

  discord: {
    botToken: process.env.DISCORD_BOT_TOKEN || null,
    channelId: process.env.DISCORD_CHANNEL_ID || null,
    guildId: process.env.DISCORD_GUILD_ID || null, // Server ID (for instant slash command registration)
    webhookUrl: process.env.DISCORD_WEBHOOK_URL || null, // Fallback: webhook-only alerts (no bot needed)
  },

  // Delta engine thresholds — override defaults from lib/delta/engine.mjs
  // Set to null to use built-in defaults
  delta: {
    thresholds: {
      numeric: {
        // Example overrides (uncomment to customize):
        // vix: 3,       // more sensitive to VIX moves
        // wti: 5,       // less sensitive to oil moves
      },
      count: {
        // urgent_posts: 3,     // need ±3 urgent posts to flag
        // thermal_total: 1000, // need ±1000 thermal detections
      },
    },
  },
};
