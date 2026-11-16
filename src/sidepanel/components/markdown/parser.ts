import { Marked } from 'marked';
import katex from 'katex';
import DOMPurify from 'dompurify';
import { highlightCode, getLanguageDisplayName } from './highlighter';
import { renderCalloutOrBlockquote } from './callouts';

/**
 * Balance incomplete tokens during streaming so the parser doesn't break or jump.
 */
export function normalizeStreamingMarkdown(raw: string): string {
  if (!raw) return '';
  let text = raw;

  // 1. Balance code fences (```)
  const codeFenceMatches = text.match(/```/g);
  if (codeFenceMatches && codeFenceMatches.length % 2 !== 0) {
    text += '\n```';
  }

  // 2. Balance block math ($$)
  const blockMathMatches = text.match(/\$\$/g);
  if (blockMathMatches && blockMathMatches.length % 2 !== 0) {
    text += '\n$$';
  }

  // 3. Balance inline math ($)
  const singleDollarMatches = text.match(/(?<!\\|\$)\$(?!\$)/g);
  if (singleDollarMatches && singleDollarMatches.length % 2 !== 0) {
    text += '$';
  }

  // 4. Balance bold tags at the end of string
  const boldMatches = text.match(/\*\*/g);
  if (boldMatches && boldMatches.length % 2 !== 0) {
    text += '**';
  }

  return text;
}

/**
 * Pre-processes LaTeX math, footnotes, and sub/superscript before passing to Marked.
 */
function preprocessMarkdown(raw: string): string {
  if (!raw) return '';

  const codeStash: string[] = [];

  // 1. Stash code blocks and inline code spans so math/typography rules don't mutate code
  let text = raw.replace(/(```[\s\S]*?```|`[^`\n]+`)/g, (match) => {
    codeStash.push(match);
    return `@@@CODE_STASH_${codeStash.length - 1}@@@`;
  });

  // 2. Block math: $$ ... $$ and \[ ... \]
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
    try {
      return (
        '<div class="katex-display-container my-3 overflow-x-auto text-center">' +
        katex.renderToString(math.trim(), { displayMode: true, throwOnError: false }) +
        '</div>'
      );
    } catch {
      return `<pre class="katex-error font-mono text-xs text-rose-400">$$${math}$$</pre>`;
    }
  });

  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, math) => {
    try {
      return (
        '<div class="katex-display-container my-3 overflow-x-auto text-center">' +
        katex.renderToString(math.trim(), { displayMode: true, throwOnError: false }) +
        '</div>'
      );
    } catch {
      return `<pre class="katex-error font-mono text-xs text-rose-400">\\[${math}\\]</pre>`;
    }
  });

  // 3. Inline math: \( ... \)
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_, math) => {
    try {
      return (
        '<span class="katex-inline-container">' +
        katex.renderToString(math.trim(), { displayMode: false, throwOnError: false }) +
        '</span>'
      );
    } catch {
      return `\\(${math}\\)`;
    }
  });

  // 4. Inline math: $ ... $ (avoiding currency like $50 or $5.20)
  text = text.replace(/(?<!\\|\$)\$(?!\s)([^$\n]+?)(?<!\s|\$)\$/g, (match, math) => {
    // If it's a number/currency, leave it intact
    if (/^\d+(?:\.\d+)?(?:\s*(?:USD|EUR|GBP|million|billion|k|M|B))?$/i.test(math.trim())) {
      return match;
    }
    try {
      return (
        '<span class="katex-inline-container">' +
        katex.renderToString(math.trim(), { displayMode: false, throwOnError: false }) +
        '</span>'
      );
    } catch {
      return match;
    }
  });

  // 5. Footnotes: [^1]: definition and [^1] references
  const footnoteDefs: Map<string, string> = new Map();
  text = text.replace(/^\[\^([^\]]+)\]:\s*([\s\S]+?)(?=(?:\n\[\^|\n\n\n|$))/gm, (_, id, content) => {
    footnoteDefs.set(id, content.trim());
    return '';
  });

  if (footnoteDefs.size > 0) {
    text = text.replace(/\[\^([^\]]+)\]/g, (match, id) => {
      if (!footnoteDefs.has(id)) return match;
      return `<sup><a href="#fn-${id}" id="fnref-${id}" class="footnote-ref text-sky-400 hover:underline font-mono text-[10px] ml-0.5">[${id}]</a></sup>`;
    });

    let footnotesHtml =
      '\n\n<section class="footnotes my-4 pt-3 border-t border-slate-700/60 text-xs text-slate-400"><ol class="list-decimal pl-4 space-y-1">';
    for (const [id, content] of footnoteDefs.entries()) {
      footnotesHtml += `<li id="fn-${id}">${content} <a href="#fnref-${id}" class="footnote-backref text-sky-400 hover:text-sky-300 ml-1">↩</a></li>`;
    }
    footnotesHtml += '</ol></section>';
    text += footnotesHtml;
  }

  // 6. Typography: Superscript ^text^, Subscript ~text~, Underline ++text++
  text = text.replace(/(?<!\^)\^([^\^\s]+?)\^(?!\^)/g, '<sup>$1</sup>');
  text = text.replace(/(?<!~|~)~([^~\s]+?)~(?!~)/g, '<sub>$1</sub>');
  text = text.replace(/\+\+([^\+\n]+?)\+\+/g, '<ins>$1</ins>');

  // 7. Restore stashed code blocks
  text = text.replace(/@@@CODE_STASH_(\d+)@@@/g, (_, idx) => codeStash[Number(idx)]);

  return text;
}

/**
 * Configure our custom Marked instance with full GFM, code copy buttons, tables, headings, and callouts.
 */
function createMarkedParser(): Marked {
  const m = new Marked();

  m.use({
    gfm: true,
    breaks: true,
    renderer: {
      heading({ tokens, depth, text }: any) {
        const parsed = this.parser.parseInline(tokens);
        const id = text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
        return `<h${depth} id="${id}" class="heading-${depth}">${parsed}</h${depth}>`;
      },

      code({ text, lang }: any) {
        // Mermaid diagrams
        if (lang === 'mermaid') {
          const encoded = encodeURIComponent(text);
          return `
            <div class="mermaid-block my-3 overflow-x-auto rounded-lg border border-slate-700/60 bg-slate-900/60 p-3 text-center" data-diagram="${encoded}">
              <div class="text-xs text-slate-500 font-mono animate-pulse">Rendering diagram...</div>
            </div>
          `;
        }

        const language = lang || 'text';
        const displayLang = getLanguageDisplayName(language);
        const highlighted = highlightCode(text, language);
        const encoded = encodeURIComponent(text);

        return `
          <div class="code-block-wrapper my-3 rounded-lg border border-slate-800 bg-[#0d1117] overflow-hidden text-left shadow-sm">
            <div class="code-block-header flex items-center justify-between px-3 py-1.5 bg-slate-900/90 border-b border-slate-800 text-[11px] font-mono text-slate-400 select-none">
              <span class="code-lang font-semibold tracking-wider text-sky-400">${displayLang}</span>
              <button type="button" class="copy-code-btn flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-sans text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer" data-code="${encoded}">
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                </svg>
                <span class="copy-text">Copy</span>
              </button>
            </div>
            <pre class="p-3 overflow-x-auto text-xs leading-relaxed font-mono"><code class="language-${language}">${highlighted}</code></pre>
          </div>
        `;
      },

      table(token: any) {
        let headerHtml = '';
        for (const cell of token.header) {
          const alignClass = cell.align ? ` text-${cell.align}` : '';
          const alignAttr = cell.align ? ` align="${cell.align}"` : '';
          headerHtml += `<th${alignAttr} class="px-3 py-2 bg-slate-800/80 font-semibold text-slate-200 text-xs border border-slate-700/80${alignClass}">${this.parser.parseInline(cell.tokens)}</th>`;
        }

        let bodyHtml = '';
        for (const row of token.rows) {
          bodyHtml += '<tr class="even:bg-slate-900/40 hover:bg-slate-800/30 transition-colors">';
          for (const cell of row) {
            const alignClass = cell.align ? ` text-${cell.align}` : '';
            const alignAttr = cell.align ? ` align="${cell.align}"` : '';
            bodyHtml += `<td${alignAttr} class="px-3 py-2 text-xs text-slate-300 border border-slate-700/60${alignClass}">${this.parser.parseInline(cell.tokens)}</td>`;
          }
          bodyHtml += '</tr>';
        }

        return `
          <div class="table-container my-3 max-w-full overflow-x-auto rounded-lg border border-slate-700/60 bg-slate-900/40 shadow-sm">
            <table class="w-full border-collapse text-left">
              <thead><tr class="border-b border-slate-700">${headerHtml}</tr></thead>
              <tbody>${bodyHtml}</tbody>
            </table>
          </div>
        `;
      },

      blockquote({ tokens }: any) {
        const rawContent = this.parser.parse(tokens);
        return renderCalloutOrBlockquote(rawContent);
      },

      link({ href, title, tokens }: any) {
        const parsedText = tokens ? this.parser.parseInline(tokens) : href;
        const titleAttr = title ? ` title="${title}"` : '';
        const safeHref = href.startsWith('javascript:') ? '#' : href;
        return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer"${titleAttr} class="text-sky-400 hover:text-sky-300 underline underline-offset-2">${parsedText}</a>`;
      },

      image({ href, title, text }: any) {
        const titleAttr = title ? ` title="${title}"` : '';
        return `<img src="${href}" alt="${text || ''}"${titleAttr} class="max-w-full h-auto rounded-lg border border-slate-700/60 my-2" loading="lazy" />`;
      },

      hr() {
        return `<hr class="my-4 border-slate-800" />`;
      },
    },
  });

  return m;
}

const parserInstance = createMarkedParser();

let cachedPurifier: any = null;

function getPurifier(): any {
  if (cachedPurifier && typeof cachedPurifier.sanitize === 'function') {
    return cachedPurifier;
  }
  try {
    if (typeof (DOMPurify as any)?.sanitize === 'function') {
      cachedPurifier = DOMPurify;
      return cachedPurifier;
    }
    if (typeof DOMPurify === 'function') {
      const targetWindow = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? (globalThis as any).window : null);
      if (targetWindow) {
        const inst = (DOMPurify as any)(targetWindow);
        if (inst && typeof inst.sanitize === 'function') {
          cachedPurifier = inst;
          return cachedPurifier;
        }
      }
    }
  } catch {
    // Fall back to regex sanitizer
  }
  return null;
}

function fallbackSanitize(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '')
    .replace(/\s+on\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\s+on\w+\s*=\s*[^>\s]+/gi, '')
    .replace(/href\s*=\s*(['"])javascript:[^'"]*\1/gi, 'href="#"');
}

/**
 * Strict HTML sanitization using DOMPurify with support for MathML, SVG, tables, task lists, and details/summary.
 */
export function sanitizeMarkdownHtml(dirtyHtml: string): string {
  if (!dirtyHtml) return '';
  try {
    const purifier = getPurifier();
    if (purifier && typeof purifier.sanitize === 'function') {
      return purifier.sanitize(dirtyHtml, {
        USE_PROFILES: { html: true, svg: true, mathMl: true },
        ADD_TAGS: [
          'details', 'summary', 'input', 'sup', 'sub', 'u', 'ins', 'del', 'mark', 'kbd',
          'svg', 'g', 'path', 'circle', 'line', 'polygon', 'text', 'rect',
          'math', 'mrow', 'mi', 'mn', 'mo', 'msup', 'msub', 'mfrac', 'semantics', 'annotation',
          'table', 'thead', 'tbody', 'tr', 'th', 'td'
        ],
        ADD_ATTR: [
          'target', 'rel', 'type', 'checked', 'disabled', 'align', 'data-code',
          'data-diagram', 'data-rendered', 'xmlns', 'viewBox', 'width', 'height', 'fill', 'stroke',
          'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'd', 'rx', 'ry', 'x', 'y',
          'aria-hidden', 'display'
        ],
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
        FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
        ALLOW_DATA_ATTR: true,
      });
    }
  } catch (err) {
    console.warn('[MarkdownParser] DOMPurify error, using fallback:', err);
  }
  return fallbackSanitize(dirtyHtml);
}

/**
 * Complete parse pipeline: streaming normalization -> pre-processing (math, footnotes, sub/super) -> Marked -> DOMPurify.
 */
export function parseMarkdown(content: string, isStreaming = false): string {
  if (!content) return '';
  try {
    const normalized = isStreaming ? normalizeStreamingMarkdown(content) : content;
    const preprocessed = preprocessMarkdown(normalized);
    const rawHtml = parserInstance.parse(preprocessed) as string;
    return sanitizeMarkdownHtml(rawHtml);
  } catch (err) {
    console.warn('[MarkdownParser] Parse error:', err);
    try {
      return sanitizeMarkdownHtml(content);
    } catch {
      return fallbackSanitize(content);
    }
  }
}
