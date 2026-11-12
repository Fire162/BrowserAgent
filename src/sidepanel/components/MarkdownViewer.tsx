import React, { useMemo } from 'react';
import { marked } from 'marked';

// Configure marked options for clean rendering inside Chrome extension side panel
marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    link({ href, title, text }) {
      const titleAttr = title ? ` title="${title}"` : '';
      return `<a href="${href}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
    },
  },
});

interface MarkdownViewerProps {
  content: string;
  className?: string;
}

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '')
    .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, '')
    .replace(/\s+on\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\s+on\w+\s*=\s*[^>\s]+/gi, '')
    .replace(/href\s*=\s*(['"])javascript:[^'"]*\1/gi, 'href="#"');
}

export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({ content, className = '' }) => {
  const html = useMemo(() => {
    if (!content) return '';
    try {
      const parsed = marked.parse(content) as string;
      return sanitizeHtml(parsed);
    } catch (err) {
      console.warn('[MarkdownViewer] Parse error:', err);
      return sanitizeHtml(content);
    }
  }, [content]);

  return (
    <div
      className={`markdown-body select-text ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
