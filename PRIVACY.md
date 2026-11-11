# Privacy Policy for BrowserAgent

**Last updated:** November 11, 2026

BrowserAgent ("we", "our", or "the extension") is a client-side browser extension designed as an autonomous AI web navigation assistant. We are committed to protecting your privacy and ensuring complete transparency regarding how your data is handled.

---

### 1. Architecture & Core Privacy Principle

* **100% Client-Side Execution:** BrowserAgent operates entirely within your browser environment. We do not operate any middleman servers, proxy servers, telemetry collectors, or cloud databases.
* **Bring-Your-Own-Key (BYOK):** All AI model requests are made directly from your browser to your chosen AI provider's official API endpoints (such as OpenAI, Anthropic, Google Gemini, OpenRouter, xAI, or DeepSeek) using your personal API key.

---

### 2. Data We Do NOT Collect

We do not collect, harvest, store, or sell any of your personal information:
* No personally identifiable information (name, email address, physical address, IP tracking).
* No browsing history or tracking across websites.
* No authentication credentials, passwords, or banking/payment details.
* No developer analytics, telemetry, or tracking pixels.

---

### 3. Data Processed Locally

The following information is handled strictly within your browser via `chrome.storage.local`:
* **API Keys:** Stored locally in your browser to authenticate direct requests to your chosen AI provider. Keys are never transmitted anywhere except the designated official API endpoints.
* **Configuration & Preferences:** Your selected model, custom spending budget limits, and UI preferences.
* **Session Chat History:** Your conversation prompts and action execution steps are stored locally so you can view past tasks.

---

### 4. Data Transmitted to Third-Party AI Providers

When you explicitly instruct BrowserAgent to execute a task, the extension sends:
1. **User Instructions:** The prompt or task you entered in the Side Panel.
2. **Page Content (DOM):** Visible text and element labels from the active webpage you directed the agent to interact with.

This data is sent **directly and exclusively** via secure HTTPS to the third-party AI provider you configured (e.g., OpenAI, Anthropic, Google, OpenRouter). The handling of that data is governed by the privacy policy of the respective AI provider:
* [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy/)
* [Anthropic Privacy Policy](https://www.anthropic.com/legal/privacy)
* [Google Privacy Policy](https://policies.google.com/privacy)
* [OpenRouter Privacy Policy](https://openrouter.ai/privacy)

---

### 5. Single Purpose Compliance & Certification

In accordance with Microsoft Edge Add-ons and Chrome Web Store Developer Policies:
* We do **not** sell, rent, or transfer user data to third parties outside the approved single purpose.
* We do **not** use or transfer user data for purposes unrelated to executing user-requested web navigation tasks.
* We do **not** use user data to determine creditworthiness or for lending purposes.

---

### 6. Contact

If you have questions or concerns regarding this Privacy Policy, please contact:
* **Developer:** Abhinav Maurya
* **Email:** [owner@wegenz.in](mailto:owner@wegenz.in)
* **GitHub Repository:** [https://github.com/Fire162/BrowserAgent](https://github.com/Fire162/BrowserAgent)
