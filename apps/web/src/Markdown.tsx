import { useEffect, useMemo, useRef } from 'react';
import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import type { Artifact } from '@meteor-flow/contracts';

const imageLimit = 20 * 1024 * 1024;
const escape = (text: string) => text.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!);
type Source = Pick<Artifact, 'rootId' | 'sourcePath'>;

// This resolves metadata keys only; it never opens a source filesystem path.
function resolveImage(href: string, artifacts: Artifact[], source?: Source): Artifact | undefined {
  let path: string;
  try { path = decodeURIComponent(href); } catch { return; }
  if (!path || /^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('/') || /[\\\u0000-\u001f\u007f?#]/.test(path)) return;
  const parts = source ? source.sourcePath.split('/').slice(0, -1) : [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return; parts.pop(); } else parts.push(part);
  }
  const matches = artifacts.filter(artifact => artifact.sourcePath === parts.join('/') && (!source || artifact.rootId === source.rootId));
  if (matches.length !== 1 || matches[0].size > imageLimit) return;
  return matches[0];
}

export function Summary({ markdown, artifacts, source }: { markdown: string; artifacts: Artifact[]; source?: Source }) {
  const host = useRef<HTMLDivElement>(null);
  const parser = new Marked({ renderer: {
    html: ({ text }) => escape(text),
    image: ({ href, text }) => {
      const artifact = resolveImage(href, artifacts, source);
      return artifact ? `<span data-artifact-id="${escape(artifact.id)}">${escape(text)}</span>` : escape(text);
    },
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      if (!/^https?:\/\//i.test(href) || /[\u0000-\u0020\u007f]/.test(href)) return label;
      try {
        const url = new URL(href);
        if (!['http:', 'https:'].includes(url.protocol)) return label;
        return `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${label}</a>`;
      } catch { return label; }
    },
  } });
  const html = DOMPurify.sanitize(parser.parse(markdown, { async: false }), {
    ALLOWED_TAGS: ['p','br','strong','em','del','ul','ol','li','blockquote','pre','code','h1','h2','h3','h4','table','thead','tbody','tr','td','th','hr','span','a'],
    ALLOWED_ATTR: ['href','target','rel','referrerpolicy','data-artifact-id'], ALLOW_DATA_ATTR: false,
    ADD_URI_SAFE_ATTR: ['target','rel','referrerpolicy','data-artifact-id'],
    ALLOWED_URI_REGEXP: /^https?:\/\//i,
  });
  // Polling can re-render the parent; keep React from replacing the hydrated images.
  const markup = useMemo(() => ({ __html: html }), [html]);
  useEffect(() => {
    const controller = new AbortController();
    const urls: string[] = [];
    const groups = new Map<string, HTMLElement[]>();
    host.current?.querySelectorAll<HTMLElement>('span[data-artifact-id]').forEach(element => {
      const id = element.getAttribute('data-artifact-id')!;
      groups.set(id, [...(groups.get(id) ?? []), element]);
    });
    for (const [id, images] of groups) void (async () => {
      try {
        const response = await fetch(`/api/v1/artifacts/${encodeURIComponent(id)}/content`, { credentials: 'same-origin', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
        const type = response.headers.get('content-type')?.split(';')[0];
        if (!response.ok || !type || !/^image\/(png|jpeg|gif|webp)$/.test(type) || Number(response.headers.get('content-length')) > imageLimit) { await response.body?.cancel(); throw new Error('Not a supported archived image'); }
        const blob = await response.blob();
        if (blob.size > imageLimit || controller.signal.aborted) throw new Error('Image unavailable');
        const url = URL.createObjectURL(blob); urls.push(url);
        images.forEach(element => {
          const image = document.createElement('img'); image.src = url; image.alt = element.textContent ?? '';
          image.onerror = () => image.replaceWith(document.createTextNode(image.alt));
          element.replaceWith(image);
        });
      } catch { /* The original alternative text remains visible. */ }
    })();
    return () => { controller.abort(); urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [html]);
  return <div className="markdown" ref={host} dangerouslySetInnerHTML={markup} />;
}
