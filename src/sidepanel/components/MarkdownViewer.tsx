import React, { useMemo, useEffect, useRef } from 'react';
import mermaid from 'mermaid';
import { parseMarkdown } from './markdown/parser';
import { MarkdownViewerProps } from './markdown/types';
import 'katex/dist/katex.min.css';

export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({
  content,
  isStreaming = false,
  theme = 'dark',
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse markdown with KaTeX math, GFM tables, footnotes, callouts, and DOMPurify sanitization
  const html = useMemo(() => {
    return parseMarkdown(content, isStreaming);
  }, [content, isStreaming]);

  // Copy-to-clipboard event delegation
  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const copyBtn = (e.target as HTMLElement).closest('.copy-code-btn') as HTMLButtonElement | null;
    if (!copyBtn) return;

    const encodedCode = copyBtn.getAttribute('data-code');
    if (!encodedCode) return;

    try {
      const code = decodeURIComponent(encodedCode);
      navigator.clipboard.writeText(code).then(() => {
        const textSpan = copyBtn.querySelector('.copy-text');
        if (textSpan) textSpan.textContent = 'Copied!';
        copyBtn.classList.add('text-emerald-400');

        setTimeout(() => {
          if (textSpan) textSpan.textContent = 'Copy';
          copyBtn.classList.remove('text-emerald-400');
        }, 2000);
      });
    } catch (err) {
      console.warn('[MarkdownViewer] Copy failed:', err);
    }
  };

  // Client-side Mermaid diagrams rendering
  useEffect(() => {
    if (!containerRef.current) return;

    const mermaidBlocks = containerRef.current.querySelectorAll<HTMLElement>(
      '.mermaid-block:not([data-rendered="true"])'
    );
    if (mermaidBlocks.length === 0) return;

    try {
      mermaid.initialize({
        startOnLoad: false,
        theme: theme === 'light' ? 'default' : 'dark',
        securityLevel: 'loose',
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      });
    } catch {
      // Ignore re-initialization warnings
    }

    mermaidBlocks.forEach(async (el) => {
      const rawDiagram = el.getAttribute('data-diagram');
      if (!rawDiagram) return;

      const decoded = decodeURIComponent(rawDiagram);
      const uniqueId = `mermaid-${Math.random().toString(36).slice(2, 9)}`;

      try {
        el.setAttribute('data-rendered', 'true');
        const { svg } = await mermaid.render(uniqueId, decoded);
        el.innerHTML = svg;
      } catch (err) {
        // Fallback display if diagram is incomplete (e.g. during streaming) or has syntax errors
        const escaped = decoded
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');

        el.innerHTML = `
          <div class="text-xs text-amber-400 font-mono text-left bg-amber-950/20 p-2.5 rounded border border-amber-500/20">
            <div class="font-semibold mb-1 flex items-center gap-1.5">
              <span>Mermaid Diagram (Rendering / Preview)</span>
            </div>
            <pre class="text-[11px] text-slate-300 overflow-x-auto whitespace-pre font-mono">${escaped}</pre>
          </div>
        `;
      }
    });
  }, [html, theme]);

  const themeClass = theme === 'light' ? 'light' : 'dark';

  return (
    <div
      ref={containerRef}
      onClick={handleContainerClick}
      className={`markdown-body ${themeClass} select-text text-left max-w-full overflow-hidden ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
