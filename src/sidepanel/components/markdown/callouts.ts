import { CalloutType } from './types';

interface CalloutConfig {
  title: string;
  borderColor: string;
  bgColor: string;
  textColor: string;
  iconSvg: string;
}

const CALLOUT_CONFIGS: Record<CalloutType, CalloutConfig> = {
  note: {
    title: 'Note',
    borderColor: 'border-sky-500',
    bgColor: 'bg-sky-500/10',
    textColor: 'text-sky-400',
    iconSvg: `<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
  },
  tip: {
    title: 'Tip',
    borderColor: 'border-emerald-500',
    bgColor: 'bg-emerald-500/10',
    textColor: 'text-emerald-400',
    iconSvg: `<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>`,
  },
  important: {
    title: 'Important',
    borderColor: 'border-purple-500',
    bgColor: 'bg-purple-500/10',
    textColor: 'text-purple-400',
    iconSvg: `<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  },
  warning: {
    title: 'Warning',
    borderColor: 'border-amber-500',
    bgColor: 'bg-amber-500/10',
    textColor: 'text-amber-400',
    iconSvg: `<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  },
  caution: {
    title: 'Caution',
    borderColor: 'border-rose-500',
    bgColor: 'bg-rose-500/10',
    textColor: 'text-rose-400',
    iconSvg: `<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m14.5 9-5 5"/><path d="m9.5 9 5 5"/></svg>`,
  },
};

export function renderCalloutOrBlockquote(rawInnerHtml: string): string {
  const match = rawInnerHtml.match(
    /^\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s*<br\s*\/?>|\n)?([\s\S]*?)<\/p>([\s\S]*)$/i
  );

  if (!match) {
    return `<blockquote class="my-3 border-l-4 border-slate-600 bg-slate-900/30 pl-3 py-1.5 text-slate-300 italic text-xs rounded-r">${rawInnerHtml}</blockquote>`;
  }

  const type = match[1].toLowerCase() as CalloutType;
  const config = CALLOUT_CONFIGS[type] || CALLOUT_CONFIGS.note;
  const firstParagraph = match[2].trim();
  const restHtml = match[3] || '';

  const bodyContent = (firstParagraph ? `<p class="mb-1">${firstParagraph}</p>` : '') + restHtml;

  return `
    <div class="callout-card callout-${type} my-3 rounded-lg border-l-4 ${config.borderColor} ${config.bgColor} p-3 text-xs leading-relaxed shadow-sm">
      <div class="callout-header flex items-center gap-1.5 font-semibold ${config.textColor} text-xs mb-1.5 select-none">
        ${config.iconSvg}
        <span>${config.title}</span>
      </div>
      <div class="callout-body text-slate-200">
        ${bodyContent}
      </div>
    </div>
  `;
}
