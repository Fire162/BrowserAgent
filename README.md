# 🌐 BrowserAgent

### Autonomous In-Browser AI Agent with Bring-Your-Own-Key (BYOK)

[![Manifest V3](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-success?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React 19](https://img.shields.io/badge/React-19-cyan?logo=react&logoColor=white)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**BrowserAgent** is an autonomous AI browser companion running directly in your browser's **Side Panel**. Bring your own API key for **OpenRouter**, **Google Gemini**, **Anthropic Claude**, **xAI Grok**, **DeepSeek**, **OpenAI**, or any **Custom/Local LLM (Ollama)**, and prompt tasks directly from your active browser tabs.

**Zero external VPS or backend server required. 100% client-side privacy.**

---

## ⚡ Key Highlights

* 🖥️ **Persistent Chrome Side Panel**: Runs side-by-side with your active webpage using `chrome.sidePanel`—stays open as you navigate tabs.
* 🔑 **Bring Your Own Key (BYOK)**: Store your API keys locally in `chrome.storage.local`. Keys and browser data go directly to LLM endpoints with zero middleman servers.
* 🤖 **Multi-Provider & Dynamic Models**:
  * **OpenRouter**: Claude 3.7 Sonnet, DeepSeek R1, GPT-4o, Llama 3.3, plus a **live model fetcher** to search and select from 100+ models.
  * **Google Gemini**: Gemini 2.0 Flash, Gemini 2.5 Pro, Gemini 1.5 Pro/Flash.
  * **Anthropic Claude**: Claude 3.7 Sonnet, Claude 3.5 Sonnet, Claude 3.5 Haiku.
  * **xAI Grok**: Grok 2, Grok Beta.
  * **DeepSeek**: DeepSeek Chat (V3), DeepSeek Reasoner (R1).
  * **OpenAI**: GPT-4o, GPT-4o Mini, o3-mini, o1.
  * **Custom / Local**: Connect Ollama (`http://localhost:11434/v1`), LM Studio, Groq, Together, or any OpenAI-compatible API.
* 🎯 **Intelligent Visual Labeling**: Numbers interactive elements on screen with numeric badges (`[1]`, `[2]`, `[3]...`), allowing LLMs to interact with elements without fragile CSS selectors.
* 🛡️ **Realistic DOM Interaction**: Dispatches full synthetic event sequences (`pointerdown`, `mousedown`, `focus`, `click`, realistic keyboard strokes, smooth scrolling, and native dialog interception).
* 📊 **Live Step Timeline**: Watch the agent observe, reason, and execute actions with real-time feedback and progress tracking.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Chrome / Brave / Edge                           │
│                                                                         │
│  ┌───────────────────────┐             ┌──────────────────────────────┐ │
│  │   Chrome Side Panel   │             │          Active Tab          │ │
│  │  (React 19 + Tailwind)│             │     (Target Webpage DOM)     │ │
│  │                       │             │                              │ │
│  │ • API Key settings    │             │  [1] <input> "Search"        │ │
│  │ • Dynamic Model picker│             │  [2] <button> "Submit"       │ │
│  │ • Task Prompt input   │             │                              │ │
│  │ • Action Timeline     │             │                              │ │
│  └──────────┬────────────┘             └──────────────┬───────────────┘ │
│             │                                         │                 │
│             ▼                                         ▲                 │
│  ┌────────────────────────────────────────────────────┴───────────────┐ │
│  │                    In-Browser Agent ReAct Loop                     │ │
│  │                                                                    │ │
│  │  1. OBSERVE: Scan visible interactive elements & generate badges   │ │
│  │  2. REASON:  Direct fetch to provider API with conversation context │ │
│  │  3. ACT:     Execute click, type, scroll, keypress, or wait        │ │
│  │  4. REPORT:  Summarize results with structured Markdown            │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quickstart Installation

### Option 1: Load Unpacked Extension (Recommended)

1. Clone or download the repository:
   ```bash
   git clone https://github.com/browseragent/browseragent.git
   cd browseragent
   ```
2. Install dependencies and build:
   ```bash
   pnpm install
   pnpm build
   ```
3. Open Chrome (or Brave / Edge) and navigate to `chrome://extensions/`.
4. Enable **Developer mode** (toggle in the top-right corner).
5. Click **Load unpacked** and select the `/root/browseragent/dist` directory.
6. Click the **BrowserAgent** icon in your browser toolbar to open the Side Panel!

### Option 2: Pre-built ZIP

Run `pnpm package` to create `/root/browseragent/browseragent-v1.0.0.zip`. You can extract this folder and load it into any Chromium browser.

---

## ⚙️ Configuration (BYOK)

1. Open the Side Panel and click **Keys & Models**.
2. Select your preferred provider (e.g., **OpenRouter**, **Google Gemini**, or **Anthropic**).
3. Paste your API key:
   * [OpenRouter Keys](https://openrouter.ai/keys)
   * [Google AI Studio Keys](https://aistudio.google.com/app/apikey)
   * [Anthropic Console Keys](https://console.anthropic.com/settings/keys)
   * [OpenAI API Keys](https://platform.openai.com/api-keys)
   * [xAI Console Keys](https://console.x.ai/)
   * [DeepSeek Keys](https://platform.deepseek.com/api_keys)
4. Choose a model from the curated list or type any custom model identifier.
   * *Tip for OpenRouter:* Click **Fetch Live Models** to retrieve all available frontier and open models dynamically.

---

## 🛠️ Autonomous Actions Engine

The agent uses a structured set of tools to interact with live web pages:

| Tool | Parameters | Description |
| :--- | :--- | :--- |
| `click` | `elementId`, `selector`, `reason` | Clicks an interactive element using its numeric badge or CSS selector. |
| `type` | `elementId`, `text`, `clearFirst`, `pressEnter` | Types text into input fields/textareas with native event triggers. |
| `press_key` | `key` | Presses special keys (`Enter`, `Tab`, `Escape`, `ArrowDown`). |
| `scroll` | `direction` (`up`/`down`), `amount` | Smoothly scrolls the viewport to reveal content. |
| `navigate` | `url` | Navigates the active tab to a new URL. |
| `wait` | `seconds` | Pauses for async data or animations to render. |
| `extract_data` | `description`, `extractedData` | Extracts tables, lists, text, or structured answers. |
| `ask_user` | `question` | Prompts user if manual action (e.g., CAPTCHA/2FA) is needed. |
| `finish` | `summary` | Concludes task with a comprehensive Markdown report. |

---

## 🔒 Security & Privacy

* **Zero Backend**: All LLM calls originate directly from your browser extension using standard `fetch()` with Chrome Manifest V3 permissions.
* **Storage Isolation**: API keys and task history are stored exclusively in your browser's private `chrome.storage.local`.
* **Authenticated Sessions**: The agent runs in your active browser tabs, meaning it works seamlessly with websites where you are already logged in—without needing to export cookies or passwords.

---

## 🧑‍💻 Development

```bash
# Start Vite dev server for hot reloading sidepanel
pnpm dev

# Build production extension to dist/
pnpm build

# Package dist/ into installable .zip
pnpm package
```

---

## 📄 License

MIT © [Abhinav Maurya](mailto:owner@wegenz.in)
