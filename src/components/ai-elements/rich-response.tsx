"use client";
import React from 'react';
import { Response } from './response';
import { CodeBlock, CodeBlockCopyButton } from './code-block';
import { GenUI } from './genui';
import { resolveBlobReferenceToPath } from '@/features/chat-page/chat-services/chat-image-persistence-utils';

export interface RichResponseProps {
  content: string;
  /**
   * True while this message's turn is still streaming. We do NOT mount the
   * generative-UI card (json-render + recharts) mid-stream: a tall card growing
   * inside the auto-scroll Conversation thrashes the stick-to-bottom resize
   * loop ("Maximum update depth"). While streaming we show the raw spec block
   * and only swap to the rendered card once the turn completes.
   */
  streaming?: boolean;
}

/**
 * Replaces every `blob://threadId/filename` token in markdown text with
 * the same-origin `/api/images?…` URL the image service resolves it to.
 * The server-side path keeps `blob://` everywhere (so the model can't
 * see a URL it might echo back as a duplicate markdown image link) — the
 * only translation lives here, in the client renderer, right before the
 * text reaches Streamdown. Without this pass, `![alt](blob://...)`
 * markdown coming back from the model renders as `[blocked]` because
 * Streamdown's link sanitizer rejects the `blob:` scheme.
 *
 * Code-fenced blocks are split out by `parse()` before this runs, so
 * literal `blob://` inside ```code``` is left untouched.
 */
const BLOB_REF_PATTERN = /blob:\/\/[A-Za-z0-9_-]+\/[^\s)"'>]+/g;
function resolveBlobRefsInMarkdown(text: string): string {
  return text.replace(BLOB_REF_PATTERN, (m) => resolveBlobReferenceToPath(m) ?? m);
}

type Segment = { type: 'code'; language: string; code: string } | { type: 'text'; text: string };

function parse(content: string): Segment[] {
  const segments: Segment[] = [];
  const regex = /```([a-zA-Z0-9_-]*)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const language = (match[1] || 'text').toLowerCase();
    if (['mermaid', 'plantuml', 'dot', 'graphviz'].includes(language)) {
      continue;
    }

    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: content.slice(lastIndex, match.index) });
    }
    segments.push({
      type: 'code',
      language: match[1] || 'text',
      code: match[2].replace(/\n$/,'')
    });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < content.length) {
    segments.push({ type: 'text', text: content.slice(lastIndex) });
  }
  return segments;
}

export const RichResponse: React.FC<RichResponseProps> = ({ content, streaming }) => {
  const segments = React.useMemo(() => parse(content), [content]);
  // If no code segments, render whole content once to preserve full markdown context
  const hasCode = segments.some(s => s.type === 'code');
  if (!hasCode) {
    return <Response>{resolveBlobRefsInMarkdown(content)}</Response>;
  }

  return (
    <div className="flex flex-col gap-4">
      {segments.map((seg, i) => {
        if (seg.type === 'code') {
          // Generative UI: a ```genui (or ```json-render) fenced block renders
          // as real Bühler components, once the turn is no longer streaming
          // (see RichResponseProps.streaming). Detection is by explicit language
          // tag only — never by sniffing arbitrary JSON content — so a normal
          // ```json block the user wants to read stays a code block.
          if (
            !streaming &&
            (seg.language === 'genui' || seg.language === 'json-render')
          ) {
            return <GenUI key={i} json={seg.code} />;
          }
          return (
            <CodeBlock key={i} code={seg.code} language={seg.language}>
              <CodeBlockCopyButton />
            </CodeBlock>
          );
        }
        // Preserve original spacing; don't trim to keep markdown structure (headings, lists, tables)
        if (seg.text.length === 0) return null;
        return <Response key={i}>{resolveBlobRefsInMarkdown(seg.text)}</Response>;
      })}
    </div>
  );
};
