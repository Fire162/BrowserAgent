import Prism from 'prismjs';

// Order-dependent Prism language imports
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';

const LANGUAGE_ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  rs: 'rust',
  golang: 'go',
  cs: 'csharp',
  'c++': 'cpp',
  md: 'markdown',
  html: 'markup',
  xml: 'markup',
  svg: 'markup',
};

const DISPLAY_NAMES: Record<string, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  tsx: 'TSX',
  jsx: 'JSX',
  python: 'Python',
  bash: 'Bash',
  json: 'JSON',
  css: 'CSS',
  markdown: 'Markdown',
  yaml: 'YAML',
  sql: 'SQL',
  rust: 'Rust',
  go: 'Go',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  markup: 'HTML/XML',
};

export function getLanguageDisplayName(lang?: string): string {
  if (!lang) return 'Code';
  const normalized = lang.toLowerCase().trim();
  const canonical = LANGUAGE_ALIASES[normalized] || normalized;
  return DISPLAY_NAMES[canonical] || lang.toUpperCase();
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function highlightCode(code: string, lang?: string): string {
  if (!code) return '';
  if (!lang) return escapeHtml(code);

  const normalized = lang.toLowerCase().trim();
  const grammarName = LANGUAGE_ALIASES[normalized] || normalized;
  const grammar = Prism.languages[grammarName];

  if (grammar) {
    try {
      return Prism.highlight(code, grammar, grammarName);
    } catch {
      return escapeHtml(code);
    }
  }

  return escapeHtml(code);
}
