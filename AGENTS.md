# Agents Instructions (chatgpt-computer-use)

High-signal, repo-specific guidance for OpenCode agents. Read this before making changes.

## Architecture
- System: Chrome MV3 extension (`extension/`) + WebSocket relay (`server/`) bridge. ChatGPT (chatgpt.com) emits actions in a single fenced ```action JSON block; extension executes in target tab; relay routes between roles (`chatgpt_ui`, `extension_bg`, etc.).
- Roles & message flow: 
  - ChatGPT UI (content script `extension/content_chatgpt.js`) watches assistant messages, parses ```action ... ```, sends `ACTION_REQUEST` via WS relay to extension.
  - Extension background (`extension/background.js`) receives `EXECUTE_ACTION`, forwards to target tab via `chrome.tabs.sendMessage` (or injects `action_runner.js` + `domExtractor.js`), executes via `ActionRunner`.
  - Target content bridge (`extension/content_target.js`) runs in target page, executes actions, returns results to background; background posts `ACTION_RESULT` back to relay; relay forwards `OBSERVATION` to ChatGPT UI (auto-submit supported).
- Set-of-Marks: `extension/domExtractor.js` builds a token-efficient accessibility tree, assigns numeric `data-agent-id` (visible interactive elements, up to ~80), prunes hidden/redundant nodes. Actions prefer `element_id` (numeric). Also supports `selector` and text fallback.
- Visual feedback: `extension/visualOverlay.js` renders pulse/highlight overlays on target elements.
- Kill switch: Triple `Esc` in browser, popup button, and relay API (`POST /api/emergency-stop`). Server `sessionStore.js` enforces `isHalted` (global/session) and blocks queued actions.

## Key Files
- Relay: `server/server.js` (Express + WS), `server/wsManager.js` (auth, routing, heartbeat), `server/sessionStore.js` (sessions/actions/logs), `server/package.json`.
- Extension: `extension/manifest.json` (MV3, permissions: tabs/activeTab/scripting/storage, host_permissions `<all_urls>` + chatgpt.com), `extension/content_chatgpt.js`, `extension/content_target.js`, `extension/background.js`, `extension/action_runner.js`, `extension/domExtractor.js`, `extension/visualOverlay.js`, `extension/prompt_template.md`, `extension/popup/*`.
- Repo: `PRD.md`, `README.md`.

## Development (Local)
- Relay: `cd server; npm install; node server.js` (or `npm run dev` watch). WS at `ws://localhost:3000/ws`, dashboard `http://localhost:3000`, health `/health`.
- Extension: Load unpacked `extension/` in Chrome/Chromium (Developer mode). Configure popup with relay URL + secret. Test on `https://chatgpt.com/`.

## Action Protocol (Critical)
- ChatGPT must output a single JSON code block tagged ```action. Parser in `content_chatgpt.js` expects the block and dispatches immediately. 
- After action, wait for observation before next action (relay returns `OBSERVATION`/`ACTION_FAILED` to ChatGPT UI). 
- Supported core types (as implemented): `click`, `type`, `select_option`, `hover`, `scroll`, `key_press`, `extract_data`, `wait`, `extract_dom`/`inspect`, `navigate`, `ask_user`, `done`. 
- Element resolution order in `action_runner.js`: `element_id` (data-agent-id) → `selector` → `text_target` fallback.

## Configuration / Auth
- Relay auth: `AGENT_SECRET_KEY` (env). Token passed via WS query `?token=...&role=...`. If no key, auth is permissive in URL-based check but server expects AUTH message; see `wsManager.js`. 
- Storage: Extension uses `chrome.storage.local` for `serverUrl`, `secretToken`, `autoSubmit` (loaded in `content_chatgpt.js`, `popup/popup.js`).
- WS URL normalization: content script normalizes to `ws://`/`wss://` and appends `/ws` if missing; also sets query params.

## Testing / Verification
- No formal test runner configured (no `package.json` test script in root/server). 
- Quick manual verification path:
  1. Start relay (`server`), load extension, connect via popup.
  2. Open chatgpt.com, inject/control via popup “Start Agent Chat” (or use prompt template). 
  3. Trigger an action; check logs in relay dashboard (`/`) and popup activity feed; verify observation returned to chat UI (auto-submit toggles behavior in content script).
- If changing WS protocol/roles or action schema, verify end-to-end: chatgpt_ui ↔ relay ↔ extension_bg ↔ target tab.

## Gotchas & Quirks
- MV3: background is `service_worker` (ESM). Content scripts inject into chatgpt.com and target pages; target pages get `content_target.js` injected by background when needed. 
- Host permissions: `<all_urls>` required to control arbitrary target tabs. 
- DOM extraction caps at 80 interactive elements and trims text (safety/token bound). Redundant nested interactive children skipped. Extended viewport scan (-200/+200) to catch off-screen but relevant elements.
- Chat observer in `content_chatgpt.js` looks for assistant messages via `data-message-author-role="assistant"` and streaming indicators (`stop-button`, `aria-label="Stop streaming"`, `.result-streaming`); avoid reprocessing same message text. 
- Emergency halt clears pending/current actions in session store and broadcasts to all clients. 
- Server uses in-memory store (`sessionStore.js`) — not persistent across restarts (by design for local/ephemeral relay). 
- Railway: `railway.json` present; root dir `/server` expected per README.

## Conventions
- ESM modules (`type: module`) in server and extension uses ES modules where imported (service worker ESM). Keep import style consistent.
- Minimal, direct code; no comments unless necessary (project style). 
- Prefer executable sources (config/scripts) over prose if conflicting.

## When Editing
- Changing action schema: update `action_runner.js` (execution), `content_chatgpt.js`/prompt_template.md (generation), and any routing in `wsManager.js`/`background.js`.
- Modifying Set-of-Marks: `domExtractor.js` is the source of truth for `element_id` assignment — changes affect all action resolution.
- Auth changes: must be consistent across WS URL params, AUTH message handling, and popup config.
- Don’t assume test commands exist; verify by manual e2e if touching runtime flow. If you add scripts/tests later, document exact commands here.
