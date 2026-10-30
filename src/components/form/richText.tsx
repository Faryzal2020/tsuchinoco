import React from 'react';

/** Only web and mail links are allowed; anything else is shown as plain text. */
export const isSafeHref = (href: string) => /^(https?:\/\/|mailto:)/i.test(href.trim());

/** Builds the `[label](url)` token the text blocks understand. */
export const linkToken = (label: string, url: string) => `[${label.replace(/[\[\]]/g, '')}](${url.trim()})`;

// `[label](https://url)` or a bare https:// URL. Trailing punctuation stays outside bare URLs.
const TOKEN = /\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>"']+?)(?=[.,;:!?)]*(?:\s|$))/g;

/** Turns one line of block text into React nodes with clickable links. No HTML is ever interpreted. */
export function linkify(line: string, keyPrefix = ''): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of line.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    if (start > last) out.push(line.slice(last, start));
    const label = m[1] ?? m[3];
    const href = m[2] ?? m[3];
    if (isSafeHref(href)) {
      out.push(<a key={`${keyPrefix}${i++}`} className="pf-link" href={href.trim()} target="_blank" rel="noopener noreferrer">{label}</a>);
    } else {
      out.push(m[0]);
    }
    last = start + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

/** Paragraphs split on blank lines, single newlines become <br>, links clickable. */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n{2,}/).map((para, i) => (
        <p key={i}>
          {para.split('\n').map((line, j, arr) => (
            <React.Fragment key={j}>{linkify(line, `${i}-${j}-`)}{j < arr.length - 1 && <br />}</React.Fragment>
          ))}
        </p>
      ))}
    </>
  );
}
