import { getElementById } from './labeler';

/**
 * Deep query selector that penetrates open shadow roots
 */
function querySelectorDeep(root: ParentNode, selector: string): HTMLElement | null {
  try {
    const found = root.querySelector<HTMLElement>(selector);
    if (found) return found;
  } catch {
    // Ignore invalid selector syntax
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode() as HTMLElement | null;
  while (node) {
    if (node.shadowRoot) {
      const inner = querySelectorDeep(node.shadowRoot, selector);
      if (inner) return inner;
    }
    node = walker.nextNode() as HTMLElement | null;
  }
  return null;
}

function findTargetElement(elementId?: string | number, selector?: string): HTMLElement | null {
  if (elementId !== undefined && elementId !== null && String(elementId).trim() !== '') {
    const numId = parseInt(String(elementId), 10);
    if (!isNaN(numId)) {
      const el = getElementById(numId);
      if (el) return el;
    }
  }

  if (selector && selector.trim()) {
    return querySelectorDeep(document, selector.trim());
  }

  return null;
}

function flashElement(el: HTMLElement): void {
  const originalOutline = el.style.outline;
  const originalTransition = el.style.transition;
  el.style.transition = 'outline 0.15s ease-in-out';
  el.style.outline = '3px solid #38bdf8'; // sky-400

  setTimeout(() => {
    el.style.outline = originalOutline;
    el.style.transition = originalTransition;
  }, 400);
}

export function performClick(params: { elementId?: string | number; selector?: string }): { success: boolean; message: string } {
  const el = findTargetElement(params.elementId, params.selector);
  if (!el) {
    return {
      success: false,
      message: `Could not find element to click (id: ${params.elementId}, selector: ${params.selector}). Note: Element IDs change when the DOM updates. Re-check current element badges or try a CSS selector.`,
    };
  }

  flashElement(el);
  try {
    el.scrollIntoView({ behavior: 'instant', block: 'center' });
  } catch {
    el.scrollIntoView(true);
  }

  // Realistic event dispatching with composed: true to cross shadow DOM boundaries
  const rect = el.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;

  const mouseOpts: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX,
    clientY,
  };

  el.dispatchEvent(new PointerEvent('pointerdown', mouseOpts));
  el.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
  try { el.focus(); } catch {}
  el.dispatchEvent(new PointerEvent('pointerup', mouseOpts));
  el.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
  el.dispatchEvent(new MouseEvent('click', mouseOpts));

  return { success: true, message: `Clicked element <${el.tagName.toLowerCase()}> "${(el.innerText || '').slice(0, 30)}"` };
}

export function performType(params: {
  elementId?: string | number;
  selector?: string;
  text: string;
  clearFirst?: string | boolean;
  pressEnter?: string | boolean;
}): { success: boolean; message: string } {
  const el = findTargetElement(params.elementId, params.selector);
  if (!el) {
    return {
      success: false,
      message: `Could not find element to type into (id: ${params.elementId}, selector: ${params.selector}). Note: Element IDs change when the DOM updates. Re-check current element badges or try a CSS selector.`,
    };
  }

  flashElement(el);
  try {
    el.scrollIntoView({ behavior: 'instant', block: 'center' });
  } catch {
    el.scrollIntoView(true);
  }

  // If host element has a shadowRoot containing an inner input or textarea or contenteditable, delegate to it
  let targetEl: HTMLElement = el;
  if (el.shadowRoot) {
    const shadowInner = el.shadowRoot.querySelector<HTMLElement>('input, textarea, [contenteditable="true"], [role="textbox"]');
    if (shadowInner) {
      targetEl = shadowInner;
    }
  }

  // Focus both host and inner target
  try { el.focus(); } catch {}
  try { targetEl.focus(); } catch {}

  const isInput = targetEl instanceof HTMLInputElement || targetEl instanceof HTMLTextAreaElement;
  const isContentEditable = targetEl.isContentEditable || targetEl.getAttribute('contenteditable') === 'true';
  const shouldClear = params.clearFirst === 'true' || params.clearFirst === true;
  const shouldPressEnter = params.pressEnter === 'true' || params.pressEnter === true;

  if (isInput) {
    const inputEl = targetEl as HTMLInputElement | HTMLTextAreaElement;
    if (shouldClear) {
      inputEl.value = '';
    }

    // Set value triggering React / framework synthetic event listeners
    const proto = inputEl instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    const finalValue = shouldClear ? params.text : (inputEl.value + params.text);

    if (nativeSetter) {
      nativeSetter.call(inputEl, finalValue);
    } else {
      inputEl.value = finalValue;
    }

    inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: params.text, inputType: 'insertText' }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    // Also mirror to host custom component if it exposes a .value property
    if (el !== targetEl && 'value' in (el as any)) {
      try {
        (el as any).value = finalValue;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: params.text, inputType: 'insertText' }));
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      } catch {}
    }
  } else if (isContentEditable) {
    if (shouldClear) {
      targetEl.innerText = '';
    }
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, params.text);
    } catch {}
    if (!inserted) {
      targetEl.innerText += params.text;
    }
    targetEl.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: params.text }));
  } else {
    // Custom web component host (e.g. <v6_he-text-area>) without standard inner form element
    if (shouldClear) {
      try {
        if ('value' in (targetEl as any)) (targetEl as any).value = '';
        targetEl.innerText = '';
      } catch {}
    }

    // Try document.execCommand insertText first
    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, params.text);
    } catch {}

    // Set value property if it exists on custom element
    if ('value' in (targetEl as any)) {
      try {
        const cur = (targetEl as any).value || '';
        (targetEl as any).value = shouldClear ? params.text : (cur + params.text);
      } catch {}
    }

    // Dispatch input & change events with composed: true
    targetEl.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: params.text, inputType: 'insertText' }));
    targetEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  if (shouldPressEnter) {
    const keyEnterInit: KeyboardEventInit = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
    };
    targetEl.dispatchEvent(new KeyboardEvent('keydown', keyEnterInit));
    targetEl.dispatchEvent(new KeyboardEvent('keypress', keyEnterInit));
    targetEl.dispatchEvent(new KeyboardEvent('keyup', keyEnterInit));
    if (el !== targetEl) {
      el.dispatchEvent(new KeyboardEvent('keydown', keyEnterInit));
      el.dispatchEvent(new KeyboardEvent('keyup', keyEnterInit));
    }
  }

  return { success: true, message: `Typed "${params.text}" into element <${targetEl.tagName.toLowerCase()}> (enterPressed: ${shouldPressEnter})` };
}

export function performPressKey(key: string): { success: boolean; message: string } {
  const target = (document.activeElement as HTMLElement) || document.body;
  const keyEventInit: KeyboardEventInit = {
    key,
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
  };

  target.dispatchEvent(new KeyboardEvent('keydown', keyEventInit));
  target.dispatchEvent(new KeyboardEvent('keypress', keyEventInit));
  target.dispatchEvent(new KeyboardEvent('keyup', keyEventInit));

  return { success: true, message: `Pressed key "${key}"` };
}

export function performScroll(direction: 'down' | 'up', amount = 500): { success: boolean; message: string } {
  const delta = direction === 'down' ? amount : -amount;
  const beforeY = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;

  // 1. Primary window/document scroll with 'instant' behavior (executes immediately in background tabs)
  try {
    window.scrollBy({ top: delta, behavior: 'instant' });
  } catch {
    window.scrollBy(0, delta);
  }

  // 2. Direct scroll increment fallback for documentElement / scrollingElement
  if (document.scrollingElement) {
    document.scrollingElement.scrollTop += delta;
  } else {
    document.documentElement.scrollTop += delta;
    if (document.body) {
      document.body.scrollTop += delta;
    }
  }

  const afterY = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;

  // 3. Fallback for modern SPAs with nested overflow scroll containers (e.g., Twitter, Docs, Gmail)
  if (Math.abs(afterY - beforeY) < 5) {
    const scrollables = Array.from(document.querySelectorAll<HTMLElement>('*')).filter((elem) => {
      if (elem === document.body || elem === document.documentElement) return false;
      const style = window.getComputedStyle(elem);
      const overflowY = style.overflowY;
      const canScroll = (overflowY === 'auto' || overflowY === 'scroll') && elem.scrollHeight > elem.clientHeight;
      if (!canScroll) return false;
      const rect = elem.getBoundingClientRect();
      return rect.width > 200 && rect.height > 200;
    });

    if (scrollables.length > 0) {
      scrollables.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
      const targetContainer = scrollables[0];
      const containerBeforeY = targetContainer.scrollTop;
      targetContainer.scrollTop += delta;
      const containerAfterY = targetContainer.scrollTop;
      if (Math.abs(containerAfterY - containerBeforeY) >= 5) {
        return { success: true, message: `Scrolled container <${targetContainer.tagName.toLowerCase()}> ${direction} by ${amount}px` };
      }
    }

    return {
      success: false,
      message: `Page or container cannot scroll ${direction} further (already at boundary or content is not scrollable). Do not scroll ${direction} again; inspect visible elements or navigate.`,
    };
  }

  return { success: true, message: `Scrolled ${direction} by ${amount}px` };
}

export function extractPageData(): { title: string; url: string; textContent: string } {
  const title = document.title || '';
  const url = window.location.href;
  const rawText = (document.body ? document.body.innerText : (document.documentElement ? document.documentElement.innerText : '')) || '';
  const textContent = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 150)
    .join('\n');

  return { title, url, textContent };
}

export function readPageContent(params: {
  selector?: string;
  maxCharacters?: number | string;
}): { success: boolean; message: string; content?: string } {
  const maxLen =
    typeof params.maxCharacters === 'number'
      ? params.maxCharacters
      : parseInt(String(params.maxCharacters || '2500'), 10) || 2500;

  let targetEl: HTMLElement | null = null;
  if (params.selector && params.selector.trim()) {
    targetEl = querySelectorDeep(document, params.selector.trim());
  }

  // Fallback to primary article/main container or document.body
  if (!targetEl) {
    targetEl =
      document.querySelector<HTMLElement>('article') ||
      document.querySelector<HTMLElement>('main') ||
      document.querySelector<HTMLElement>('[role="main"]') ||
      document.querySelector<HTMLElement>('#content') ||
      document.querySelector<HTMLElement>('.content') ||
      document.body;
  }

  if (!targetEl) {
    return { success: false, message: 'Could not find readable content on this page.' };
  }

  // Clone and sanitize (strip scripts, styles, svg, and badge overlays)
  const clone = targetEl.cloneNode(true) as HTMLElement;
  const elementsToRemove = clone.querySelectorAll(
    'script, style, svg, noscript, iframe, #__browseragent_badge_container__'
  );
  elementsToRemove.forEach((el) => el.remove());

  const rawText = clone.innerText || clone.textContent || '';
  const cleaned = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');

  const truncated = cleaned.slice(0, maxLen);
  const remaining =
    cleaned.length > maxLen
      ? `\n... [Remaining ${cleaned.length - maxLen} characters truncated; specify a more focused selector to read more]`
      : '';

  return {
    success: true,
    message: `Extracted ${truncated.length} characters of page text${
      params.selector ? ` from "${params.selector}"` : ''
    }:\n${truncated}${remaining}`,
    content: truncated,
  };
}

export function getElementText(params: {
  elementId?: string | number;
  selector?: string;
}): { success: boolean; message: string; text?: string } {
  const el = findTargetElement(params.elementId, params.selector);
  if (!el) {
    return {
      success: false,
      message: `Could not find element to read (id: ${params.elementId}, selector: ${params.selector})`,
    };
  }

  flashElement(el);

  const tagName = el.tagName.toLowerCase();
  const shadowInput = el.shadowRoot?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
  const innerText = (el.innerText || el.textContent || shadowInput?.value || el.shadowRoot?.textContent || '').trim();
  const value = (el as HTMLInputElement).value || shadowInput?.value || '';
  const href = (el as HTMLAnchorElement).href || '';
  const placeholder = el.getAttribute('placeholder') || shadowInput?.getAttribute('placeholder') || '';
  const title = el.getAttribute('title') || shadowInput?.getAttribute('title') || '';
  const ariaLabel = el.getAttribute('aria-label') || shadowInput?.getAttribute('aria-label') || '';

  const details: string[] = [];
  if (innerText) details.push(`Text: "${innerText.slice(0, 1000)}"`);
  if (value) details.push(`Value: "${value.slice(0, 500)}"`);
  if (href) details.push(`Href: "${href}"`);
  if (placeholder) details.push(`Placeholder: "${placeholder}"`);
  if (title) details.push(`Title: "${title}"`);
  if (ariaLabel) details.push(`Aria-Label: "${ariaLabel}"`);

  // Format table rows if reading a table
  if (tagName === 'table') {
    const rows = Array.from(el.querySelectorAll('tr'))
      .slice(0, 20)
      .map((tr) => {
        const cells = Array.from(tr.querySelectorAll('th, td')).map((c) => (c.textContent || '').trim());
        return `| ${cells.join(' | ')} |`;
      });
    if (rows.length > 0) {
      details.push(`Table content:\n${rows.join('\n')}`);
    }
  }

  const message =
    details.length > 0
      ? `Element <${tagName}> details:\n${details.join('\n')}`
      : `Element <${tagName}> is empty.`;

  return {
    success: true,
    message,
    text: innerText || value,
  };
}
