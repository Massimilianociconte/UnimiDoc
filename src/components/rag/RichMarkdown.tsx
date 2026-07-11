// Minimal, dependency-free Markdown renderer for LLM answers (RAG, AI help).
// Supports the subset the backend prompts allow: ### headings, **bold**,
// *italic*, `inline code`, bullet/numbered lists, paragraphs and [#n] source
// markers. Everything is rendered as React nodes — never innerHTML — so model
// output can't inject markup.

import type { ReactNode } from 'react'

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  // Tokenize bold / italic / code / [#n] markers.
  const pattern = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[#\d+\])/g
  const nodes: ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  let i = 0
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    const token = match[0]
    const key = `${keyPrefix}-t${i++}`
    if (token.startsWith('**')) nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    else if (token.startsWith('`')) nodes.push(<code key={key}>{token.slice(1, -1)}</code>)
    else if (token.startsWith('[#')) nodes.push(<span key={key} className="rich-md-marker">{token}</span>)
    else nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    last = match.index + token.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

type Block =
  | { kind: 'heading'; level: 3 | 4; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'p'; text: string }

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: 'p', text: paragraph.join(' ').trim() })
      paragraph = []
    }
  }
  const flushList = () => {
    if (list) {
      blocks.push(list)
      list = null
    }
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      flushParagraph()
      flushList()
      continue
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push({ kind: 'heading', level: heading[1].length <= 3 ? 3 : 4, text: heading[2] })
      continue
    }
    const bullet = line.match(/^[-*•]\s+(.*)$/)
    const numbered = line.match(/^\d+[.)]\s+(.*)$/)
    if (bullet || numbered) {
      flushParagraph()
      const kind = bullet ? 'ul' : 'ol'
      if (!list || list.kind !== kind) {
        flushList()
        list = { kind, items: [] }
      }
      list.items.push((bullet ?? numbered)![1])
      continue
    }
    flushList()
    paragraph.push(line)
  }
  flushParagraph()
  flushList()
  return blocks
}

export function RichMarkdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text)
  return (
    <div className={`rich-md ${className ?? ''}`.trim()}>
      {blocks.map((block, index) => {
        const key = `b${index}`
        if (block.kind === 'heading') {
          return block.level === 3
            ? <h3 key={key}>{renderInline(block.text, key)}</h3>
            : <h4 key={key}>{renderInline(block.text, key)}</h4>
        }
        if (block.kind === 'ul') {
          return (
            <ul key={key}>
              {block.items.map((item, j) => <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>)}
            </ul>
          )
        }
        if (block.kind === 'ol') {
          return (
            <ol key={key}>
              {block.items.map((item, j) => <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>)}
            </ol>
          )
        }
        return <p key={key}>{renderInline((block as { kind: 'p'; text: string }).text, key)}</p>
      })}
    </div>
  )
}
