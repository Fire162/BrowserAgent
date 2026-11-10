/**
 * Extension Toolbar Icon Badge & Flashing Notification System
 * Replaces intrusive desktop OS notifications with an elegant, blinking toolbar badge.
 */

let badgeBlinkTimer: any = null;

export function stopBadgeBlink(): void {
  if (badgeBlinkTimer) {
    clearInterval(badgeBlinkTimer);
    badgeBlinkTimer = null;
  }
}

export function clearToolbarBadge(): void {
  stopBadgeBlink();
  try {
    if (typeof chrome !== 'undefined' && chrome.action?.setBadgeText) {
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setTitle({ title: 'BrowserAgent - Autonomous AI Web Navigator' });
    }
  } catch {
    // Ignore errors
  }
}

export function setToolbarBadgeRunning(): void {
  stopBadgeBlink();
  try {
    if (typeof chrome !== 'undefined' && chrome.action?.setBadgeText) {
      chrome.action.setBadgeText({ text: '•' });
      chrome.action.setBadgeBackgroundColor({ color: '#0ea5e9' }); // Sky blue
      chrome.action.setTitle({ title: 'BrowserAgent: Running task in background...' });
    }
  } catch {
    // Ignore errors
  }
}

export function notifyToolbarBadge(
  type: 'ask_user' | 'finish' | 'budget_limit' | 'error',
  options?: { question?: string; summary?: string; error?: string }
): void {
  stopBadgeBlink();

  try {
    if (typeof chrome === 'undefined' || !chrome.action?.setBadgeText) return;

    if (type === 'ask_user') {
      const title = options?.question
        ? `BrowserAgent: Input needed - "${options.question.slice(0, 45)}..." (click to open)`
        : 'BrowserAgent: Waiting for your input (click to open)';

      chrome.action.setTitle({ title });
      chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' }); // Amber

      let toggle = false;
      chrome.action.setBadgeText({ text: '?' });

      // Blinks between '?' and '!' with alternating amber/red to grab user attention
      badgeBlinkTimer = setInterval(() => {
        toggle = !toggle;
        chrome.action.setBadgeText({ text: toggle ? '!' : '?' });
        chrome.action.setBadgeBackgroundColor({ color: toggle ? '#ef4444' : '#f59e0b' });
      }, 500);
    } else if (type === 'finish') {
      const title = options?.summary
        ? `BrowserAgent: Task completed - "${options.summary.slice(0, 45)}..." (click to review)`
        : 'BrowserAgent: Task completed! (click to review)';

      chrome.action.setTitle({ title });
      chrome.action.setBadgeBackgroundColor({ color: '#10b981' }); // Emerald Green

      let count = 0;
      chrome.action.setBadgeText({ text: '✓' });

      // Blinks 8 times to signal completion, then stays solid '✓' until opened
      badgeBlinkTimer = setInterval(() => {
        count++;
        const show = count % 2 === 0;
        chrome.action.setBadgeText({ text: show ? '✓' : '' });
        if (count >= 8) {
          stopBadgeBlink();
          chrome.action.setBadgeText({ text: '✓' });
          chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
        }
      }, 400);
    } else if (type === 'budget_limit') {
      const title = 'BrowserAgent: Budget cap reached - click to configure budget';
      chrome.action.setTitle({ title });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }); // Red

      let toggle = false;
      chrome.action.setBadgeText({ text: '$' });

      badgeBlinkTimer = setInterval(() => {
        toggle = !toggle;
        chrome.action.setBadgeText({ text: toggle ? '!' : '$' });
      }, 500);
    } else if (type === 'error') {
      const title = options?.error ? `BrowserAgent error: ${options.error}` : 'BrowserAgent: Task error';
      chrome.action.setTitle({ title });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
      chrome.action.setBadgeText({ text: '!' });
    }
  } catch (e) {
    console.error('[BrowserAgent] Error setting toolbar badge:', e);
  }
}
