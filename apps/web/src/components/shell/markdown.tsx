import { Fragment, type ReactNode } from 'react';

/*
 * Petit moteur Markdown sûr pour le texte des conditions d'utilisation : titres,
 * paragraphes, listes, citations, blocs de code, règles, gras, italique, code et liens. Aucun HTML
 * brut : le texte est rendu par React (échappé), un `<b>` reste `<b>` à l'écran. Les liens n'admettent
 * que http(s), mailto et les chemins de l'appli ; les autres restent du texte.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] }
  | { type: 'break' };

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { type: 'quote'; children: Block[] }
  | { type: 'code'; text: string }
  | { type: 'rule' };

const SAFE_URL = /^(https?:\/\/|mailto:|\/(?!\/)|#)/i;

export function safeHref(href: string): string | null {
  const value = href.trim();
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return null;
  return SAFE_URL.test(value) ? value : null;
}

/** Éléments en ligne : `code`, **gras**, *italique* ou _italique_, [texte](url), saut de ligne dur. */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ type: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    const rest = source.slice(i);
    if (ch === '\\' && i + 1 < source.length && /[\\`*_[\]()#+\-.!>]/.test(source[i + 1]!)) {
      text += source[i + 1];
      i += 2;
      continue;
    }
    if (ch === '\n') {
      // Deux espaces (ou une barre oblique inverse) en fin de ligne : saut de ligne dur.
      if (/ {2,}$/.test(text)) {
        text = text.replace(/ +$/, '');
        flush();
        out.push({ type: 'break' });
      } else text += ' ';
      i += 1;
      continue;
    }
    if (ch === '`') {
      const end = source.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ type: 'code', text: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    const strong = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (strong) {
      flush();
      out.push({ type: 'strong', children: parseInline(strong[2]!) });
      i += strong[0].length;
      continue;
    }
    const em = /^(\*|_)(?=\S)([\s\S]*?\S)\1(?![*_])/.exec(rest);
    if (em && !(ch === '_' && /\w/.test(source[i - 1] ?? ''))) {
      flush();
      out.push({ type: 'em', children: parseInline(em[2]!) });
      i += em[0].length;
      continue;
    }
    const link = /^\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
    if (link) {
      const href = safeHref(link[2]!);
      flush();
      if (href) out.push({ type: 'link', href, children: parseInline(link[1]!) });
      else out.push(...parseInline(link[1]!));
      i += link[0].length;
      continue;
    }
    const auto = /^<(https?:\/\/[^\s>]+)>/.exec(rest);
    if (auto) {
      flush();
      out.push({ type: 'link', href: auto[1]!, children: [{ type: 'text', text: auto[1]! }] });
      i += auto[0].length;
      continue;
    }
    text += ch;
    i += 1;
  }
  flush();
  return out;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const BULLET = /^ {0,3}[-*+]\s+(.*)$/;
const ORDERED = /^ {0,3}(\d{1,9})[.)]\s+(.*)$/;
const FENCE = /^ {0,3}(```|~~~)/;
const QUOTE = /^ {0,3}>\s?(.*)$/;

/** Blocs d'un texte Markdown (sous-ensemble CommonMark). */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.trimStart().startsWith(fence[1]!)) body.push(lines[i++]!);
      i += 1;
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6, children: parseInline(heading[2]!) });
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) body.push(QUOTE.exec(lines[i++]!)![1]!);
      blocks.push({ type: 'quote', children: parseMarkdown(body.join('\n')) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      const isOrdered = !bullet;
      const pattern = isOrdered ? ORDERED : BULLET;
      const items: string[][] = [];
      while (i < lines.length) {
        const current = lines[i]!;
        const m = pattern.exec(current);
        if (m) {
          items.push([isOrdered ? m[2]! : m[1]!]);
          i += 1;
        } else if (current.trim() !== '' && /^\s+\S/.test(current) && items.length > 0) {
          // Ligne de continuation de l'élément précédent.
          items[items.length - 1]!.push(current.trim());
          i += 1;
        } else break;
      }
      blocks.push({
        type: 'list',
        ordered: isOrdered,
        start: ordered ? Number(ordered[1]) : 1,
        items: items.map((parts) => parseInline(parts.join('\n'))),
      });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length) {
      const current = lines[i]!;
      if (current.trim() === '' || HEADING.test(current) || FENCE.test(current) || QUOTE.test(current) || BULLET.test(current) || RULE.test(current)) break;
      para.push(current);
      i += 1;
    }
    blocks.push({ type: 'paragraph', children: parseInline(para.join('\n')) });
  }
  return blocks;
}

function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={index}>{node.text}</Fragment>;
      case 'strong':
        return <strong key={index}>{renderInline(node.children)}</strong>;
      case 'em':
        return <em key={index}>{renderInline(node.children)}</em>;
      case 'code':
        return <code key={index}>{node.text}</code>;
      case 'break':
        return <br key={index} />;
      case 'link': {
        const external = /^(https?:|mailto:)/i.test(node.href);
        return (
          <a key={index} href={node.href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
            {renderInline(node.children)}
          </a>
        );
      }
    }
  });
}

function renderBlocks(blocks: Block[], headingOffset: number): ReactNode {
  return blocks.map((block, index) => {
    switch (block.type) {
      case 'heading': {
        const level = Math.min(6, block.level + headingOffset) as 1 | 2 | 3 | 4 | 5 | 6;
        const Tag = `h${level}` as const;
        return <Tag key={index}>{renderInline(block.children)}</Tag>;
      }
      case 'paragraph':
        return <p key={index}>{renderInline(block.children)}</p>;
      case 'list': {
        const items = block.items.map((item, n) => <li key={n}>{renderInline(item)}</li>);
        return block.ordered ? (
          <ol key={index} start={block.start === 1 ? undefined : block.start}>
            {items}
          </ol>
        ) : (
          <ul key={index}>{items}</ul>
        );
      }
      case 'quote':
        return <blockquote key={index}>{renderBlocks(block.children, headingOffset)}</blockquote>;
      case 'code':
        return (
          <pre key={index} dir="ltr">
            <code>{block.text}</code>
          </pre>
        );
      case 'rule':
        return <hr key={index} />;
    }
  });
}

export interface MarkdownProps {
  source: string;
  /** Décalage des titres (1 : un `#` devient h2, sous le h1 de la page). */
  headingOffset?: number;
  className?: string;
}

export function Markdown({ source, headingOffset = 1, className }: MarkdownProps) {
  return <div className={className ?? 'ud-prose'}>{renderBlocks(parseMarkdown(source), headingOffset)}</div>;
}
