/**
 * Content Script for ChatGPT Web Interface (chatgpt.com)
 * Monitors ChatGPT responses, extracts ```action ... ``` blocks,
 * dispatches them to the browser extension/relay, and auto-submits observations.
 */

let lastProcessedMessageText = '';
let isExecuting = false;
let ws = null;
let currentConfig = {
  serverUrl: 'ws://localhost:3000/ws',
  secretToken: 'secret_computer_use_token_2026',
  autoSubmit: true,
};

// Load configuration from extension storage
chrome.storage.local.get(['serverUrl', 'secretToken', 'autoSubmit'], (stored) => {
  if (stored.serverUrl) currentConfig.serverUrl = stored.serverUrl;
  if (stored.secretToken) currentConfig.secretToken = stored.secretToken;
  if (stored.autoSubmit !== undefined) currentConfig.autoSubmit = stored.autoSubmit;

  initRelayWebSocket();
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
 * Initialize direct WebSocket connection to Relay Hub
 */
function initRelayWebSocket() {
  try {
    const normalizedUrl = normalizeWsUrl(currentConfig.serverUrl);
    const urlObj = new URL(normalizedUrl);
    urlObj.searchParams.set('role', 'chatgpt_ui');
    if (currentConfig.secretToken) {
      urlObj.searchParams.set('token', currentConfig.secretToken);
    }

    ws = new WebSocket(urlObj.toString());

    ws.onopen = () => {
      console.log('[ChatGPT Interceptor] Connected to Relay Server at:', normalizedUrl);
      ws.send(
        JSON.stringify({
          type: 'AUTH',
          role: 'chatgpt_ui',
          token: currentConfig.secretToken,
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'OBSERVATION') {
          handleObservationReceived(msg.result);
        } else if (msg.type === 'ACTION_FAILED') {
          handleObservationReceived({
            status: 'error',
            error_message: msg.error || 'Action execution failed in browser.',
          });
        }
      } catch (e) {
        console.error('[ChatGPT Interceptor] Error handling WS message:', e);
      }
    };

    ws.onclose = () => {
      setTimeout(initRelayWebSocket, 3000);
    };
  } catch (err) {
    console.warn('[ChatGPT Interceptor] WebSocket init failed, fallback to chrome.runtime:', err);
  }
}

/**
 * Observe ChatGPT Chat DOM for completed responses
 */
function initChatObserver() {
  const observer = new MutationObserver(() => {
    checkLatestMessage();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  console.log('[ChatGPT Interceptor] Chat DOM MutationObserver active.');
  injectAgentControlPill();
}

/**
 * Check if the latest message from assistant has finished streaming and contains an action
 */
function checkLatestMessage() {
  // Check if ChatGPT is currently streaming
  const isStreaming =
    document.querySelector('button[data-testid="stop-button"]') ||
    document.querySelector('button[aria-label="Stop streaming"]') ||
    document.querySelector('.result-streaming');

  if (isStreaming || isExecuting) return;

  // Find all assistant turn containers
  const assistantMessages = document.querySelectorAll(
    '[data-message-author-role="assistant"], div[data-testid^="conversation-turn-"]:has([data-message-author-role="assistant"]), article:has([data-message-author-role="assistant"])'
  );

  if (!assistantMessages || assistantMessages.length === 0) return;

  const latestMessageEl = assistantMessages[assistantMessages.length - 1];
  const messageText = latestMessageEl.innerText || latestMessageEl.textContent || '';

  if (messageText === lastProcessedMessageText) return;

  // Match ```action { ... } ``` or ```json { ... } ``` blocks
  const actionPayload = parseActionFromText(messageText);

  if (actionPayload) {
    lastProcessedMessageText = messageText;
    isExecuting = true;
    console.log('[ChatGPT Interceptor] 🎯 Detected Action:', actionPayload);

    annotateMessageElement(latestMessageEl, '⏳ Executing Browser Action...');
    dispatchAction(actionPayload, latestMessageEl);
  }
}

/**
 * Parse JSON action block from markdown text
 */
function parseActionFromText(text) {
  // Match ```action { ... } ```
  const actionRegex = /```(?:action|json)?\s*(\{[\s\S]*?"action"[\s\S]*?\})\s*```/i;
  const match = text.match(actionRegex);

  if (match && match[1]) {
    try {
      return JSON.parse(match[1]);
    } catch (e) {
      console.warn('[ChatGPT Interceptor] Failed to parse action JSON:', match[1]);
    }
  }
  return null;
}

/**
 * Dispatch action to the Relay Server or extension background
 */
function dispatchAction(actionPayload, messageEl) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: 'ACTION_REQUEST',
        actionPayload,
      })
    );
  } else {
    // Fallback via Chrome runtime messaging
    chrome.runtime.sendMessage(
      {
        type: 'EXECUTE_PAGE_ACTION',
        action: actionPayload,
      },
      (response) => {
        handleObservationReceived(response);
      }
    );
  }
}

/**
 * Handle observation returned by the browser after executing action
 */
function handleObservationReceived(result) {
  isExecuting = false;
  console.log('[ChatGPT Interceptor] 📥 Received Observation:', result);

  if (!result) {
    result = { status: 'error', error_message: 'Empty response from browser' };
  }

  // If action was 'done', do not auto-reply
  if (result.action_executed === 'done') {
    showNotification('✅ Task completed by Agent!', '#22c55e');
    return;
  }

  // Format observation into a clean prompt text
  const observationText = formatObservationPrompt(result);

  if (currentConfig.autoSubmit) {
    injectAndSubmitPrompt(observationText);
  }
}

/**
 * Format observation data into structured markdown for ChatGPT
 */
function formatObservationPrompt(result) {
  if (result.status === 'error') {
    return `[Action Result: Error]\nError: ${result.error_message || 'Action failed'}\n\nPlease try an alternative action or recover.`;
  }

  if (result.action_executed === 'ask_user') {
    return `[Action Paused: User Confirmation Required]\nQuestion: ${result.question}\n\nPlease provide your instruction.`;
  }

  let output = `[Browser Observation]\nStatus: Success (Action: ${result.action_executed || 'update'})\n`;
  output += `Current URL: ${result.url || result.current_url || 'Unknown'}\n`;
  output += `Page Title: ${result.title || result.page_title || 'Unknown'}\n`;

  if (result.tree && result.tree.scroll) {
    output += `Scroll: ${result.tree.scroll.percent} ${result.tree.scroll.isTop ? '(Top)' : ''} ${result.tree.scroll.isBottom ? '(Bottom)' : ''}\n`;
  }

  if (result.tree && result.tree.headings && result.tree.headings.length > 0) {
    output += `\nLandmarks:\n`;
    result.tree.headings.forEach((h) => {
      output += `- [${h.level}] ${h.text}\n`;
    });
  }

  const elements = result.tree?.interactive_elements || result.interactive_elements || [];
  if (elements.length > 0) {
    output += `\nInteractive Elements:\n`;
    elements.forEach((el) => {
      let desc = `[${el.id}] <${el.tag}`;
      if (el.type) desc += ` type="${el.type}"`;
      if (el.placeholder) desc += ` placeholder="${el.placeholder}"`;
      if (el.value) desc += ` value="${el.value}"`;
      if (el.aria_label) desc += ` aria-label="${el.aria_label}"`;
      if (el.path) desc += ` path="${el.path}"`;
      desc += `>`;
      if (el.text) desc += ` ${el.text}</${el.tag}>`;
      output += `- ${desc}\n`;
    });
  } else {
    output += `\nNo interactive elements detected on current viewport.\n`;
  }

  output += `\nWhat is your next action?`;
  return output;
}

/**
 * Inject text into ChatGPT's input container and trigger send
 */
function injectAndSubmitPrompt(text) {
  // Locate ChatGPT input element (ProseMirror contenteditable or textarea)
  const inputEl =
    document.querySelector('#prompt-textarea') ||
    document.querySelector('div[contenteditable="true"]') ||
    document.querySelector('textarea[data-id="root"]');

  if (!inputEl) {
    console.error('[ChatGPT Interceptor] Could not find ChatGPT prompt input element.');
    return;
  }

  // Scroll into view & focus
  inputEl.focus();

  if (inputEl.tagName.toLowerCase() === 'textarea') {
    inputEl.value = text;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    // Contenteditable ProseMirror
    inputEl.innerHTML = `<p>${text.replace(/\n/g, '<br>')}</p>`;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Trigger Send Button
  setTimeout(() => {
    const sendButton =
      document.querySelector('button[data-testid="send-button"]') ||
      document.querySelector('button[aria-label="Send prompt"]') ||
      document.querySelector('button:has(svg path[d*="M0 0h24v24H0z"])');

    if (sendButton && !sendButton.disabled) {
      sendButton.click();
      console.log('[ChatGPT Interceptor] 🚀 Observation auto-submitted.');
    } else {
      // Fallback: Dispatch Enter key
      inputEl.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })
      );
    }
  }, 400);
}

/**
 * Add a status badge over the assistant's message in the UI
 */
function annotateMessageElement(el, statusText) {
  let badge = el.querySelector('.agent-execution-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.className = 'agent-execution-badge';
    badge.style.marginTop = '8px';
    badge.style.padding = '4px 10px';
    badge.style.borderRadius = '6px';
    badge.style.fontSize = '12px';
    badge.style.fontWeight = '600';
    badge.style.display = 'inline-flex';
    badge.style.alignItems = 'center';
    badge.style.gap = '6px';
    badge.style.background = 'rgba(56, 189, 248, 0.15)';
    badge.style.color = '#38bdf8';
    badge.style.border = '1px solid rgba(56, 189, 248, 0.4)';
    el.appendChild(badge);
  }
  badge.textContent = statusText;
}

/**
 * Floating UI Pill on chatgpt.com to start agent session or pause
 */
function injectAgentControlPill() {
  if (document.getElementById('chatgpt-agent-pill')) return;

  const pill = document.createElement('div');
  pill.id = 'chatgpt-agent-pill';
  pill.innerHTML = `
    <span style="width: 8px; height: 8px; background: #22c55e; border-radius: 50%; display: inline-block;"></span>
    <span>🤖 Agent Mode Active</span>
  `;
  pill.style.position = 'fixed';
  pill.style.top = '12px';
  pill.style.right = '70px';
  pill.style.zIndex = '9999';
  pill.style.background = 'rgba(15, 23, 42, 0.9)';
  pill.style.backdropFilter = 'blur(8px)';
  pill.style.border = '1px solid rgba(56, 189, 248, 0.4)';
  pill.style.color = '#f8fafc';
  pill.style.padding = '6px 14px';
  pill.style.borderRadius = '9999px';
  pill.style.fontSize = '12px';
  pill.style.fontWeight = '600';
  pill.style.display = 'flex';
  pill.style.alignItems = 'center';
  pill.style.gap = '8px';
  pill.style.boxShadow = '0 4px 15px rgba(0,0,0,0.3)';
  pill.style.cursor = 'pointer';
  pill.title = 'Click to paste Computer Use Agent Prompt';

  pill.onclick = () => {
    const prompt = `You are an autonomous Browser Computer-Use Agent. To interact with my browser, end every response with a single JSON code block tagged \`\`\`action. Available actions: navigate, click, type, select_option, hover, scroll, wait, ask_user, done. Wait for my observation before deciding your next step.`;
    injectAndSubmitPrompt(prompt);
  };

  document.body.appendChild(pill);
}

function showNotification(msg, color = '#38bdf8') {
  const notif = document.createElement('div');
  notif.textContent = msg;
  notif.style.position = 'fixed';
  notif.style.bottom = '20px';
  notif.style.left = '50%';
  notif.style.transform = 'translateX(-50%)';
  notif.style.background = '#0f172a';
  notif.style.color = color;
  notif.style.border = `1px solid ${color}`;
  notif.style.padding = '8px 16px';
  notif.style.borderRadius = '8px';
  notif.style.zIndex = '99999';
  notif.style.fontWeight = '600';
  document.body.appendChild(notif);
  setTimeout(() => notif.remove(), 3000);
}

// Start observer when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initChatObserver);
} else {
  initChatObserver();
}
