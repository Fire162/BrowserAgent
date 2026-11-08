import { scanAndLabelElements, clearBadges } from './labeler';
import {
  performClick,
  performType,
  performPressKey,
  performScroll,
  extractPageData,
  readPageContent,
  getElementText,
} from './actions';

(() => {
  if ((window as any).__browseragent_injected) {
    return;
  }
  (window as any).__browseragent_injected = true;

  console.log('[BrowserAgent Content] Engine initialized on:', window.location.href);

  // Dialog interception to prevent tab freeze
  const originalAlert = window.alert;
  const originalConfirm = window.confirm;
  const originalPrompt = window.prompt;

  window.alert = function (message) {
    console.log('[BrowserAgent] Auto-handled alert:', message);
  };
  window.confirm = function (message) {
    console.log('[BrowserAgent] Auto-handled confirm:', message);
    return true;
  };
  window.prompt = function (message, defaultVal = '') {
    console.log('[BrowserAgent] Auto-handled prompt:', message);
    return defaultVal;
  };

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const { action, params } = request || {};

    if (action === 'get_snapshot') {
      const showBadges = params?.showVisualLabels ?? true;
      const { elements, snapshotText } = scanAndLabelElements(showBadges);
      const { textContent } = extractPageData();

      sendResponse({
        success: true,
        data: {
          url: window.location.href,
          title: document.title,
          elements,
          snapshotText,
          bodySnippet: textContent.slice(0, 1000),
        },
      });
      return true;
    }

    if (action === 'perform_action') {
      const toolName = params?.toolName;
      const args = params?.args || {};

      let result: { success: boolean; message: string; data?: any } = {
        success: false,
        message: 'Unknown action',
      };

      try {
        switch (toolName) {
          case 'click':
            result = performClick({ elementId: args.elementId, selector: args.selector });
            break;

          case 'type':
            result = performType({
              elementId: args.elementId,
              selector: args.selector,
              text: args.text,
              clearFirst: args.clearFirst,
              pressEnter: args.pressEnter,
            });
            break;

          case 'press_key':
            result = performPressKey(args.key);
            break;

          case 'scroll':
            result = performScroll(
              args.direction === 'up' ? 'up' : 'down',
              args.amount ? parseInt(args.amount, 10) : 500
            );
            break;

          case 'extract_data':
            const extracted = extractPageData();
            result = {
              success: true,
              message: 'Extracted data successfully',
              data: {
                ...extracted,
                notes: args.description || '',
              },
            };
            break;

          case 'read_page_content':
            result = readPageContent({
              selector: args.selector,
              maxCharacters: args.maxCharacters,
            });
            break;

          case 'get_element_text':
            result = getElementText({
              elementId: args.elementId,
              selector: args.selector,
            });
            break;

          default:
            result = { success: false, message: `Tool "${toolName}" not executed in DOM.` };
        }
      } catch (err: any) {
        result = { success: false, message: `DOM execution failed: ${err.message}` };
      }

      sendResponse(result);
      return true;
    }

    if (action === 'clear_labels') {
      clearBadges();
      sendResponse({ success: true });
      return true;
    }

    sendResponse({ success: false, message: 'Unrecognized action' });
    return true;
  });
})();
