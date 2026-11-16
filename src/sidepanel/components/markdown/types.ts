export interface MarkdownViewerProps {
  content: string;
  isStreaming?: boolean;
  theme?: 'dark' | 'light';
  className?: string;
}

export type CalloutType = 'note' | 'tip' | 'important' | 'warning' | 'caution';
