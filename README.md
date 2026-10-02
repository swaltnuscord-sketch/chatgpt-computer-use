# ChatGPT Browser Computer-Use Agent (Zero-Cost Architecture)

An open-source, $0-cost bridge that grants autonomous browser computer-use capabilities to the standard, free ChatGPT web interface (`chatgpt.com`) using your existing local browser sessions.

---

## 🌟 Key Features

* **$0 Running Cost:** Works directly with free ChatGPT (`chatgpt.com`). No paid OpenAI API keys or Plus subscriptions needed.
* **Local Session Access:** Directly controls your local browser tabs (maintaining existing logins, cookies, and authenticated sessions for Gmail, GitHub, Amazon, internal portals).
* **Live Visual Highlights:** Renders glowing pulse rings and bounding boxes on elements as ChatGPT clicks and types.
* **Set-of-Marks Semantic Pruning:** Token-efficient accessibility tree parser that indexes interactive elements with clean numeric tags (`[1]`, `[2]`, `[3]`).
* **Hardware & UI Emergency Killswitch:** Triple-tap `Esc` in the browser or 1-click popup button to immediately halt all automation.
* **Deploy Anywhere:** Deploy the WebSocket Relay to Railway with 1-click or run locally on `localhost:3000`.

---

## 📁 Repository Structure

```text
chatgpt-computer-use/
├── PRD.md                       # Comprehensive Product Requirements Document
├── README.md                    # Setup and quickstart guide
│
├── server/                      # Cloud Relay Server (Node.js / Express / WebSockets)
│   ├── package.json             # Server dependencies
│   ├── server.js                # Server entrypoint & live dashboard
│   ├── wsManager.js             # WebSocket Manager with Token Auth
│   ├── sessionStore.js          # In-memory queue & state store
│   ├── .env.example             # Environment template
│   └── railway.json             # Railway deployment config
│
└── extension/                   # Chrome Extension (Manifest V3)
    ├── manifest.json            # Extension configuration
    ├── background.js            # Background service worker & tab router
    ├── content_chatgpt.js       # chatgpt.com response interceptor & auto-injector
    ├── content_target.js        # Target tab bridge script
    ├── action_runner.js         # Browser interaction tools (click, type, scroll, wait, etc.)
    ├── domExtractor.js          # Set-of-Marks accessibility tree extractor
    ├── visualOverlay.js         # Shadow DOM visual bounding box engine
    ├── prompt_template.md       # Pre-engineered Agent System Prompt
    ├── popup/                   # Extension UI Dashboard (HTML, CSS, JS)
    └── icons/                   # High-res extension icons
```

---

## 🚀 Quickstart Guide

### 1. Deploy Relay Server (Railway or Local)

#### Option A: Run Locally ($0)
```bash
cd server
npm install
node server.js
```
The relay server will start at `ws://localhost:3000/ws` and the web dashboard will be available at `http://localhost:3000`.

#### Option B: Deploy to Railway ($0 Free Tier)
1. Push this repository to GitHub.
2. Go to [Railway.app](https://railway.app), click **New Project** $\rightarrow$ **Deploy from GitHub repo**.
3. Set the Root Directory to `/server`.
4. Add environment variables:
   - `PORT`: `3000`
   - `AGENT_SECRET_KEY`: `your_custom_secret_password`
5. Railway provides a public URL (e.g. `wss://your-relay-app.up.railway.app/ws`).

---

### 2. Load the Extension in Chrome

1. Open Google Chrome (or Brave, Edge, Chromium).
2. Navigate to `chrome://extensions/`.
3. Toggle on **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the `/extension` directory in this repo.
5. Click the extension icon in your Chrome toolbar:
   - Open **⚙️ Configuration & Relay Server**.
   - If running locally: enter `ws://localhost:3000/ws`.
   - If using Railway: enter `wss://your-relay-app.up.railway.app/ws`.
   - Enter your Secret Key and click **Save & Reconnect**.
   - You should see `Connected 🟢`.

---

### 3. Start Computer-Use Session

1. Click **"Start Agent Chat"** in the extension popup (or navigate to `https://chatgpt.com`).
2. Click the floating **🤖 Agent Mode Active** pill on ChatGPT or copy the starter prompt from `extension/prompt_template.md`.
3. In the extension popup, select which browser tab you want ChatGPT to control (e.g. Amazon, Google Flights, YouTube).
4. Give ChatGPT your prompt, for example:
   > *"Go to Amazon, search for wireless mechanical keyboards under $80, find the one with the highest review count, and add it to my cart."*
5. Watch ChatGPT autonomously inspect the page, click, type, and navigate until the task is complete!

---

## 🛑 Safety & Killswitch Controls

- **Triple Escape:** Press `Esc` 3 times anywhere in the browser to trigger an instant emergency stop.
- **Popup Killswitch:** Click the big red **Killswitch** button in the extension popup.
- **Human Confirmation:** Sensitive checkout and deletion flows automatically trigger `ask_user` confirmations.
