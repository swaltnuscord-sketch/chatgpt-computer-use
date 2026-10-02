/**
 * Content Script for Target Browser Tabs (the websites being controlled)
 */

import { ActionRunner } from './action_runner.js';
import { extractPageAccessibilityTree } from './domExtractor.js';
import { setupEmergencyKeyboardListener, getOrCreateOverlay } from './visualOverlay.js';

// Initialize visual overlay and emergency listener
getOrCreateOverlay();
setupEmergencyKeyboardListener(() => {
  chrome.runtime.sendMessage({ type: 'TRIGGER_HALT', halt: true });
});

// Listen for action commands from extension background worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'EXECUTE_PAGE_ACTION') {
    handlePageAction(request.action)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ status: 'error', error_message: err.message }));
    return true; // Keep channel open for async response
  }

  if (request.type === 'EXTRACT_DOM') {
    const tree = extractPageAccessibilityTree();
    sendResponse({ status: 'success', tree });
    return true;
  }
});

async function handlePageAction(action) {
  // Execute action (click, type, scroll, hover, etc.)
  const actionResult = await ActionRunner.execute(action);

  // Wait a moment for DOM to react
  await new Promise((r) => setTimeout(r, 600));

  // Extract updated accessibility tree
  const tree = extractPageAccessibilityTree();

  return {
    ...actionResult,
    url: window.location.href,
    title: document.title,
    tree,
  };
}

console.log('[ChatGPT Agent] Target tab controller initialized.');
