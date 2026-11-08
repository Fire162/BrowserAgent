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
  if (rect.width === 0 || rect.height === 0) return false;

  // Check if roughly within or near viewport
  const viewHeight = window.innerHeight || document.documentElement.clientHeight;
  const viewWidth = window.innerWidth || document.documentElement.clientWidth;
  return (
    rect.top < viewHeight * 2 &&
    rect.bottom > -viewHeight &&
    rect.left < viewWidth * 1.5 &&
    rect.right > -viewWidth * 0.5
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

export function scanAndLabelElements(showVisualBadges = true): { elements: ElementDescriptor[]; snapshotText: string } {
  clearBadges();

  const interactiveSelectors = [
    'a[href]',
    'button',
    'input',
    'textarea',
    'select',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[contenteditable="true"]',
    '[onclick]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const rawElements = Array.from(document.querySelectorAll<HTMLElement>(interactiveSelectors));
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
    const id = idCounter++;
    elementMap.set(id, el);

    const rect = el.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;

    const text = (
      el.innerText ||
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      el.getAttribute('title') ||
      (el as HTMLInputElement).value ||
      ''
    ).trim().replace(/\s+/g, ' ').slice(0, 80);

    const desc: ElementDescriptor = {
      id,
      tagName: el.tagName.toLowerCase(),
      text,
      type: (el as HTMLInputElement).type,
      role: el.getAttribute('role') || undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      ariaLabel: el.getAttribute('aria-label') || undefined,
      name: el.getAttribute('name') || undefined,
      href: (el as HTMLAnchorElement).href || undefined,
      value: (el as HTMLInputElement).value || undefined,
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

  // Format elements list for LLM context
  const lines = descriptors.map((d) => {
    let extra = '';
    if (d.placeholder) extra += ` placeholder="${d.placeholder}"`;
    if (d.role) extra += ` role="${d.role}"`;
    if (d.type) extra += ` type="${d.type}"`;
    if (d.href) extra += ` href="${d.href.slice(0, 50)}"`;
    const label = d.text ? ` "${d.text}"` : '';
    return `[${d.id}] <${d.tagName}>${label}${extra}`;
  });

  return {
    elements: descriptors,
    snapshotText: lines.join('\n'),
  };
}
