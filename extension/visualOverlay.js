/**
 * Visual Feedback & Overlay Engine for ChatGPT Computer-Use Agent
 * Injects non-intrusive Shadow DOM overlays, bounding boxes, and emergency halt shortcuts.
 */

let overlayContainer = null;
let shadowRoot = null;
let escPressCount = 0;
let escTimer = null;

/**
 * Initialize or get the Shadow DOM overlay container
 */
export function getOrCreateOverlay() {
  if (overlayContainer && shadowRoot) return { overlayContainer, shadowRoot };

  overlayContainer = document.getElementById('chatgpt-agent-overlay-host');
  if (!overlayContainer) {
    overlayContainer = document.createElement('div');
    overlayContainer.id = 'chatgpt-agent-overlay-host';
    overlayContainer.style.position = 'fixed';
    overlayContainer.style.top = '0';
    overlayContainer.style.left = '0';
    overlayContainer.style.width = '100vw';
    overlayContainer.style.height = '100vh';
    overlayContainer.style.pointerEvents = 'none';
    overlayContainer.style.zIndex = '2147483646';

    document.documentElement.appendChild(overlayContainer);
    shadowRoot = overlayContainer.attachShadow({ mode: 'open' });

    // Inject Shadow DOM Stylesheet
    const style = document.createElement('style');
    style.textContent = `
      .agent-bounding-box {
        position: absolute;
        border: 2.5px solid #38bdf8;
        border-radius: 6px;
        box-shadow: 0 0 15px rgba(56, 189, 248, 0.6), inset 0 0 10px rgba(56, 189, 248, 0.2);
        background: rgba(56, 189, 248, 0.08);
        pointer-events: none;
        transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        z-index: 999999;
      }
      .agent-bounding-box.action-click {
        border-color: #ef4444;
        box-shadow: 0 0 20px rgba(239, 68, 68, 0.8), inset 0 0 12px rgba(239, 68, 68, 0.3);
        background: rgba(239, 68, 68, 0.15);
      }
      .agent-bounding-box.action-type {
        border-color: #a855f7;
        box-shadow: 0 0 20px rgba(168, 85, 247, 0.8), inset 0 0 12px rgba(168, 85, 247, 0.3);
        background: rgba(168, 85, 247, 0.15);
      }
      .agent-badge {
        position: absolute;
        top: -12px;
        left: -4px;
        background: #0f172a;
        color: #38bdf8;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
        font-size: 11px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 4px;
        border: 1px solid #38bdf8;
        box-shadow: 0 2px 6px rgba(0,0,0,0.5);
      }
      .agent-status-banner {
        position: fixed;
        bottom: 16px;
        right: 16px;
        background: rgba(15, 23, 42, 0.92);
        backdrop-filter: blur(10px);
        color: #f8fafc;
        border: 1px solid rgba(56, 189, 248, 0.4);
        padding: 8px 14px;
        border-radius: 9999px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
        pointer-events: auto;
        cursor: pointer;
        user-select: none;
        transition: transform 0.2s ease;
      }
      .agent-status-banner:hover {
        transform: translateY(-2px);
        border-color: #ef4444;
      }
      .pulse-dot {
        width: 8px;
        height: 8px;
        background: #22c55e;
        border-radius: 50%;
        animation: pulse 1.5s infinite;
      }
      @keyframes pulse {
        0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }
        70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
        100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
      }
    `;
    shadowRoot.appendChild(style);
  }

  return { overlayContainer, shadowRoot };
}

/**
 * Show a visual highlighted bounding box over an element
 */
export function highlightElement(el, actionType = 'click', label = '') {
  if (!el || !el.getBoundingClientRect) return;
  const { shadowRoot } = getOrCreateOverlay();

  const rect = el.getBoundingClientRect();
  const box = document.createElement('div');
  box.className = `agent-bounding-box action-${actionType}`;
  box.style.left = `${rect.left + window.scrollX}px`;
  box.style.top = `${rect.top + window.scrollY}px`;
  box.style.width = `${Math.max(rect.width, 24)}px`;
  box.style.height = `${Math.max(rect.height, 24)}px`;

  if (label || el.getAttribute('data-agent-id')) {
    const badge = document.createElement('div');
    badge.className = 'agent-badge';
    badge.textContent = label || `[${el.getAttribute('data-agent-id')}]`;
    box.appendChild(badge);
  }

  shadowRoot.appendChild(box);

  // Auto-fade & remove
  setTimeout(() => {
    box.style.opacity = '0';
    box.style.transform = 'scale(1.05)';
    setTimeout(() => box.remove(), 250);
  }, 1200);
}

/**
 * Attach global emergency halt shortcut (Triple Esc)
 */
export function setupEmergencyKeyboardListener(onHalt) {
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape') {
        escPressCount++;
        if (escTimer) clearTimeout(escTimer);

        if (escPressCount >= 3) {
          escPressCount = 0;
          console.warn('[Agent] 🚨 Emergency Halt triggered by user via 3x Escape');
          if (onHalt) onHalt();
        } else {
          escTimer = setTimeout(() => {
            escPressCount = 0;
          }, 600);
        }
      }
    },
    true
  );
}
