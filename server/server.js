import http from 'http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import { WebSocketManager } from './wsManager.js';
import { sessionStore } from './sessionStore.js';

dotenv.config();

const PORT = process.env.PORT || 3000;
const AGENT_SECRET_KEY = process.env.AGENT_SECRET_KEY || '';

const app = express();
app.use(cors());
app.use(express.json());

// Initialize WebSocket Manager
const wsManager = new WebSocketManager(AGENT_SECRET_KEY);

// Healthcheck Route (for Railway & uptime monitoring)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    isHalted: sessionStore.isHalted,
    activeConnections: wsManager.clients.size,
  });
});

// JSON API Status endpoint
app.get('/api/status', (req, res) => {
  res.json(wsManager.getAggregatedStatus());
});

// Emergency Stop API Route
app.post('/api/emergency-stop', (req, res) => {
  const { token, halt = true, sessionId = null } = req.body;
  if (AGENT_SECRET_KEY && token !== AGENT_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }

  sessionStore.setEmergencyHalt(halt, sessionId);
  wsManager.broadcast({
    type: 'EMERGENCY_STOP_STATE',
    isHalted: halt,
    triggeredBy: 'api',
  });

  res.json({ success: true, isHalted: halt });
});

// Landing Page & Live Dashboard
app.get('/', (req, res) => {
  const status = wsManager.getAggregatedStatus();
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ChatGPT Computer-Use Relay Server</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --accent: #38bdf8;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --success: #22c55e;
      --danger: #ef4444;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 2rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100vh;
    }
    .container {
      max-width: 800px;
      width: 100%;
    }
    header {
      text-align: center;
      margin-bottom: 2rem;
    }
    h1 {
      font-size: 2rem;
      margin-bottom: 0.5rem;
      background: linear-gradient(to right, #38bdf8, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .card {
      background: var(--card-bg);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 0.8rem;
      border-radius: 9999px;
      font-weight: 600;
      font-size: 0.875rem;
      background: rgba(34, 197, 94, 0.15);
      color: var(--success);
      border: 1px solid var(--success);
    }
    .status-badge.halted {
      background: rgba(239, 68, 68, 0.15);
      color: var(--danger);
      border-color: var(--danger);
    }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1rem;
      margin-top: 1rem;
    }
    .metric-box {
      background: rgba(15, 23, 42, 0.6);
      padding: 1rem;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.05);
    }
    .metric-label {
      color: var(--text-muted);
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .metric-value {
      font-size: 1.5rem;
      font-weight: 700;
      margin-top: 0.25rem;
      color: var(--accent);
    }
    .log-box {
      background: #090d16;
      font-family: "Fira Code", monospace;
      font-size: 0.85rem;
      padding: 1rem;
      border-radius: 8px;
      height: 200px;
      overflow-y: auto;
      border: 1px solid rgba(255, 255, 255, 0.05);
      white-space: pre-wrap;
    }
    .log-item { margin-bottom: 0.3rem; }
    .log-info { color: #38bdf8; }
    .log-warn { color: #fbbf24; }
    .log-error { color: #f87171; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>ChatGPT Computer-Use Relay</h1>
      <p style="color: var(--text-muted);">WebSocket Bridge & Agent Orchestration Server</p>
      <div class="status-badge ${status.isHalted ? 'halted' : ''}">
        <span>●</span> ${status.isHalted ? 'EMERGENCY HALTED' : 'OPERATIONAL & RUNNING'}
      </div>
    </header>

    <div class="card">
      <h3 style="margin-top: 0;">Active Connections</h3>
      <div class="metrics-grid">
        <div class="metric-box">
          <div class="metric-label">Total Connected</div>
          <div class="metric-value">${status.connections.total}</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Extension Workers</div>
          <div class="metric-value">${status.connections.roles.extension_bg || 0}</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">ChatGPT UI Clients</div>
          <div class="metric-value">${status.connections.roles.chatgpt_ui || 0}</div>
        </div>
        <div class="metric-box">
          <div class="metric-label">Active Sessions</div>
          <div class="metric-value">${status.totalSessions}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-top: 0;">Live Relay Activity Logs</h3>
      <div class="log-box">
        ${status.recentLogs
          .map(
            (l) => `<div class="log-item log-${l.level}">[${new Date(l.timestamp).toLocaleTimeString()}] ${l.message}</div>`
          )
          .join('') || '<div style="color: var(--text-muted)">No logs recorded yet.</div>'}
      </div>
    </div>
  </div>
</body>
</html>
  `);
});

// Create HTTP and WebSocket Server
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Initialize WebSocket Manager
wsManager.init(wss);

// Start Server
server.listen(PORT, () => {
  sessionStore.addLog(`🚀 Relay Server running on port ${PORT}`, 'info');
  sessionStore.addLog(`WebSocket endpoint available at ws://localhost:${PORT}/ws`, 'info');
});

// Graceful Shutdown
function handleShutdown(signal) {
  sessionStore.addLog(`Received ${signal}, shutting down gracefully...`, 'warn');
  wsManager.destroy();
  server.close(() => {
    process.exit(0);
  });
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
