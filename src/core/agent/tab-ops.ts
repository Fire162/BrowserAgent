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
  errorInfo?: HttpOrBrowserError;
}

export interface ScreenshotResult {
  success: boolean;
  dataUrl?: string;
  error?: string;
}

export interface HttpOrBrowserError {
  isError: boolean;
  type?: string;
  detail?: string;
}

export function detectHttpOrBrowserError(
  url: string = '',
  title: string = '',
  snippet: string = ''
): HttpOrBrowserError {
  const lowerUrl = url.toLowerCase();
  const lowerTitle = title.toLowerCase();
  const lowerSnippet = snippet.toLowerCase();
  const combined = `${lowerTitle} ${lowerSnippet}`.trim();

  // 1. Browser internal error screens (Chrome, Edge, Firefox)
  if (
    lowerUrl.startsWith('chrome-error://') ||
    lowerUrl.startsWith('edge-error://') ||
    lowerUrl.startsWith('about:neterror') ||
    combined.includes("site can't be reached") ||
    combined.includes("site can’t be reached") ||
    combined.includes('err_name_not_resolved') ||
    combined.includes('err_connection_refused') ||
    combined.includes('err_connection_timed_out') ||
    combined.includes('err_connection_reset') ||
    combined.includes('dns_probe_finished') ||
    combined.includes('server ip address could not be found')
  ) {
    return {
      isError: true,
      type: 'DNS / Connection Failure',
      detail: 'The requested domain could not be resolved or the connection was refused.',
    };
  }

  // 2. HTTP 404 Not Found
  if (
    combined.includes('404 not found') ||
    combined.includes('404 error') ||
    combined.includes('page not found') ||
    (lowerTitle.includes('404') && (lowerTitle.includes('not found') || lowerTitle.includes('error') || lowerTitle.includes('page')))
  ) {
    return {
      isError: true,
      type: 'HTTP 404 (Not Found)',
      detail: 'The requested page or resource does not exist on this server.',
    };
  }

  // 3. HTTP 503 / 529 / 429 / 500 / 502 / 504 Service Errors
  if (
    combined.includes('503 service unavailable') ||
    combined.includes('503 service temporarily unavailable') ||
    combined.includes('service unavailable') ||
    (lowerTitle.includes('503') && lowerTitle.includes('service'))
  ) {
    return {
      isError: true,
      type: 'HTTP 503 (Service Unavailable)',
      detail: 'The server is temporarily unable to handle the request (overloaded or down for maintenance).',
    };
  }

  if (
    combined.includes('529 site overloaded') ||
    combined.includes('site overloaded') ||
    lowerTitle.includes('529')
  ) {
    return {
      isError: true,
      type: 'HTTP 529 (Site Overloaded)',
      detail: 'The target service is overloaded and temporarily refusing incoming requests.',
    };
  }

  if (
    combined.includes('429 too many requests') ||
    combined.includes('too many requests') ||
    combined.includes('rate limit exceeded') ||
    lowerTitle.includes('429')
  ) {
    return {
      isError: true,
      type: 'HTTP 429 (Too Many Requests / Rate Limited)',
      detail: 'The target website has rate-limited requests from this client.',
    };
  }

  if (
    combined.includes('502 bad gateway') ||
    combined.includes('504 gateway time-out') ||
    combined.includes('504 gateway timeout') ||
    combined.includes('500 internal server error') ||
    lowerTitle.includes('502 bad gateway') ||
    lowerTitle.includes('504 gateway')
  ) {
    return {
      isError: true,
      type: 'HTTP 5xx Server Error',
      detail: 'The server encountered an internal error or gateway timeout.',
    };
  }

  // 4. Access Denied / Cloudflare / 403 Forbidden
  if (
    combined.includes('403 forbidden') ||
    combined.includes('access denied') ||
    combined.includes('just a moment...') ||
    combined.includes('attention required! | cloudflare')
  ) {
    return {
      isError: true,
      type: 'HTTP 403 / Access Challenge',
      detail: 'Access is forbidden or a Cloudflare verification challenge is active.',
    };
  }

  return { isError: false };
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
            const tabTitle = finalTab?.title || '';
            const detectedErr = detectHttpOrBrowserError(tabUrl, tabTitle);

            if (detectedErr.isError) {
              resolve({
                success: false,
                error: `Failed to load ${url}: ${detectedErr.type} - ${detectedErr.detail} (${finalTab?.title || 'Error'}).`,
                isErrorPage: true,
                errorInfo: detectedErr,
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
          const tabTitle = finalTab?.title || '';
          const detectedErr = detectHttpOrBrowserError(tabUrl, tabTitle);

          if (detectedErr.isError) {
            resolve({
              success: false,
              error: `Navigation timed out for ${url}: ${detectedErr.type} (${finalTab?.title || 'Cannot be reached'}).`,
              isErrorPage: true,
              errorInfo: detectedErr,
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
