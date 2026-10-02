import { v4 as uuidv4 } from 'uuid';

/**
 * In-memory Session & Task Store for ChatGPT Computer-Use Relay
 */
class SessionStore {
  constructor() {
    this.sessions = new Map();
    this.logs = [];
    this.maxLogs = 200;
    this.isHalted = false;
  }

  /**
   * Get or create a session by ID
   */
  getOrCreateSession(sessionId = 'default') {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        id: sessionId,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        currentAction: null,
        pendingActions: [],
        completedActions: [],
        targetTabId: null,
        isHalted: false,
      });
      this.addLog(`Session initialized: ${sessionId}`, 'info');
    }
    return this.sessions.get(sessionId);
  }

  /**
   * Set the current target tab ID for a session
   */
  setTargetTab(sessionId, tabId) {
    const session = this.getOrCreateSession(sessionId);
    session.targetTabId = tabId;
    session.lastActivity = new Date().toISOString();
    this.addLog(`Session [${sessionId}] target tab set to: ${tabId}`, 'info');
  }

  /**
   * Queue an action to be executed by the browser
   */
  queueAction(sessionId, actionPayload) {
    const session = this.getOrCreateSession(sessionId);
    if (this.isHalted || session.isHalted) {
      this.addLog(`Blocked action due to Emergency Halt state`, 'warn');
      throw new Error('EMERGENCY_HALT_ACTIVE');
    }

    const actionItem = {
      actionId: actionPayload.actionId || uuidv4(),
      payload: actionPayload,
      status: 'pending',
      queuedAt: new Date().toISOString(),
    };

    session.pendingActions.push(actionItem);
    session.lastActivity = new Date().toISOString();
    this.addLog(`Action queued [${actionItem.actionId}]: ${actionPayload.action || 'unknown'}`, 'info');
    return actionItem;
  }

  /**
   * Mark an action as active/in-progress
   */
  startAction(sessionId, actionId) {
    const session = this.getOrCreateSession(sessionId);
    const index = session.pendingActions.findIndex((a) => a.actionId === actionId);
    if (index !== -1) {
      const [action] = session.pendingActions.splice(index, 1);
      action.status = 'in_progress';
      action.startedAt = new Date().toISOString();
      session.currentAction = action;
      return action;
    }
    return null;
  }

  /**
   * Resolve an action with execution results (DOM, URL, status, error)
   */
  resolveAction(sessionId, actionId, result) {
    const session = this.getOrCreateSession(sessionId);
    const action = session.currentAction && session.currentAction.actionId === actionId
      ? session.currentAction
      : { actionId, payload: {}, status: 'unknown' };

    action.status = result.status || 'success';
    action.completedAt = new Date().toISOString();
    action.result = result;

    session.completedActions.push(action);
    session.currentAction = null;
    session.lastActivity = new Date().toISOString();

    if (session.completedActions.length > 50) {
      session.completedActions.shift();
    }

    this.addLog(`Action completed [${actionId}]: ${action.status}`, action.status === 'error' ? 'error' : 'info');
    return action;
  }

  /**
   * Trigger emergency halt (Kill switch)
   */
  setEmergencyHalt(halted = true, sessionId = null) {
    if (sessionId) {
      const session = this.getOrCreateSession(sessionId);
      session.isHalted = halted;
      session.pendingActions = [];
      session.currentAction = null;
    } else {
      this.isHalted = halted;
      for (const session of this.sessions.values()) {
        session.isHalted = halted;
        session.pendingActions = [];
        session.currentAction = null;
      }
    }
    this.addLog(`🚨 Emergency Halt set to: ${halted}`, halted ? 'warn' : 'info');
  }

  /**
   * Add a system log entry
   */
  addLog(message, level = 'info') {
    const entry = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      level,
      message,
    };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    console.log(`[${entry.timestamp}] [${level.toUpperCase()}] ${message}`);
    return entry;
  }

  /**
   * Get formatted status snapshot
   */
  getStatus() {
    return {
      isHalted: this.isHalted,
      totalSessions: this.sessions.size,
      activeSessions: Array.from(this.sessions.values()).map((s) => ({
        id: s.id,
        targetTabId: s.targetTabId,
        pendingCount: s.pendingActions.length,
        hasCurrentAction: !!s.currentAction,
        isHalted: s.isHalted,
        lastActivity: s.lastActivity,
      })),
      recentLogs: this.logs.slice(-25),
    };
  }
}

export const sessionStore = new SessionStore();
