/**
 * Background Service Worker for ChatGPT Computer-Use Agent (Manifest V3)
 * Fully hardened against MV3 lifecycle idle timeouts, restricted tab URLs,
 * React-controlled inputs, and WebSocket connection errors.
 */

let ws = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let keepAliveInterval = null;
const MAX_RECONNECT_DELAY = 30000;

let currentConfig = {
  serverUrl: 'ws://localhost:3000/ws',
  secretToken: 'secret_computer_use_token_2026',
  targetTabId: null,
  isHalted: false,
  autoInjectPrompt: true,
};

let connectionState = {
  connected: false,
  authenticated: false,
  status: 'disconnected', // 'disconnected' | 'connecting' | 'connected' | 'auth_failed'
  lastError: null,
  clientId: null,
};

// Initialize configuration from storage
chrome.storage.local.get(['serverUrl', 'secretToken', 'targetTabId', 'isHalted'], (stored) => {
  if (stored.serverUrl) currentConfig.serverUrl = stored.serverUrl;
  if (stored.secretToken) currentConfig.secretToken = stored.secretToken;
  if (stored.targetTabId) currentConfig.targetTabId = stored.targetTabId;
  if (stored.isHalted !== undefined) currentConfig.isHalted = stored.isHalted;

  connectWebSocket();
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes) => {
  let needsReconnect = false;
  if (changes.serverUrl && changes.serverUrl.newValue !== changes.serverUrl.oldValue) {
    currentConfig.serverUrl = changes.serverUrl.newValue;
    needsReconnect = true;
  }
  if (changes.secretToken && changes.secretToken.newValue !== changes.secretToken.oldValue) {
    currentConfig.secretToken = changes.secretToken.newValue;
    needsReconnect = true;
  }
  if (changes.targetTabId) {
    currentConfig.targetTabId = changes.targetTabId.newValue;
  }
  if (changes.isHalted) {
    currentConfig.isHalted = changes.isHalted.newValue;
  }

  if (needsReconnect) {
    reconnectWebSocket();
  }
});

/**
 * Normalize input URL to valid WebSocket protocol (ws:// or wss://)
 */
function normalizeWsUrl(rawUrl) {
  if (!rawUrl) return 'ws://localhost:3000/ws';
  let url = rawUrl.trim();
  if (url.startsWith('https://')) {
    url = 'wss://' + url.slice(8);
  } else if (url.startsWith('http://')) {
    url = 'ws://' + url.slice(7);
  } else if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    url = 'ws://' + url;
  }

  try {
    const parsed = new URL(url);
    if (!parsed.pathname || parsed.pathname === '/') {
      parsed.pathname = '/ws';
    }
    return parsed.toString();
  } catch (_) {
    return url;
  }
}

/**
 * Connect to Cloud / Local Relay Server via WebSocket
 */
function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  connectionState.status = 'connecting';

  try {
    const normalizedUrl = normalizeWsUrl(currentConfig.serverUrl);
    const urlObj = new URL(normalizedUrl);
    urlObj.searchParams.set('role', 'extension_bg');
    if (currentConfig.secretToken) {
      urlObj.searchParams.set('token', currentConfig.secretToken);
    }

    ws = new WebSocket(urlObj.toString());

    ws.onopen = () => {
      console.log('[Background] Connected to Relay Server at:', normalizedUrl);
      connectionState.connected = true;
      connectionState.status = 'connected';
      connectionState.lastError = null;
      reconnectAttempts = 0;
      updateBadge('ON', '#22c55e');

      // Send Authentication
      sendWsMessage({
        type: 'AUTH',
        role: 'extension_bg',
        token: currentConfig.secretToken,
      });

      startKeepAlive();
      broadcastToPopup({ type: 'WS_STATUS_CHANGE', state: connectionState });
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        await handleServerMessage(msg);
      } catch (err) {
        console.error('[Background] Failed to parse server message:', err);
      }
    };

    ws.onclose = () => {
      stopKeepAlive();
      connectionState.connected = false;
      connectionState.authenticated = false;
      connectionState.status = 'disconnected';
      updateBadge('OFF', '#ef4444');
      broadcastToPopup({ type: 'WS_STATUS_CHANGE', state: connectionState });
      scheduleReconnect();
    };

    ws.onerror = () => {
      connectionState.lastError = 'Relay server offline or unreachable';
      connectionState.status = 'disconnected';
      broadcastToPopup({ type: 'WS_STATUS_CHANGE', state: connectionState });
    };
  } catch (e) {
    connectionState.lastError = e.message;
    connectionState.status = 'disconnected';
    scheduleReconnect();
  }
}

function startKeepAlive() {
  stopKeepAlive();
  // Send lightweight ping every 20 seconds to prevent Manifest V3 worker dormancy
  keepAliveInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      sendWsMessage({ type: 'PING' });
    }
  }, 20000);
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  const delay = Math.min(2500 * Math.pow(1.4, reconnectAttempts), MAX_RECONNECT_DELAY);
  reconnectAttempts++;
  reconnectTimer = setTimeout(connectWebSocket, delay);
}

function reconnectWebSocket() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  stopKeepAlive();
  if (ws) {
    try {
      ws.close();
    } catch (_) {}
    ws = null;
  }
  reconnectAttempts = 0;
  connectWebSocket();
}

function sendWsMessage(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
    return true;
  }
  return false;
}

/**
 * Handle incoming server messages & command routing
 */
async function handleServerMessage(msg) {
  switch (msg.type) {
    case 'INIT_ACK':
      connectionState.clientId = msg.clientId;
      break;

    case 'AUTH_RESULT':
      connectionState.authenticated = msg.success;
      if (msg.success) {
        connectionState.status = 'connected';
        updateBadge('READY', '#38bdf8');
      } else {
        connectionState.status = 'auth_failed';
        updateBadge('AUTH', '#f59e0b');
        connectionState.lastError = msg.message;
      }
      broadcastToPopup({ type: 'WS_STATUS_CHANGE', state: connectionState });
      break;

    case 'EXECUTE_ACTION': {
      const { sessionId, actionId, action } = msg;
      updateBadge('BUSY', '#a855f7');

      try {
        const result = await executeBrowserAction(action);
        sendWsMessage({
          type: 'ACTION_RESULT',
          sessionId,
          actionId,
          result,
        });
        updateBadge('READY', '#38bdf8');
      } catch (err) {
        sendWsMessage({
          type: 'ACTION_RESULT',
          sessionId,
          actionId,
          result: {
            status: 'error',
            error_message: err.message,
            current_url: null,
            interactive_elements: [],
          },
        });
        updateBadge('ERR', '#ef4444');
      }
      break;
    }

    case 'EMERGENCY_STOP_STATE':
      currentConfig.isHalted = msg.isHalted;
      chrome.storage.local.set({ isHalted: msg.isHalted });
      if (msg.isHalted) {
        updateBadge('HALT', '#ef4444');
      } else {
        updateBadge('READY', '#38bdf8');
      }
      broadcastToPopup({ type: 'HALT_STATE_CHANGE', isHalted: msg.isHalted });
      break;
  }
}

/**
 * Execute an action on the active target tab
 */
async function executeBrowserAction(action) {
  if (currentConfig.isHalted) {
    throw new Error('EMERGENCY_HALT: Action execution blocked by kill switch.');
  }

  const tab = await getOrCreateTargetTab();
  if (!tab || !tab.id) {
    throw new Error('No target browser tab found or selected.');
  }

  // Guard against restricted chrome:// or internal URLs
  if (isRestrictedUrl(tab.url)) {
    if (action.action === 'navigate' && action.url) {
      // Proceed with navigation to valid URL
    } else {
      await chrome.tabs.update(tab.id, { url: 'https://www.google.com' });
      await waitForTabComplete(tab.id);
    }
  }

  // Handle navigate action
  if (action.action === 'navigate') {
    let targetUrl = action.url;
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl;
    }

    await chrome.tabs.update(tab.id, { url: targetUrl });
    await waitForTabComplete(tab.id);
    await new Promise((r) => setTimeout(r, 1000)); // Allow hydration
    return await extractTabState(tab.id);
  }

  // Handle wait action
  if (action.action === 'wait') {
    const seconds = Math.min(Math.max(action.seconds || 2, 1), 30);
    await new Promise((r) => setTimeout(r, seconds * 1000));
    return await extractTabState(tab.id);
  }

  // Handle done action
  if (action.action === 'done') {
    return {
      status: 'success',
      action_executed: 'done',
      summary: action.summary || 'Task completed successfully',
      current_url: tab.url,
      interactive_elements: [],
    };
  }

  // Handle ask_user action
  if (action.action === 'ask_user') {
    return {
      status: 'paused',
      action_executed: 'ask_user',
      question: action.question,
      current_url: tab.url,
      interactive_elements: [],
    };
  }

  // Handle in-page interactions: click, type, scroll, extract_dom
  const executionResults = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: inPageActionRunner,
    args: [action],
  });

  const response = executionResults?.[0]?.result || { status: 'error', error_message: 'No result from page script' };

  // Wait brief moment for dynamic renders then extract updated DOM state
  await new Promise((r) => setTimeout(r, 800));
  const updatedState = await extractTabState(tab.id);

  return {
    ...response,
    ...updatedState,
  };
}

function isRestrictedUrl(url) {
  if (!url) return true;
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('view-source:')
  );
}

/**
 * In-page runner function (injected directly into target tab)
 */
function inPageActionRunner(action) {
  try {
    function findTargetElement() {
      if (action.element_id !== undefined && action.element_id !== null) {
        const el = document.querySelector(`[data-agent-id="${action.element_id}"]`);
        if (el) return el;
      }
      if (action.selector) {
        try {
          const el = document.querySelector(action.selector);
          if (el) return el;
        } catch (_) {}
      }
      return null;
    }

    function showActionIndicator(el, color = '#38bdf8') {
      const rect = el.getBoundingClientRect();
      const indicator = document.createElement('div');
      indicator.style.position = 'fixed';
      indicator.style.left = `${rect.left + window.scrollX}px`;
      indicator.style.top = `${rect.top + window.scrollY}px`;
      indicator.style.width = `${Math.max(rect.width, 24)}px`;
      indicator.style.height = `${Math.max(rect.height, 24)}px`;
      indicator.style.border = `3px solid ${color}`;
      indicator.style.borderRadius = '6px';
      indicator.style.boxShadow = `0 0 15px ${color}`;
      indicator.style.pointerEvents = 'none';
      indicator.style.zIndex = '2147483647';
      indicator.style.transition = 'all 0.3s ease-out';
      document.body.appendChild(indicator);

      setTimeout(() => {
        indicator.style.opacity = '0';
        indicator.style.transform = 'scale(1.2)';
        setTimeout(() => indicator.remove(), 300);
      }, 700);
    }

    if (action.action === 'click') {
      const el = findTargetElement();
      if (!el) {
        return { status: 'error', error_message: `Element not found for id [${action.element_id}] or selector "${action.selector}"` };
      }

      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      showActionIndicator(el, '#ef4444');

      el.focus();
      const mouseEvents = ['mouseenter', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
      mouseEvents.forEach((type) => {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });

      return { status: 'success', action_executed: 'click', target_tag: el.tagName.toLowerCase() };
    }

    if (action.action === 'type') {
      const el = findTargetElement();
      if (!el) {
        return { status: 'error', error_message: `Input element not found for id [${action.element_id}]` };
      }

      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      showActionIndicator(el, '#38bdf8');
      el.focus();

      const textToType = action.text !== undefined ? String(action.text) : '';
      const isContentEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';

      if ('value' in el && !isContentEditable) {
        // Use native setter for React 18+ controlled input support
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
                             Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        
        if (action.clear_first !== false) {
          if (nativeSetter) nativeSetter.call(el, '');
          else el.value = '';
        }

        if (nativeSetter) {
          nativeSetter.call(el, (el.value || '') + textToType);
        } else {
          el.value = (el.value || '') + textToType;
        }
      } else {
        if (action.clear_first !== false) el.innerText = '';
        el.innerText = (el.innerText || '') + textToType;
      }

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));

      if (action.press_enter) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));

        const form = el.closest('form');
        if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }

      return { status: 'success', action_executed: 'type', text_entered: textToType };
    }

    if (action.action === 'scroll') {
      const dir = action.direction === 'up' ? -1 : 1;
      const amt = (action.amount || 500) * dir;
      window.scrollBy({ top: amt, left: 0, behavior: 'smooth' });
      return { status: 'success', action_executed: 'scroll', scrolled_by: amt };
    }

    return { status: 'success', action_executed: action.action || 'inspect' };
  } catch (err) {
    return { status: 'error', error_message: err.message };
  }
}

/**
 * Extract compact accessibility tree & DOM from target tab
 */
async function extractTabState(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractCompactDom,
    });

    const state = results?.[0]?.result || {};
    const tab = await chrome.tabs.get(tabId);

    return {
      status: 'success',
      current_url: tab.url,
      page_title: tab.title,
      interactive_elements: state.elements || [],
    };
  } catch (err) {
    return {
      status: 'error',
      error_message: `Failed to extract tab state: ${err.message}`,
      interactive_elements: [],
    };
  }
}

/**
 * Script injected into page to index interactive elements
 */
function extractCompactDom() {
  const selectors = [
    'button',
    'a[href]',
    'input:not([type="hidden"])',
    'textarea',
    'select',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[onclick]',
  ];

  const candidates = Array.from(document.querySelectorAll(selectors.join(',')));
  const visibleElements = [];
  let idCounter = 1;

  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);

    if (
      rect.width === 0 ||
      rect.height === 0 ||
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0'
    ) {
      continue;
    }

    el.setAttribute('data-agent-id', idCounter.toString());

    const tag = el.tagName.toLowerCase();
    const item = {
      id: idCounter++,
      tag,
    };

    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (text) item.text = text;

    if (el.placeholder) item.placeholder = el.placeholder;
    if (el.name) item.name = el.name;
    if (el.type) item.type = el.type;
    if (el.value && tag === 'input') item.value = el.value.slice(0, 40);
    if (el.getAttribute('aria-label')) item.aria_label = el.getAttribute('aria-label');
    if (tag === 'a' && el.href && !el.href.startsWith('javascript:')) {
      item.href = el.href.slice(0, 80);
    }

    visibleElements.push(item);
    if (visibleElements.length >= 60) break;
  }

  return { elements: visibleElements };
}

/**
 * Get the currently configured target tab, or find the active tab
 */
async function getOrCreateTargetTab() {
  if (currentConfig.targetTabId) {
    try {
      const tab = await chrome.tabs.get(currentConfig.targetTabId);
      if (tab && !isRestrictedUrl(tab.url)) return tab;
    } catch (_) {
      currentConfig.targetTabId = null;
    }
  }

  // Find accessible non-ChatGPT tab
  const allTabs = await chrome.tabs.query({});
  for (const t of allTabs) {
    if (t.id && t.url && !t.url.includes('chatgpt.com') && !isRestrictedUrl(t.url)) {
      currentConfig.targetTabId = t.id;
      chrome.storage.local.set({ targetTabId: t.id });
      return t;
    }
  }

  // Fallback: create a new tab
  const newTab = await chrome.tabs.create({ url: 'https://www.google.com' });
  currentConfig.targetTabId = newTab.id;
  chrome.storage.local.set({ targetTabId: newTab.id });
  return newTab;
}

function waitForTabComplete(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (tab && tab.status === 'complete') {
        return resolve();
      }

      const listener = (id, info) => {
        if (id === tabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };

      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 10000);
    });
  });
}

function updateBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

function broadcastToPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

// Handle messages from popup UI or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_STATUS') {
    sendResponse({
      connectionState,
      config: currentConfig,
    });
    return true;
  }

  if (request.type === 'RECONNECT') {
    reconnectWebSocket();
    sendResponse({ success: true });
    return true;
  }

  if (request.type === 'TRIGGER_HALT') {
    const haltState = request.halt;
    currentConfig.isHalted = haltState;
    chrome.storage.local.set({ isHalted: haltState });
    sendWsMessage({ type: 'EMERGENCY_STOP', halt: haltState });
    sendResponse({ success: true, isHalted: haltState });
    return true;
  }

  if (request.type === 'SET_TARGET_TAB') {
    currentConfig.targetTabId = request.tabId;
    chrome.storage.local.set({ targetTabId: request.tabId });
    sendWsMessage({ type: 'SET_TARGET_TAB', tabId: request.tabId });
    sendResponse({ success: true });
    return true;
  }

  return false;
});
