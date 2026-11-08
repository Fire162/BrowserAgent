# 🌐 BrowserAgent

### Autonomous In-Browser AI Agent with Bring-Your-Own-Key (BYOK)

[![Manifest V3](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-success?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React 19](https://img.shields.io/badge/React-19-cyan?logo=react&logoColor=white)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**BrowserAgent** is an autonomous AI browser companion running directly in your browser's **Side Panel**. Bring your own API key and prompt tasks directly from your active browser tabs.

**Zero external VPS or backend server required. 100% client-side privacy.**

---

## 🤖 Supported Companies & Models

| AI Company | Latest / Frontier Model | Best Budget Model |
| :--- | :--- | :--- |
| **OpenAI** | `gpt-6-astra` | `gpt-6-luna` |
| **Google** | `gemini-4-argon` | `gemini-3.8-flash` |
| **Anthropic** | `claude-opus-5-5` | `claude-haiku-5-5` |
| **DeepSeek** | `deepseek-v4-pro` | `deepseek-flash` |
| **Alibaba Qwen** | `qwen3.8-max` | `qwen3.8-flash` |
| **xAI** | `grok-4.7` | `grok-build-0.1` |
| **Z.ai** | `glm-5.3` | `glm-5.3-flash` |
| **Mistral** | `mistral-large-4` | `ministral-3b-2512` |

*(Also includes **OpenRouter** and **Custom/Local LLMs** with custom model override).*

---

## ⚡ Key Highlights

* 🖥️ **Persistent Chrome Side Panel**: Lives right next to your active webpage using `chrome.sidePanel`—stays open as you navigate tabs.
* 🔑 **Bring Your Own Key (BYOK)**: Store API keys locally in `chrome.storage.local`. Keys and browser data go directly to LLM endpoints with zero middleman servers.
* 💰 **User-Configurable Price Budget (No Fixed Step Limits)**: Runs continuously without arbitrary 25-step caps. You set a spending budget (e.g. `$0.05`, `$0.25`, or Unlimited); the agent tracks live token costs and pauses for confirmation before exceeding it.
* 🛡️ **Resilient 429 Rate-Limit Handling**: Built-in exponential backoff with jitter and `Retry-After` header parsing automatically handles API rate limits without failing your task.
* 🎯 **Intelligent Visual Labeling**: Numbers interactive elements on screen with high-contrast badges (`[1]`, `[2]`, `[3]...`), allowing LLMs to interact with elements without fragile CSS selectors.
* 🛡️ **Realistic DOM Interaction**: Dispatches full synthetic event sequences (`pointerdown`, `mousedown`, `focus`, `click`, realistic keyboard strokes, smooth scrolling, and native dialog interception).
* 📊 **Live Step & Cost Timeline**: Watch the agent observe, reason, and execute actions with real-time feedback, per-step costs, and progress tracking.

---

## 🚀 Quickstart Installation

1. Open Chrome (or Brave / Edge) and navigate to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select:
   `/root/browseragent/dist`
   *(Or extract `/root/browseragent/browseragent-v1.1.1.zip`)*
4. Click the **BrowserAgent** icon in your browser toolbar to open the Side Panel!
5. In **Keys & Models**, select your company, paste your API key, choose between the **Frontier Model** and **Budget Model**, and run tasks directly.

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
