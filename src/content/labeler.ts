import { ElementDescriptor } from './types';

const BADGE_CONTAINER_ID = '__browseragent_badge_container__';
let elementMap = new Map<number, HTMLElement>();

export function clearBadges(): void {
  const container = document.getElementById(BADGE_CONTAINER_ID);
  if (container) {
    container.remove();
  }
  elementMap.clear();
}

export function getElementById(id: number): HTMLElement | undefined {
  return elementMap.get(id);
}

function isElementVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return false;

  // Focus on elements currently inside or immediately adjacent to the viewport
  const viewHeight = window.innerHeight || document.documentElement.clientHeight;
  const viewWidth = window.innerWidth || document.documentElement.clientWidth;
  return (
    rect.top < viewHeight * 1.3 &&
    rect.bottom > -viewHeight * 0.3 &&
    rect.left < viewWidth * 1.2 &&
    rect.right > -viewWidth * 0.2
  );
}

function generateSelector(el: HTMLElement): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.getAttribute('data-testid')) return `[data-testid="${CSS.escape(el.getAttribute('data-testid')!)}"]`;
  if (el.getAttribute('aria-label')) return `[aria-label="${CSS.escape(el.getAttribute('aria-label')!)}"]`;
  if (el.getAttribute('name')) return `[name="${CSS.escape(el.getAttribute('name')!)}"]`;

  const tag = el.tagName.toLowerCase();
  if (tag === 'body' || tag === 'html') return tag;

  let path = tag;
  if (el.className && typeof el.className === 'string') {
    const classes = el.className.trim().split(/\s+/).filter((c) => !c.includes(':') && !c.includes('/'));
    if (classes.length > 0) {
      path += `.${classes.slice(0, 2).map((c) => CSS.escape(c)).join('.')}`;
    }
  }

  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
    if (siblings.length > 1) {
      const index = siblings.indexOf(el) + 1;
      path += `:nth-of-type(${index})`;
    }
  }

  return path;
}

/**
 * Recursively traverses all elements in the document and penetrates open Shadow DOM roots
 */
function getAllElementsDeep(root: ParentNode = document): HTMLElement[] {
  const elements: HTMLElement[] = [];
  const treeWalker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if ((node as HTMLElement).id === BADGE_CONTAINER_ID) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let current = treeWalker.nextNode() as HTMLElement | null;
  while (current) {
    elements.push(current);

    // Deeply penetrate open Shadow DOM roots (e.g. Microsoft Partner Center <v6_he-text-area>)
    if (current.shadowRoot) {
      elements.push(...getAllElementsDeep(current.shadowRoot));
    }

    current = treeWalker.nextNode() as HTMLElement | null;
  }

  return elements;
}

const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'textarea', 'select', 'option']);
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'tab',
  'menuitem',
  'option',
  'textbox',
  'searchbox',
  'combobox',
  'switch',
]);

function isInteractiveElement(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();

  // 1. Standard HTML form and navigation tags
  if (INTERACTIVE_TAGS.has(tag)) {
    if (tag === 'a') {
      return el.hasAttribute('href') || el.hasAttribute('role') || el.hasAttribute('tabindex');
    }
    return true;
  }

  // 2. ARIA roles
  const role = el.getAttribute('role');
  if (role && INTERACTIVE_ROLES.has(role)) {
    return true;
  }

  // 3. Contenteditable
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
    return true;
  }

  // 4. Custom Web Components (like <v6_he-text-area>, <custom-input>, <fluent-text-field>)
  if (tag.includes('-')) {
    const isCustomFormOrButton =
      tag.includes('text') ||
      tag.includes('input') ||
      tag.includes('area') ||
      tag.includes('field') ||
      tag.includes('btn') ||
      tag.includes('button') ||
      tag.includes('select') ||
      tag.includes('picker') ||
      el.hasAttribute('aria-label') ||
      el.hasAttribute('placeholder') ||
      el.hasAttribute('value') ||
      Boolean(el.shadowRoot?.querySelector('input, textarea'));

    if (isCustomFormOrButton) return true;
  }

  // 5. Explicit event handlers or tabindex
  if (
    el.hasAttribute('onclick') ||
    (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1')
  ) {
    return true;
  }

  return false;
}

export function scanAndLabelElements(showVisualBadges = true): { elements: ElementDescriptor[]; snapshotText: string } {
  clearBadges();

  const allElements = getAllElementsDeep(document);
  const rawElements = allElements.filter(isInteractiveElement);
  const visibleElements = rawElements.filter(isElementVisible);

  let container: HTMLDivElement | null = null;
  if (showVisualBadges && visibleElements.length > 0) {
    container = document.createElement('div');
    container.id = BADGE_CONTAINER_ID;
    container.style.position = 'absolute';
    container.style.top = '0';
    container.style.left = '0';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '2147483647';
    document.body.appendChild(container);
  }

  const descriptors: ElementDescriptor[] = [];
  let idCounter = 1;

  for (const el of visibleElements) {
    const tagName = el.tagName.toLowerCase();
    const shadowInput = el.shadowRoot?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
    const isInput =
      ['input', 'textarea', 'select'].includes(tagName) ||
      tagName.includes('text') ||
      tagName.includes('input') ||
      tagName.includes('area') ||
      el.getAttribute('role') === 'textbox' ||
      Boolean(shadowInput);

    const text = (
      el.innerText ||
      el.getAttribute('aria-label') ||
      shadowInput?.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      shadowInput?.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      (el as HTMLInputElement).value ||
      shadowInput?.value ||
      ''
    ).trim().replace(/\s+/g, ' ').slice(0, 50);

    // Skip empty non-interactive tags with no accessible label, text, or input type
    if (!text && !isInput && !el.getAttribute('role')) {
      continue;
    }

    const id = idCounter++;
    elementMap.set(id, el);

    const rect = el.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    const desc: ElementDescriptor = {
      id,
      tagName,
      text,
      type: (el as HTMLInputElement).type || shadowInput?.type || (isInput ? 'text' : undefined),
      role: el.getAttribute('role') || (isInput ? 'textbox' : undefined),
      placeholder: el.getAttribute('placeholder') || shadowInput?.getAttribute('placeholder') || undefined,
      ariaLabel: el.getAttribute('aria-label') || shadowInput?.getAttribute('aria-label') || undefined,
      name: el.getAttribute('name') || shadowInput?.getAttribute('name') || undefined,
      href: (el as HTMLAnchorElement).href || undefined,
      value: (el as HTMLInputElement).value || shadowInput?.value || undefined,
      selector: generateSelector(el),
      rect: {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
    descriptors.push(desc);

    if (container) {
      const badge = document.createElement('div');
      badge.textContent = String(id);
      badge.style.position = 'absolute';
      badge.style.top = `${rect.top + scrollY - 6}px`;
      badge.style.left = `${rect.left + scrollX - 6}px`;
      badge.style.backgroundColor = '#f59e0b'; // amber-500
      badge.style.color = '#000000';
      badge.style.fontSize = '11px';
      badge.style.fontWeight = '700';
      badge.style.fontFamily = 'monospace, sans-serif';
      badge.style.padding = '1px 5px';
      badge.style.borderRadius = '4px';
      badge.style.border = '1px solid #78350f';
      badge.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
      badge.style.zIndex = '2147483647';
      badge.style.lineHeight = '14px';
      container.appendChild(badge);
    }
  }

  // Format elements list for LLM context (compact to minimize token consumption)
  const lines = descriptors.map((d) => {
    let extra = '';
    if (d.placeholder) extra += ` placeholder="${d.placeholder}"`;
    if (d.role) extra += ` role="${d.role}"`;
    if (d.type) extra += ` type="${d.type}"`;
    if (d.href) {
      try {
        const parsed = new URL(d.href);
        extra += ` href="${parsed.pathname.slice(0, 35)}"`;
      } catch {
        extra += ` href="${d.href.slice(0, 35)}"`;
      }
    }
    const label = d.text ? ` "${d.text}"` : '';
    return `[${d.id}] <${d.tagName}>${label}${extra}`;
  });

  return {
    elements: descriptors,
    snapshotText: lines.join('\n'),
  };
}
