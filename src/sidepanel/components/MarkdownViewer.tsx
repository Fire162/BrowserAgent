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

export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({ content, className = '' }) => {
  const html = useMemo(() => {
    if (!content) return '';
    try {
      return marked.parse(content) as string;
    } catch (err) {
      console.warn('[MarkdownViewer] Parse error:', err);
      return content;
    }
  }, [content]);

  return (
    <div
      className={`markdown-body select-text ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
