import { escapeHtml, safeHexColor, safeLinkUrl } from './html.js';

/**
 * Discord message markdown, rendered to HTML.
 *
 * SECURITY MODEL - read before changing anything here.
 *
 * Message content is attacker-controlled. The invariant that keeps this safe
 * is: **the raw string is never escaped up front and then pattern-matched.**
 * Instead the raw text is tokenised first, and every *text leaf* is escaped at
 * the moment it is emitted. Structural HTML is only ever produced by this file.
 *
 * Consequences that must be preserved:
 *   - No rule emits a fragment built from unescaped input. Attributes are
 *     escaped, URLs go through `safeLinkUrl`, and IDs are matched as digits.
 *   - Nested formatting recurses through `renderInline`, so inner text is
 *     escaped by the same path rather than by a caller.
 *   - Recursion is depth-capped, so a crafted message cannot exhaust the stack.
 *   - A mention renders the *resolved* name, escaped. An unresolved mention
 *     renders its numeric ID, never the raw `<@...>` text.
 */

export interface ResolvedRole {
  readonly name: string;
  /** `#rrggbb`, or null when the role has no colour. */
  readonly color: string | null;
}

/**
 * Names for the mentions that appear in a transcript, resolved once by the
 * collector so the renderer never performs lookups.
 */
export interface MentionIndex {
  readonly users: Readonly<Record<string, string>>;
  readonly roles: Readonly<Record<string, ResolvedRole>>;
  readonly channels: Readonly<Record<string, string>>;
}

export const EMPTY_MENTIONS: MentionIndex = { users: {}, roles: {}, channels: {} };

/** Guards against pathological nesting such as `***********text***********`. */
const MAX_DEPTH = 8;

const SNOWFLAKE = String.raw`\d{17,20}`;

interface InlineRule {
  readonly name: string;
  readonly pattern: string;
  render(raw: string, mentions: MentionIndex, depth: number): string;
}

/**
 * Order matters: earlier rules win at the same position, so escapes come first,
 * code suppresses everything inside it, and longer delimiters (`***`) are tried
 * before their prefixes (`**`, `*`).
 */
const INLINE_RULES: InlineRule[] = [
  {
    // A backslash escape renders the next character literally, as Discord does.
    // Written as a quoted string rather than String.raw because the character
    // class contains a backtick, which would close a template literal.
    name: 'escaped',
    pattern: '\\\\[*_~|`>#\\[\\]()\\-]',
    render: (raw) => escapeHtml(raw.slice(1)),
  },
  {
    name: 'inlineCode',
    pattern: '``[^`]+``|`[^`\\n]+`',
    render: (raw) => {
      const value = raw.startsWith('``') ? raw.slice(2, -2) : raw.slice(1, -1);
      return `<code class="inline">${escapeHtml(value)}</code>`;
    },
  },
  {
    name: 'spoiler',
    pattern: String.raw`\|\|[\s\S]+?\|\|`,
    render: (raw, mentions, depth) =>
      `<span class="spoiler">${renderInline(raw.slice(2, -2), mentions, depth + 1)}</span>`,
  },
  {
    name: 'boldItalic',
    pattern: String.raw`\*\*\*[\s\S]+?\*\*\*`,
    render: (raw, mentions, depth) =>
      `<strong><em>${renderInline(raw.slice(3, -3), mentions, depth + 1)}</em></strong>`,
  },
  {
    name: 'bold',
    pattern: String.raw`\*\*[\s\S]+?\*\*`,
    render: (raw, mentions, depth) =>
      `<strong>${renderInline(raw.slice(2, -2), mentions, depth + 1)}</strong>`,
  },
  {
    name: 'underline',
    pattern: String.raw`__[\s\S]+?__`,
    render: (raw, mentions, depth) =>
      `<u>${renderInline(raw.slice(2, -2), mentions, depth + 1)}</u>`,
  },
  {
    name: 'strike',
    pattern: String.raw`~~[\s\S]+?~~`,
    render: (raw, mentions, depth) =>
      `<s>${renderInline(raw.slice(2, -2), mentions, depth + 1)}</s>`,
  },
  {
    name: 'italicStar',
    pattern: String.raw`\*[^*\n]+?\*`,
    render: (raw, mentions, depth) =>
      `<em>${renderInline(raw.slice(1, -1), mentions, depth + 1)}</em>`,
  },
  {
    // Underscore italics must not fire inside snake_case identifiers.
    name: 'italicUnderscore',
    pattern: String.raw`(?<![\w])_[^_\n]+?_(?![\w])`,
    render: (raw, mentions, depth) =>
      `<em>${renderInline(raw.slice(1, -1), mentions, depth + 1)}</em>`,
  },
  {
    name: 'maskedLink',
    pattern: String.raw`\[[^\]\n]{1,300}\]\([^\s()]{1,600}\)`,
    render: (raw, mentions, depth) => {
      const match = /^\[([^\]\n]+)\]\(([^\s()]+)\)$/.exec(raw);
      const label = match?.[1];
      const href = safeLinkUrl(match?.[2]);
      if (label === undefined) return escapeHtml(raw);
      const inner = renderInline(label, mentions, depth + 1);
      // An unusable target degrades to plain text rather than a dead link.
      return href === null
        ? inner
        : `<a class="link" href="${escapeHtml(href)}" rel="noopener noreferrer nofollow" target="_blank">${inner}</a>`;
    },
  },
  {
    name: 'userMention',
    pattern: String.raw`<@!?${SNOWFLAKE}>`,
    render: (raw, mentions) => {
      const id = extractId(raw);
      const name = id === null ? null : mentions.users[id];
      return mentionPill(name === undefined || name === null ? `@${id ?? 'unknown'}` : `@${name}`);
    },
  },
  {
    name: 'roleMention',
    pattern: String.raw`<@&${SNOWFLAKE}>`,
    render: (raw, mentions) => {
      const id = extractId(raw);
      const role = id === null ? undefined : mentions.roles[id];
      if (!role) return mentionPill(`@${id ?? 'unknown'}`);
      return mentionPill(`@${role.name}`, role.color);
    },
  },
  {
    name: 'channelMention',
    pattern: String.raw`<#${SNOWFLAKE}>`,
    render: (raw, mentions) => {
      const id = extractId(raw);
      const name = id === null ? undefined : mentions.channels[id];
      return mentionPill(`#${name ?? id ?? 'unknown'}`);
    },
  },
  {
    name: 'slashCommand',
    pattern: String.raw`</[\w -]{1,64}:${SNOWFLAKE}>`,
    render: (raw) => {
      const match = /^<\/([\w -]{1,64}):\d{17,20}>$/.exec(raw);
      return mentionPill(`/${match?.[1] ?? 'command'}`);
    },
  },
  {
    name: 'customEmoji',
    pattern: String.raw`<a?:\w{2,32}:${SNOWFLAKE}>`,
    render: (raw) => {
      const match = /^<(a?):(\w{2,32}):(\d{17,20})>$/.exec(raw);
      const animated = match?.[1] === 'a';
      const name = match?.[2] ?? 'emoji';
      const id = match?.[3];
      if (id === undefined) return escapeHtml(raw);
      const extension = animated ? 'gif' : 'png';
      const url = `https://cdn.discordapp.com/emojis/${id}.${extension}`;
      return `<img class="emoji" src="${escapeHtml(url)}" alt=":${escapeHtml(name)}:" title=":${escapeHtml(name)}:" loading="lazy">`;
    },
  },
  {
    name: 'timestamp',
    pattern: String.raw`<t:-?\d{1,17}(?::[tTdDfFR])?>`,
    render: (raw) => {
      const match = /^<t:(-?\d{1,17})(?::([tTdDfFR]))?>$/.exec(raw);
      const seconds = Number(match?.[1]);
      if (!Number.isFinite(seconds)) return escapeHtml(raw);
      return `<span class="timestamp-chip" title="${escapeHtml(formatAbsolute(seconds))}">${escapeHtml(
        formatTimestamp(seconds, match?.[2] ?? 'f'),
      )}</span>`;
    },
  },
  {
    name: 'globalMention',
    pattern: String.raw`@everyone|@here`,
    render: (raw) => mentionPill(raw),
  },
  {
    name: 'autoLink',
    pattern: String.raw`https?://[^\s<>"']{2,600}`,
    render: (raw) => {
      // Trailing punctuation belongs to the sentence, not to the URL.
      const trimmed = raw.replace(/[.,;:!?)\]]+$/, '');
      const href = safeLinkUrl(trimmed);
      const tail = raw.slice(trimmed.length);
      if (href === null) return escapeHtml(raw);
      return `<a class="link" href="${escapeHtml(href)}" rel="noopener noreferrer nofollow" target="_blank">${escapeHtml(trimmed)}</a>${escapeHtml(tail)}`;
    },
  },
];

const RULES_BY_NAME = new Map(INLINE_RULES.map((rule) => [rule.name, rule]));

const INLINE_PATTERN = new RegExp(
  INLINE_RULES.map((rule) => `(?<${rule.name}>${rule.pattern})`).join('|'),
  'gu',
);

/**
 * Renders the inline span of a block. Text between matches is escaped here, so
 * no caller can accidentally pass through unescaped content.
 */
function renderInline(text: string, mentions: MentionIndex, depth = 0): string {
  if (depth > MAX_DEPTH) return escapeHtml(text);

  let output = '';
  let cursor = 0;

  const pattern = new RegExp(INLINE_PATTERN.source, INLINE_PATTERN.flags);
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    output += escapeHtml(text.slice(cursor, match.index));

    const groups = match.groups ?? {};
    const name = Object.keys(groups).find((key) => groups[key] !== undefined);
    const rule = name === undefined ? undefined : RULES_BY_NAME.get(name);

    output += rule ? rule.render(match[0], mentions, depth) : escapeHtml(match[0]);
    cursor = match.index + match[0].length;

    // A zero-length match would loop forever; none of the rules can produce one,
    // but the guard costs nothing and removes the possibility entirely.
    if (match[0].length === 0) pattern.lastIndex += 1;
  }

  return output + escapeHtml(text.slice(cursor));
}

/* -------------------------------------------------------------------------- */
/* Block level                                                                */
/* -------------------------------------------------------------------------- */

const CODE_BLOCK = /```(\w{0,20})?\r?\n?([\s\S]*?)```/g;

/**
 * Renders a full message body: fenced code blocks, then block structure
 * (headings, quotes, lists), then inline formatting.
 */
export function renderMarkdown(content: string, mentions: MentionIndex = EMPTY_MENTIONS): string {
  if (content.trim() === '') return '';

  let output = '';
  let cursor = 0;
  const pattern = new RegExp(CODE_BLOCK.source, CODE_BLOCK.flags);
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    output += renderBlocks(content.slice(cursor, match.index), mentions);
    const language = match[1] ?? '';
    const body = match[2] ?? '';
    output +=
      `<pre class="code-block"${language ? ` data-language="${escapeHtml(language)}"` : ''}>` +
      `<code>${escapeHtml(body.replace(/\n$/, ''))}</code></pre>`;
    cursor = match.index + match[0].length;
  }

  return output + renderBlocks(content.slice(cursor), mentions);
}

function renderBlocks(text: string, mentions: MentionIndex): string {
  if (text === '') return '';

  const lines = text.split(/\r?\n/);
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    // `>>> ` turns the remainder of the message into one quote.
    if (/^>>>\s?/.test(line)) {
      const rest = [line.replace(/^>>>\s?/, ''), ...lines.slice(index + 1)].join('\n');
      output.push(`<blockquote>${renderBlocks(rest, mentions)}</blockquote>`);
      break;
    }

    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? '')) {
        quoted.push((lines[index] ?? '').replace(/^>\s?/, ''));
        index += 1;
      }
      output.push(`<blockquote>${renderBlocks(quoted.join('\n'), mentions)}</blockquote>`);
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const level = (heading[1] ?? '#').length;
      output.push(
        `<div class="md-heading h${String(level)}">${renderInline(heading[2] ?? '', mentions)}</div>`,
      );
      index += 1;
      continue;
    }

    if (isListItem(line)) {
      const items: string[] = [];
      let ordered = /^\s*\d+\./.test(line);
      while (index < lines.length && isListItem(lines[index] ?? '')) {
        const current = lines[index] ?? '';
        if (items.length === 0) ordered = /^\s*\d+\./.test(current);
        items.push(current.replace(/^\s*(?:[-*+]|\d+\.)\s+/, ''));
        index += 1;
      }
      const rendered = items.map((item) => `<li>${renderInline(item, mentions)}</li>`).join('');
      output.push(ordered ? `<ol>${rendered}</ol>` : `<ul>${rendered}</ul>`);
      continue;
    }

    // Plain lines accumulate into one paragraph, preserving line breaks.
    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (
        /^>>>\s?/.test(current) ||
        /^>\s?/.test(current) ||
        /^#{1,3}\s+/.test(current) ||
        isListItem(current)
      ) {
        break;
      }
      paragraph.push(current);
      index += 1;
    }
    const body = paragraph.map((item) => renderInline(item, mentions)).join('<br>');
    if (body.trim() !== '') output.push(`<p>${body}</p>`);
  }

  return output.join('');
}

function isListItem(line: string): boolean {
  return /^\s{0,8}(?:[-*+]|\d{1,3}\.)\s+\S/.test(line);
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A coloured role mention is tinted with its own colour rather than the default
 * blurple, which is how Discord renders it: the text takes the role colour and
 * the background a tenth-opacity wash of it.
 */
function mentionPill(label: string, color: string | null = null): string {
  // Validated as a colour, not merely escaped: escaping alone would still let
  // `red;background:url(...)` through as CSS inside the style attribute.
  const safe = safeHexColor(color);
  if (safe === null) return `<span class="mention">${escapeHtml(label)}</span>`;

  const style = escapeHtml(`color:${safe};background-color:${translucent(safe)}`);
  return `<span class="mention" style="${style}">${escapeHtml(label)}</span>`;
}

/** Turns a validated `#rrggbb` into the `rgba()` wash Discord uses behind it. */
function translucent(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const red = (value >> 16) & 0xff;
  const green = (value >> 8) & 0xff;
  const blue = value & 0xff;
  return `rgba(${String(red)}, ${String(green)}, ${String(blue)}, 0.1)`;
}

function extractId(raw: string): string | null {
  const match = /(\d{17,20})/.exec(raw);
  return match?.[1] ?? null;
}

function formatAbsolute(seconds: number): string {
  const date = new Date(seconds * 1000);
  // Beyond Date's ±8.64e15 ms range toISOString() throws, and the seconds are
  // user-typed - one absurd <t:...> must not abort the whole transcript.
  if (Number.isNaN(date.getTime())) return String(seconds);
  return `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

/**
 * Discord renders these in the viewer's timezone. A transcript is a fixed
 * document, so it renders UTC and keeps the exact instant in the title.
 */
function formatTimestamp(seconds: number, style: string): string {
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return String(seconds);

  const iso = date.toISOString();
  const day = iso.slice(0, 10);
  const time = iso.slice(11, 16);

  switch (style) {
    case 't':
      return time;
    case 'T':
      return iso.slice(11, 19);
    case 'd':
      return day;
    case 'D':
      return date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      });
    case 'F':
      return `${date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })} ${time}`;
    case 'R':
      return formatRelative(date);
    default:
      return `${day} ${time}`;
  }
}

function formatRelative(date: Date): string {
  const deltaMs = date.getTime() - Date.now();
  const abs = Math.abs(deltaMs);
  const units: [number, string][] = [
    [365 * 24 * 3600_000, 'year'],
    [30 * 24 * 3600_000, 'month'],
    [24 * 3600_000, 'day'],
    [3600_000, 'hour'],
    [60_000, 'minute'],
    [1000, 'second'],
  ];

  for (const [size, label] of units) {
    if (abs >= size) {
      const value = Math.round(abs / size);
      const plural = value === 1 ? label : `${label}s`;
      return deltaMs < 0 ? `${String(value)} ${plural} ago` : `in ${String(value)} ${plural}`;
    }
  }
  return 'just now';
}
