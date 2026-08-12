import React from 'react';
import styles from './MarkdownRenderer.module.css';

type MarkdownRendererProps = {
  content: string;
  className?: string;
};

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  if (!content) return null;

  const blocks = parseMarkdownBlocks(content);

  return (
    <div className={`${styles.markdownContainer}${className ? ` ${className}` : ''}`}>
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  );
}

type Block =
  | { type: 'header'; level: number; text: string }
  | { type: 'codeblock'; language: string; code: string }
  | { type: 'list'; items: string[]; ordered: boolean }
  | { type: 'paragraph'; text: string };

function parseMarkdownBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced Code Blocks (```lang)
    if (line.trim().startsWith('```')) {
      const match = line.trim().match(/^```(\w*)/);
      const language = match ? match[1] : '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({
        type: 'codeblock',
        language,
        code: codeLines.join('\n'),
      });
      continue;
    }

    // Headers (# Header)
    if (/^#{1,4}\s+/.test(line.trim())) {
      const headerMatch = line.trim().match(/^(#{1,4})\s+(.+)$/);
      if (headerMatch) {
        blocks.push({
          type: 'header',
          level: headerMatch[1].length,
          text: headerMatch[2],
        });
        i++;
        continue;
      }
    }

    // Unordered & Ordered Lists (- item, * item, 1. item)
    if (/^(\*|-|\d+\.)\s+/.test(line.trim())) {
      const listItems: string[] = [];
      const isOrdered = /^\d+\.\s+/.test(line.trim());
      while (i < lines.length && /^(\*|-|\d+\.)\s+/.test(lines[i].trim())) {
        const itemText = lines[i].trim().replace(/^(\*|-|\d+\.)\s+/, '');
        listItems.push(itemText);
        i++;
      }
      blocks.push({
        type: 'list',
        items: listItems,
        ordered: isOrdered,
      });
      continue;
    }

    // Empty lines -> separator
    if (!line.trim()) {
      i++;
      continue;
    }

    // Paragraph
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('```') &&
      !/^#{1,4}\s+/.test(lines[i].trim()) &&
      !/^(\*|-|\d+\.)\s+/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({
      type: 'paragraph',
      text: paraLines.join('\n'),
    });
  }

  return blocks;
}

function renderBlock(block: Block, index: number): React.ReactNode {
  switch (block.type) {
    case 'header': {
      const Tag = (`h${Math.min(block.level + 1, 6)}` as unknown) as React.ElementType;
      return (
        <Tag key={index} className={styles.header}>
          {renderInlineMarkdown(block.text)}
        </Tag>
      );
    }
    case 'codeblock':
      return (
        <div key={index} className={styles.codeBlockWrapper}>
          {block.language ? (
            <div className={styles.codeBlockHeader}>
              <span className={styles.codeLanguage}>{block.language}</span>
            </div>
          ) : null}
          <pre className={styles.codeBlock}>
            <code>{block.code}</code>
          </pre>
        </div>
      );
    case 'list': {
      const ListTag = block.ordered ? 'ol' : 'ul';
      return (
        <ListTag key={index} className={styles.list}>
          {block.items.map((item, itemIdx) => (
            <li key={itemIdx}>{renderInlineMarkdown(item)}</li>
          ))}
        </ListTag>
      );
    }
    case 'paragraph':
      return (
        <p key={index} className={styles.paragraph}>
          {renderInlineMarkdown(block.text)}
        </p>
      );
  }
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  // Regex to split by **bold**, `code`, and *italic*
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g);

  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className={styles.inlineCode}>
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}
