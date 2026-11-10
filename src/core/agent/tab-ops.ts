/**
 * Tab Navigation & Screenshot Operations
 * Shared across Background Service Worker and Sidepanel
 */

export interface NavigationResult {
  success: boolean;
  error?: string;
  tab?: chrome.tabs.Tab;
  isErrorPage?: boolean;
  timedOut?: boolean;
}

export interface ScreenshotResult {
  success: boolean;
  dataUrl?: string;
  error?: string;
}

export async function performTabNavigation(tabId: number, url: string): Promise<NavigationResult> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.tabs) {
      resolve({ success: false, error: 'Chrome tabs API unavailable.' });
      return;
    }

    chrome.tabs.update(tabId, { url }, () => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
        return;
      }

      let finished = false;

      // Wait for page load completion and verify if page loaded or hit an error
      const listener = (tid: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (tid === tabId && changeInfo.status === 'complete' && !finished) {
          finished = true;
          chrome.tabs.onUpdated.removeListener(listener);
          chrome.tabs.get(tabId, (finalTab) => {
            const tabUrl = finalTab?.url || '';
            const tabTitle = (finalTab?.title || '').toLowerCase();
            const isError =
              tabUrl.startsWith('chrome-error://') ||
              tabTitle.includes("site can't be reached") ||
              tabTitle.includes("site can’t be reached") ||
              tabTitle.includes('err_name_not_resolved') ||
              tabTitle.includes('err_connection_refused') ||
              tabTitle.includes('server ip address could not be found') ||
              tabTitle.includes('dns_probe_finished');

            if (isError) {
              resolve({
                success: false,
                error: `Failed to load ${url}: Site does not exist or DNS cannot be resolved (${finalTab?.title || 'ERR_NAME_NOT_RESOLVED'}).`,
                isErrorPage: true,
                tab: finalTab,
              });
            } else {
              resolve({ success: true, tab: finalTab });
            }
          });
        }
      };
      chrome.tabs.onUpdated.addListener(listener);

      // Fallback timeout after 12 seconds in case onUpdated doesn't fire
      setTimeout(() => {
        if (finished) return;
        finished = true;
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.tabs.get(tabId, (finalTab) => {
          const tabUrl = finalTab?.url || '';
          const tabTitle = (finalTab?.title || '').toLowerCase();
          if (
            tabUrl.startsWith('chrome-error://') ||
            tabTitle.includes("can't be reached") ||
            tabTitle.includes("can’t be reached")
          ) {
            resolve({
              success: false,
              error: `Navigation timed out for ${url}: Site cannot be reached.`,
              isErrorPage: true,
              tab: finalTab,
            });
          } else {
            resolve({ success: true, timedOut: true, tab: finalTab });
          }
        });
      }, 12000);
    });
  });
}

export async function performTabScreenshot(tabId?: number): Promise<ScreenshotResult> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.tabs) {
      resolve({ success: false, error: 'Chrome tabs API unavailable.' });
      return;
    }

    if (tabId) {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          resolve({ success: false, error: chrome.runtime.lastError?.message || 'Target tab not found' });
          return;
        }

        const windowId = tab.windowId;
        if (!tab.active) {
          // Find the user's currently active tab in this window
          chrome.tabs.query({ active: true, windowId }, (activeTabs) => {
            const previousActiveTabId = activeTabs?.[0]?.id;

            // Activate agent's tab momentarily to capture frame (ultra-fast 35ms bounce-back)
            chrome.tabs.update(tabId, { active: true }, () => {
              setTimeout(() => {
                chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 80 }, (dataUrl) => {
                  const captureError = chrome.runtime.lastError?.message;

                  // Instantly bounce back to user's previous active tab!
                  if (previousActiveTabId && previousActiveTabId !== tabId) {
                    chrome.tabs.update(previousActiveTabId, { active: true });
                  }

                  if (captureError) {
                    resolve({ success: false, error: captureError });
                  } else {
                    resolve({ success: true, dataUrl });
                  }
                });
              }, 35);
            });
          });
        } else {
          chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 80 }, (dataUrl) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
              resolve({ success: true, dataUrl });
            }
          });
        }
      });
      return;
    }

    chrome.tabs.captureVisibleTab({ format: 'jpeg', quality: 80 }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
      } else {
        resolve({ success: true, dataUrl });
      }
    });
  });
}
