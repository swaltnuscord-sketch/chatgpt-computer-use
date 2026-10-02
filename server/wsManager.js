import { WebSocket } from 'ws';
import { sessionStore } from './sessionStore.js';

export class WebSocketManager {
  constructor(secretKey = '') {
    this.secretKey = secretKey;
    this.clients = new Map(); // ws -> { id, role, sessionId, isAlive, authenticated }
    this.heartbeatInterval = null;
  }

  /**
   * Initialize the WebSocket Server instance
   */
  init(wss) {
    this.wss = wss;

    wss.on('connection', (ws, req) => {
      const url = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token') || '';
      const role = url.searchParams.get('role') || 'unknown';
      const sessionId = url.searchParams.get('sessionId') || 'default';

      // Auto-authenticate if token in URL matches
      const isAuthenticated = !this.secretKey || token === this.secretKey;

      const clientInfo = {
        id: Math.random().toString(36).substring(2, 9),
        role,
        sessionId,
        isAlive: true,
        authenticated: isAuthenticated,
        ip: req.socket.remoteAddress,
        connectedAt: new Date().toISOString(),
      };

      this.clients.set(ws, clientInfo);

      sessionStore.addLog(
        `WebSocket connected [${clientInfo.id}] (Role: ${role}, Authenticated: ${isAuthenticated})`,
        isAuthenticated ? 'info' : 'warn'
      );

      // Send initial connection acknowledgement
      this.send(ws, {
        type: 'INIT_ACK',
        clientId: clientInfo.id,
        authenticated: isAuthenticated,
        serverTime: new Date().toISOString(),
      });

      if (isAuthenticated) {
        this.broadcastStatus();
      }

      ws.on('message', (data) => this.handleMessage(ws, data));

      ws.on('pong', () => {
        const info = this.clients.get(ws);
        if (info) info.isAlive = true;
      });

      ws.on('close', (code, reason) => {
        const info = this.clients.get(ws);
        if (info) {
          sessionStore.addLog(`WebSocket closed [${info.id}] (Role: ${info.role}) code: ${code}`, 'info');
          this.clients.delete(ws);
          this.broadcastStatus();
        }
      });

      ws.on('error', (err) => {
        sessionStore.addLog(`WebSocket error: ${err.message}`, 'error');
      });
    });

    // Start 25s ping-pong keepalive interval
    this.heartbeatInterval = setInterval(() => {
      for (const [ws, info] of this.clients.entries()) {
        if (!info.isAlive) {
          sessionStore.addLog(`Terminating inactive client [${info.id}]`, 'warn');
          ws.terminate();
          this.clients.delete(ws);
          continue;
        }
        info.isAlive = false;
        ws.ping();
      }
    }, 25000);
  }

  /**
   * Handle incoming WebSocket message payloads
   */
  handleMessage(ws, rawData) {
    let msg;
    try {
      msg = JSON.parse(rawData.toString());
    } catch (e) {
      this.send(ws, { type: 'ERROR', message: 'Invalid JSON payload' });
      return;
    }

    const client = this.clients.get(ws);
    if (!client) return;

    // Handle authentication message
    if (msg.type === 'AUTH') {
      const isValid = !this.secretKey || msg.token === this.secretKey;
      client.authenticated = isValid;
      client.role = msg.role || client.role;
      client.sessionId = msg.sessionId || client.sessionId;

      this.send(ws, {
        type: 'AUTH_RESULT',
        success: isValid,
        message: isValid ? 'Authenticated successfully' : 'Invalid secret token',
      });

      sessionStore.addLog(
        `Client [${client.id}] auth attempt: ${isValid ? 'SUCCESS' : 'FAILED'} (Role: ${client.role})`,
        isValid ? 'info' : 'error'
      );

      if (isValid) this.broadcastStatus();
      return;
    }

    // Require authentication for all subsequent operations
    if (!client.authenticated) {
      this.send(ws, { type: 'ERROR', message: 'UNAUTHENTICATED: Please authenticate with secret token' });
      return;
    }

    // Process authenticated message types
    switch (msg.type) {
      case 'ACTION_REQUEST': {
        // Sent by chatgpt.com content script when ChatGPT outputs an action block
        try {
          const actionItem = sessionStore.queueAction(client.sessionId, msg.actionPayload);
          
          // Dispatch action to active extension background worker
          const dispatched = this.sendToRole('extension_bg', {
            type: 'EXECUTE_ACTION',
            sessionId: client.sessionId,
            actionId: actionItem.actionId,
            action: msg.actionPayload,
          });

          if (!dispatched) {
            sessionStore.addLog(`No active browser extension connected to execute action!`, 'warn');
            this.send(ws, {
              type: 'ACTION_FAILED',
              actionId: actionItem.actionId,
              error: 'Browser extension is not connected. Please ensure Chrome extension is active.',
            });
          } else {
            sessionStore.startAction(client.sessionId, actionItem.actionId);
          }
        } catch (err) {
          this.send(ws, {
            type: 'ACTION_FAILED',
            error: err.message,
          });
        }
        break;
      }

      case 'ACTION_RESULT': {
        // Sent by extension background script after executing the action on target website
        const { sessionId, actionId, result } = msg;
        sessionStore.resolveAction(sessionId || client.sessionId, actionId, result);

        // Relay observation back to ChatGPT UI content script
        this.sendToRole('chatgpt_ui', {
          type: 'OBSERVATION',
          sessionId: sessionId || client.sessionId,
          actionId,
          result,
        });

        this.broadcastStatus();
        break;
      }

      case 'EMERGENCY_STOP': {
        // Emergency killswitch triggered
        const haltState = msg.halt !== undefined ? msg.halt : true;
        sessionStore.setEmergencyHalt(haltState, msg.sessionId);
        
        // Notify all clients immediately
        this.broadcast({
          type: 'EMERGENCY_STOP_STATE',
          isHalted: haltState,
          triggeredBy: client.role,
        });
        break;
      }

      case 'SET_TARGET_TAB': {
        sessionStore.setTargetTab(client.sessionId, msg.tabId);
        this.broadcastStatus();
        break;
      }

      case 'GET_STATUS': {
        this.send(ws, {
          type: 'STATUS_RESPONSE',
          status: this.getAggregatedStatus(),
        });
        break;
      }

      default:
        sessionStore.addLog(`Unhandled message type: ${msg.type}`, 'warn');
        break;
    }
  }

  /**
   * Send JSON message to a single WebSocket client
   */
  send(ws, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  /**
   * Send JSON message to all clients matching a specific role
   */
  sendToRole(role, payload) {
    let sentCount = 0;
    for (const [ws, info] of this.clients.entries()) {
      if (info.role === role && info.authenticated && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
        sentCount++;
      }
    }
    return sentCount > 0;
  }

  /**
   * Broadcast message to all authenticated clients
   */
  broadcast(payload) {
    for (const [ws, info] of this.clients.entries()) {
      if (info.authenticated && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    }
  }

  /**
   * Broadcast current system status & metrics
   */
  broadcastStatus() {
    const status = this.getAggregatedStatus();
    this.broadcast({
      type: 'STATUS_UPDATE',
      status,
    });
  }

  /**
   * Get combined store and connection metrics
   */
  getAggregatedStatus() {
    const connectedRoles = {
      extension_bg: 0,
      chatgpt_ui: 0,
      popup_monitor: 0,
      other: 0,
    };

    for (const info of this.clients.values()) {
      if (info.authenticated) {
        connectedRoles[info.role] = (connectedRoles[info.role] || 0) + 1;
      }
    }

    return {
      ...sessionStore.getStatus(),
      connections: {
        total: this.clients.size,
        roles: connectedRoles,
      },
    };
  }

  /**
   * Clean up on server shutdown
   */
  destroy() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
  }
}
