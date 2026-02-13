/**
 * PM2 Ecosystem Configuration
 * Loads .env automatically for all processes
 */

const fs = require('fs');
const path = require('path');

// Load .env file into env object
function loadEnv(envPath) {
  const env = {};
  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.substring(0, idx).trim();
      const value = trimmed.substring(idx + 1).trim();
      env[key] = value;
    }
  } catch (e) {
    console.error('Failed to load .env:', e.message);
  }
  return env;
}

const envVars = loadEnv(path.join(__dirname, '.env'));

module.exports = {
  apps: [
    {
      name: 'gateway',
      script: './gateway/dist/index.js',
      cwd: '/home/omars-ai/assistant',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: { ...envVars, NODE_ENV: 'production', GATEWAY_PORT: 18789 },
      error_file: './logs/gateway-error.log',
      out_file: './logs/gateway-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'core',
      script: './core/dist/index.js',
      cwd: '/home/omars-ai/assistant',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: { ...envVars, NODE_ENV: 'production', CORE_PORT: 3002 },
      error_file: './logs/core-error.log',
      out_file: './logs/core-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'heartbeat',
      script: './heartbeat/dist/index.js',
      cwd: '/home/omars-ai/assistant',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: { ...envVars, NODE_ENV: 'production' },
      error_file: './logs/heartbeat-error.log',
      out_file: './logs/heartbeat-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'mission-control',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3003',
      cwd: '/home/omars-ai/assistant/mission-control',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: { ...envVars, NODE_ENV: 'production', PORT: 3003 },
      error_file: '../logs/mission-control-error.log',
      out_file: '../logs/mission-control-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'vision',
      script: 'python3',
      args: 'detector.py',
      cwd: '/home/omars-ai/assistant/vision',
      interpreter: 'none',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: { PYTHONUNBUFFERED: '1' },
      error_file: '../logs/vision-error.log',
      out_file: '../logs/vision-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'camera-service',
      script: './vision/camera-service.js',
      cwd: '/home/omars-ai/assistant',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      env: { ...envVars, NODE_ENV: 'production', VISION_PORT: 3004 },
      error_file: './logs/camera-service-error.log',
      out_file: './logs/camera-service-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
