/**
 * Popup Dashboard Controller for ChatGPT Computer-Use Extension
 */

let state = {
  connectionState: { connected: false, authenticated: false },
  config: {
    serverUrl: 'ws://localhost:3000/ws',
    secretToken: 'secret_computer_use_token_2026',
    targetTabId: null,
    isHalted: false,
    autoSubmit: true,
  },
  logs: [],
};

// DOM Elements
const connectionBadge = document.getElementById('connectionBadge');
const connectionText = document.getElementById('connectionText');
const haltBanner = document.getElementById('haltBanner');
const resumeBtn = document.getElementById('resumeBtn');
const startChatBtn = document.getElementById('startChatBtn');
const emergencyHaltBtn = document.getElementById('emergencyHaltBtn');
const tabSelect = document.getElementById('tabSelect');
const refreshTabsBtn = document.getElementById('refreshTabsBtn');
const newTabBtn = document.getElementById('newTabBtn');
const logContainer = document.getElementById('logContainer');
const logCounter = document.getElementById('logCounter');
const toggleSettingsBtn = document.getElementById('toggleSettingsBtn');
const settingsCaret = document.getElementById('settingsCaret');
const settingsPanel = document.getElementById('settingsPanel');
const serverUrlInput = document.getElementById('serverUrlInput');
const secretTokenInput = document.getElementById('secretTokenInput');
const autoSubmitCheck = document.getElementById('autoSubmitCheck');
const saveConfigBtn = document.getElementById('saveConfigBtn');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadState();
  await loadTabs();
  setupEventListeners();
  setupRuntimeListener();
});

/**
 * Load initial state from storage & background worker
 */
async function loadState() {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (response) {
      state.connectionState = response.connectionState || state.connectionState;
      state.config = { ...state.config, ...response.config };
      renderUI();
    }
  });

  chrome.storage.local.get(['serverUrl', 'secretToken', 'autoSubmit', 'isHalted', 'targetTabId'], (stored) => {
    if (stored.serverUrl) state.config.serverUrl = stored.serverUrl;
    if (stored.secretToken) state.config.secretToken = stored.secretToken;
    if (stored.autoSubmit !== undefined) state.config.autoSubmit = stored.autoSubmit;
    if (stored.isHalted !== undefined) state.config.isHalted = stored.isHalted;
    if (stored.targetTabId) state.config.targetTabId = stored.targetTabId;

    serverUrlInput.value = state.config.serverUrl;
    secretTokenInput.value = state.config.secretToken;
    autoSubmitCheck.checked = state.config.autoSubmit;

    renderUI();
  });
}

/**
 * Render visual UI elements based on current state
 */
function renderUI() {
  // Connection Badge
  if (state.connectionState.connected && state.connectionState.authenticated) {
    connectionBadge.className = 'badge badge-connected';
    connectionText.textContent = 'Connected 🟢';
  } else if (state.connectionState.connected && !state.connectionState.authenticated) {
    connectionBadge.className = 'badge badge-disconnected';
    connectionText.textContent = 'Auth Failed ⚠️';
  } else {
    connectionBadge.className = 'badge badge-disconnected';
    connectionText.textContent = 'Offline 🔴';
  }

  // Emergency Halt Banner
  if (state.config.isHalted) {
    haltBanner.classList.remove('hidden');
    emergencyHaltBtn.textContent = 'Resume Loop';
    emergencyHaltBtn.className = 'btn btn-secondary';
  } else {
    haltBanner.classList.add('hidden');
    emergencyHaltBtn.innerHTML = '<span class="icon">🛑</span><span>Killswitch</span>';
    emergencyHaltBtn.className = 'btn btn-danger';
  }
}

/**
 * Load open browser tabs into the selector dropdown
 */
async function loadTabs() {
  tabSelect.innerHTML = '<option value="">Scanning tabs...</option>';

  const tabs = await chrome.tabs.query({});
  tabSelect.innerHTML = '';

  const validTabs = tabs.filter((t) => t.id && t.url && !t.url.startsWith('chrome://'));

  if (validTabs.length === 0) {
    tabSelect.innerHTML = '<option value="">No open webpage tabs</option>';
    return;
  }

  for (const t of validTabs) {
    const opt = document.createElement('option');
    opt.value = t.id.toString();
    const isGpt = t.url.includes('chatgpt.com');
    opt.textContent = `${isGpt ? '💬 [ChatGPT] ' : '🌐 '}${t.title ? t.title.slice(0, 32) : t.url.slice(0, 32)}`;
    if (t.id === state.config.targetTabId) {
      opt.selected = true;
    }
    tabSelect.appendChild(opt);
  }
}

/**
 * Append activity log item
 */
function addLog(message, type = 'info') {
  const empty = logContainer.querySelector('.log-empty');
  if (empty) empty.remove();

  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const logEl = document.createElement('div');
  logEl.className = `log-item ${type}`;
  logEl.textContent = `[${time}] ${message}`;

  logContainer.appendChild(logEl);
  logContainer.scrollTop = logContainer.scrollHeight;

  state.logs.push({ time, message, type });
  logCounter.textContent = `${state.logs.length} events`;
}

/**
 * Setup event listeners for UI buttons
 */
function setupEventListeners() {
  // Tab Selector Change
  tabSelect.addEventListener('change', (e) => {
    const selectedTabId = parseInt(e.target.value, 10);
    if (!isNaN(selectedTabId)) {
      state.config.targetTabId = selectedTabId;
      chrome.storage.local.set({ targetTabId: selectedTabId });
      chrome.runtime.sendMessage({ type: 'SET_TARGET_TAB', tabId: selectedTabId });
      addLog(`Target tab switched to ID: ${selectedTabId}`, 'info');
    }
  });

  // Refresh Tabs
  refreshTabsBtn.addEventListener('click', async () => {
    await loadTabs();
    addLog('Refreshed browser tabs list', 'info');
  });

  // Create New Tab
  newTabBtn.addEventListener('click', async () => {
    const newTab = await chrome.tabs.create({ url: 'https://www.google.com' });
    state.config.targetTabId = newTab.id;
    chrome.storage.local.set({ targetTabId: newTab.id });
    chrome.runtime.sendMessage({ type: 'SET_TARGET_TAB', tabId: newTab.id });
    await loadTabs();
    addLog(`Created new controlled tab: Google`, 'success');
  });

  // Start Agent Chat
  startChatBtn.addEventListener('click', async () => {
    // Check if ChatGPT is already open
    const gptTabs = await chrome.tabs.query({ url: '*://*.chatgpt.com/*' });
    if (gptTabs.length > 0) {
      chrome.tabs.update(gptTabs[0].id, { active: true });
      chrome.windows.update(gptTabs[0].windowId, { focused: true });
      addLog('Focused existing ChatGPT tab', 'info');
    } else {
      chrome.tabs.create({ url: 'https://chatgpt.com' });
      addLog('Opened new ChatGPT tab', 'info');
    }
  });

  // Killswitch / Emergency Halt
  emergencyHaltBtn.addEventListener('click', toggleEmergencyHalt);
  resumeBtn.addEventListener('click', toggleEmergencyHalt);

  // Settings Drawer Toggle
  toggleSettingsBtn.addEventListener('click', () => {
    const isHidden = settingsPanel.classList.toggle('hidden');
    settingsCaret.textContent = isHidden ? '▼' : '▲';
  });

  // Save Settings
  saveConfigBtn.addEventListener('click', () => {
    const newUrl = serverUrlInput.value.trim();
    const newToken = secretTokenInput.value.trim();
    const newAutoSubmit = autoSubmitCheck.checked;

    state.config.serverUrl = newUrl;
    state.config.secretToken = newToken;
    state.config.autoSubmit = newAutoSubmit;

    chrome.storage.local.set({
      serverUrl: newUrl,
      secretToken: newToken,
      autoSubmit: newAutoSubmit,
    });

    chrome.runtime.sendMessage({ type: 'RECONNECT' });
    addLog('Saved settings & triggered reconnect', 'success');
    settingsPanel.classList.add('hidden');
    settingsCaret.textContent = '▼';
  });
}

function toggleEmergencyHalt() {
  const newHaltState = !state.config.isHalted;
  state.config.isHalted = newHaltState;
  chrome.storage.local.set({ isHalted: newHaltState });
  chrome.runtime.sendMessage({ type: 'TRIGGER_HALT', halt: newHaltState });
  renderUI();
  addLog(newHaltState ? '🚨 EMERGENCY HALT TRIGGERED' : 'Resumed Agent execution', newHaltState ? 'error' : 'success');
}

/**
 * Listen for runtime messages from background script
 */
function setupRuntimeListener() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'WS_STATUS_CHANGE') {
      state.connectionState = msg.state;
      renderUI();
    } else if (msg.type === 'HALT_STATE_CHANGE') {
      state.config.isHalted = msg.isHalted;
      renderUI();
    }
  });
}
