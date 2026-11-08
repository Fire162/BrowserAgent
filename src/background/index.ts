/**
 * BrowserAgent Background Service Worker
 */

// Enable automatic side panel opening on extension icon click
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
    console.error('[BrowserAgent Background] Failed to set side panel behavior:', err);
  });
  console.log('[BrowserAgent] Extension installed & side panel configured.');
});

// Message listener for tab management operations
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { action, params } = request || {};

  if (action === 'navigate_tab') {
    const { tabId, url } = params;
    chrome.tabs.update(tabId, { url }, (updatedTab) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
        return;
      }

      // Wait for page load completion
      const listener = (tid: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (tid === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          sendResponse({ success: true, tab: updatedTab });
        }
      };
      chrome.tabs.onUpdated.addListener(listener);

      // Fallback timeout after 12 seconds in case onUpdated doesn't fire
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        sendResponse({ success: true, timedOut: true });
      }, 12000);
    });
    return true; // async
  }

  if (action === 'capture_screenshot') {
    const { tabId } = params || {};
    if (tabId) {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          sendResponse({ success: false, error: 'Target tab not found' });
          return;
        }

        const windowId = tab.windowId;
        if (!tab.active) {
          // Find the user's currently active tab in this window
          chrome.tabs.query({ active: true, windowId }, (activeTabs) => {
            const previousActiveTabId = activeTabs?.[0]?.id;

            // Activate agent's tab momentarily to capture frame
            chrome.tabs.update(tabId, { active: true }, () => {
              setTimeout(() => {
                chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 80 }, (dataUrl) => {
                  const captureError = chrome.runtime.lastError?.message;

                  // Instantly bounce back to user's previous active tab!
                  if (previousActiveTabId && previousActiveTabId !== tabId) {
                    chrome.tabs.update(previousActiveTabId, { active: true });
                  }

                  if (captureError) {
                    sendResponse({ success: false, error: captureError });
                  } else {
                    sendResponse({ success: true, dataUrl });
                  }
                });
              }, 120);
            });
          });
        } else {
          chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 80 }, (dataUrl) => {
            if (chrome.runtime.lastError) {
              sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
              sendResponse({ success: true, dataUrl });
            }
          });
        }
      });
      return true;
    }

    chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 80 }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, dataUrl });
      }
    });
    return true;
  }

  if (action === 'ensure_content_script') {
    const { tabId } = params;
    chrome.tabs.sendMessage(tabId, { action: 'ping' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        // Inject content script
        chrome.scripting.executeScript(
          {
            target: { tabId },
            files: ['content.js'],
          },
          () => {
            if (chrome.runtime.lastError) {
              sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
              sendResponse({ success: true, injected: true });
            }
          }
        );
      } else {
        sendResponse({ success: true, alreadyInjected: true });
      }
    });
    return true;
  }
});
