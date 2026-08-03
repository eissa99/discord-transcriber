import {
  escapeHtml,
  escapeHtmlMultiline,
  formatBytes,
  safeFileName,
  safeHexColor,
  safeLinkUrl,
  safeMediaUrl,
} from './html.js';
import { renderMarkdown, type MentionIndex } from './markdown.js';
import type { MetadataIcon, RenderTranscriptOptions, TranscriptMetadataEntry } from './options.js';
import { TRANSCRIPT_SCRIPT, TRANSCRIPT_SCRIPT_HASH } from './script.js';
import { buildTranscriptStyles } from './styles.js';
import type {
  TranscriptButton,
  TranscriptCommandInteraction,
  TranscriptComponent,
  TranscriptComponentEmoji,
  TranscriptContainer,
  TranscriptData,
  TranscriptEmbed,
  TranscriptEmbedField,
  TranscriptFile,
  TranscriptForward,
  TranscriptLayoutActionRow,
  TranscriptLayoutComponent,
  TranscriptMedia,
  TranscriptMessage,
  TranscriptPart,
  TranscriptReaction,
  TranscriptSection,
  TranscriptSectionAccessory,
  TranscriptSelect,
  TranscriptSticker,
  TranscriptSystemAction,
  TranscriptThreadLastMessage,
  TranscriptThreadSummary,
  TranscriptThumbnail,
} from './types.js';

/**
 * Standalone HTML transcript renderer.
 *
 * The conversation is reproduced as it appeared in Discord: message grouping,
 * replies, mentions, markdown, custom emoji, attachments, embeds and reactions.
 *
 * Security rules, all of which are requirements rather than style choices:
 *   - Message bodies go through `renderMarkdown`, which tokenises the raw text
 *     and escapes every text leaf as it emits. Nothing else interpolates
 *     message content into markup.
 *   - Every other value from Discord is escaped exactly once, here.
 *   - The document declares a Content-Security-Policy that forbids scripts
 *     outright and restricts images to Discord's CDN, so even a rendering
 *     mistake cannot execute user content or beacon out to a third party.
 *   - Styling is a single inline <style> block; nothing is fetched at open time
 *     beyond those images, so the file reads offline with no service behind it.
 */

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  'img-src https://cdn.discordapp.com https://media.discordapp.net https://images-ext-1.discordapp.net https://images-ext-2.discordapp.net',
  // The same four hosts again for inline <video>/<audio> players. An
  // extension of the allowlist to a second element type, not a widening.
  'media-src https://cdn.discordapp.com https://media.discordapp.net https://images-ext-1.discordapp.net https://images-ext-2.discordapp.net',
  "style-src 'unsafe-inline'",
  // Exactly one script, admitted by the hash of its own bytes. Anything else -
  // including content injected through a rendering mistake - fails to match and
  // is refused. Deliberately not `unsafe-inline` and not `unsafe-hashes`, so no
  // injected inline handler runs either.
  `script-src '${TRANSCRIPT_SCRIPT_HASH}'`,
  "font-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const DEFAULT_ACCENT = '#5865f2';
const DEFAULT_FOOTER = 'Generated with discord-transcriber';

/** The render options with every default applied. */
interface ResolvedOptions {
  readonly maxBytes: number;
  readonly filenameBase: string;
  readonly title: string | null;
  readonly brandName: string | null;
  readonly logoSvg: string | null;
  readonly accent: string;
  readonly footerText: string;
  readonly favicon: string | null;
  readonly metadata: readonly TranscriptMetadataEntry[];
  readonly metadataTitle: string;
  readonly notices: readonly string[];
}

function resolveOptions(options: RenderTranscriptOptions): ResolvedOptions {
  const brand = options.brand ?? {};
  return {
    maxBytes: options.maxBytes ?? Number.POSITIVE_INFINITY,
    filenameBase: safeFileName(options.filename ?? 'transcript', 'transcript'),
    title: options.title ?? null,
    brandName: brand.name ?? null,
    logoSvg: brand.logoSvg ?? null,
    // Validated as a colour rather than escaped: escaping alone would still
    // let `red;}</style>` restyle or terminate the stylesheet.
    accent: safeHexColor(brand.accentColor) ?? DEFAULT_ACCENT,
    footerText: brand.footerText ?? DEFAULT_FOOTER,
    // The favicon obeys the same image policy as everything else: a URL off
    // Discord's CDN is dropped, not fetched.
    favicon: safeMediaUrl(options.favicon ?? null),
    metadata: options.metadata ?? [],
    metadataTitle: options.metadataTitle ?? 'Details',
    notices: options.notices ?? [],
  };
}

export function transcriptFileName(base: string, part: number, totalParts: number): string {
  return totalParts <= 1
    ? `${base}.html`
    : `${base}-part${String(part)}of${String(totalParts)}.html`;
}

/**
 * Renders the transcript, splitting it into several complete standalone files
 * when it would exceed `maxBytes`.
 *
 * Splitting keeps transcripts as files. There is deliberately no fallback that
 * uploads them anywhere else or turns them into a link.
 */
export function renderTranscript(
  data: TranscriptData,
  options: RenderTranscriptOptions = {},
): TranscriptPart[] {
  const resolved = resolveOptions(options);
  const overhead = Buffer.byteLength(
    renderDocument(data, '', { part: 1, totalParts: 9 }, resolved),
    'utf8',
  );
  const budget = Math.max(64 * 1024, resolved.maxBytes - overhead);

  const ranges = planParts(data, budget);
  const totalParts = ranges.length;

  return ranges.map((range, index) => {
    const body = renderPartBody(data, range);
    const html = renderDocument(data, body.html, { part: index + 1, totalParts }, resolved);
    return {
      filename: transcriptFileName(resolved.filenameBase, index + 1, totalParts),
      content: Buffer.from(html, 'utf8'),
      partNumber: index + 1,
      totalParts,
      messageCount: body.count,
    };
  });
}

/** A part's slice of the conversation: messages `[start, end)`. */
interface PartRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Decides where the conversation splits, by rendered size, at message
 * boundaries.
 *
 * This is a sizing pass only: each part is then rendered on its own by
 * `renderPartBody`, so a part never depends on markup that landed in a
 * different file. The estimate here renders with every jump live and global
 * grouping, which bounds the real part from above closely enough - the final
 * pass only adds one heading and one day divider at a part's top, against a
 * budget that already carries headroom.
 */
function planParts(data: TranscriptData, budget: number): PartRange[] {
  if (data.messages.length === 0) return [{ start: 0, end: 0 }];

  const allIds = new Set(data.messages.map((message) => message.id));
  const ranges: PartRange[] = [];
  let start = 0;
  let bytes = 0;
  let previousDay = '';

  data.messages.forEach((message, index) => {
    const day = message.createdAt.toISOString().slice(0, 10);
    const dayChanged = day !== previousDay;
    previousDay = day;

    const grouped = message.groupedWithPrevious && index > 0 && !dayChanged;
    let blockBytes = Buffer.byteLength(
      renderMessage(message, data.mentions, grouped, data.generatedAt, allIds),
      'utf8',
    );
    if (dayChanged) {
      blockBytes += Buffer.byteLength(renderDaySeparator(message.createdAt), 'utf8');
    }

    if (index > start && bytes + blockBytes > budget) {
      ranges.push({ start, end: index });
      start = index;
      bytes = 0;
    }
    bytes += blockBytes;
  });

  ranges.push({ start, end: data.messages.length });
  return ranges;
}

/**
 * Renders one part's conversation, complete in itself.
 *
 * Day dividers restart per part, so a continuation file opens by naming its
 * date rather than assuming the reader has the previous file beside it; the
 * first message of a part always carries its full heading, as Discord's own
 * date divider forces one; and reply jumps only link to messages that are in
 * this same file - a reply to a message in another part keeps its quoted line
 * but offers no link that could not land.
 */
function renderPartBody(data: TranscriptData, range: PartRange): { html: string; count: number } {
  if (range.end === range.start) {
    return {
      html: '<p class="doc-footer">This channel contains no messages.</p>',
      count: 0,
    };
  }

  const jumpable = new Set<string>();
  for (let index = range.start; index < range.end; index += 1) {
    const message = data.messages[index];
    if (message !== undefined) jumpable.add(message.id);
  }

  let html = '';
  let previousDay = '';

  for (let index = range.start; index < range.end; index += 1) {
    const message = data.messages[index];
    if (message === undefined) continue;

    const day = message.createdAt.toISOString().slice(0, 10);
    const dayChanged = day !== previousDay;
    previousDay = day;
    if (dayChanged) html += renderDaySeparator(message.createdAt);

    // Grouping never crosses a day divider or a file boundary: a message that
    // opens a file cannot rely on the previous one being present.
    const grouped = message.groupedWithPrevious && index > range.start && !dayChanged;
    html += renderMessage(message, data.mentions, grouped, data.generatedAt, jumpable);
  }

  return { html, count: range.end - range.start };
}

function renderDocument(
  data: TranscriptData,
  conversationHtml: string,
  part: { part: number; totalParts: number },
  resolved: ResolvedOptions,
): string {
  const title = resolved.title ?? `#${data.channelName} · ${data.guildName}`;
  const partLabel =
    part.totalParts > 1 ? ` · Part ${String(part.part)} of ${String(part.totalParts)}` : '';
  const logo = resolved.logoSvg ?? '';
  const brandLine =
    resolved.brandName === null ? '' : `<div class="brand">${escapeHtml(resolved.brandName)}</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(CONTENT_SECURITY_POLICY)}">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
${resolved.favicon === null ? '' : `<link rel="icon" href="${escapeHtml(resolved.favicon)}">\n`}<title>${escapeHtml(title + partLabel)}</title>
<style>${buildTranscriptStyles(resolved.accent)}</style>
</head>
<body>
<header class="doc-header">
  ${logo}
  <div class="doc-heading">
    ${brandLine}
    <div class="channel"><span class="hash">#</span>${escapeHtml(data.channelName)}</div>
    <div class="sub">${escapeHtml(data.guildName)}${escapeHtml(partLabel)}</div>
  </div>
</header>
${renderNotices(data, part, resolved)}
${renderMetadata(resolved)}
<div class="chat">
${conversationHtml}
</div>
<footer class="doc-footer">
  ${logo}
  <span>${escapeHtml(resolved.footerText)} · ${escapeHtml(exportedLine(data.messages.length))} · ${escapeHtml(formatDate(data.generatedAt))}</span>
</footer>
<script>${TRANSCRIPT_SCRIPT}</script>
</body>
</html>`;
}

/**
 * Glyphs for the details panel, inline so the file stays self-contained and the
 * image policy never sees them. They let a reader find the field they want by
 * shape, which a grid of identical label-and-value pairs does not.
 */
const META_ICONS: Readonly<Record<MetadataIcon, string>> = {
  tag: 'M2 5a3 3 0 0 1 3-3h4.6a3 3 0 0 1 2.1.9l8.4 8.4a3 3 0 0 1 0 4.2l-4.6 4.6a3 3 0 0 1-4.2 0L2.9 11.7A3 3 0 0 1 2 9.6V5Zm5 3a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  text: 'M4 5a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1Zm0 5a1 1 0 0 1 1-1h14a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1Zm1 4a1 1 0 1 0 0 2h9a1 1 0 1 0 0-2H5Z',
  person:
    'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm-9 9a9 9 0 0 1 18 0 1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z',
  shield: 'M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Z',
  people:
    'M8.5 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7.5 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM1 20a7.5 7.5 0 0 1 15 0 1 1 0 0 1-1 1H2a1 1 0 0 1-1-1Zm16.4 1c.4-.5.6-1 .6-1.6 0-1.6-.4-3.1-1.2-4.4A5.5 5.5 0 0 1 23 20a1 1 0 0 1-1 1h-4.6Z',
  clock:
    'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 5a1 1 0 1 0-2 0v5c0 .3.1.5.3.7l3 3a1 1 0 0 0 1.4-1.4L13 11.6V7Z',
  lock: 'M12 2a5 5 0 0 0-5 5v2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm3 7H9V7a3 3 0 1 1 6 0v2Z',
  note: 'M5 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8l-6-6H5Zm9 1.5V8a1 1 0 0 0 1 1h4.5L14 3.5ZM7 12a1 1 0 0 1 1-1h8a1 1 0 1 1 0 2H8a1 1 0 0 1-1-1Zm1 3a1 1 0 1 0 0 2h5a1 1 0 1 0 0-2H8Z',
  chat: 'M12 2c5.5 0 10 3.8 10 8.5S17.5 19 12 19c-1 0-2-.1-2.9-.4l-4.7 2.3a.6.6 0 0 1-.8-.7l1-3.6C2.9 15.2 2 13 2 10.5 2 5.8 6.5 2 12 2Z',
};

function metaIcon(icon: MetadataIcon): string {
  return (
    '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
    `<path fill="currentColor" d="${META_ICONS[icon]}"/></svg>`
  );
}

/**
 * The integrator's details panel — for the facts that are recorded nowhere
 * else in the document: who opened a ticket, why it closed, what form answers
 * it began with. Rendered only when there is something to show.
 */
function renderMetadata(resolved: ResolvedOptions): string {
  if (resolved.metadata.length === 0) return '';

  const cells = resolved.metadata
    .map(
      (item) =>
        `<div class="meta-cell${item.wide === true ? ' wide' : ''}">` +
        `<div class="k">${item.icon === undefined ? '' : metaIcon(item.icon)}${escapeHtml(item.label)}</div>` +
        // Multiline-escaped: a form answer or close reason can run to
        // paragraphs, and flattening its line breaks would misquote it.
        `<div class="v">${escapeHtmlMultiline(item.value)}</div></div>`,
    )
    .join('');

  return `<section class="panel"><h2>${escapeHtml(resolved.metadataTitle)}</h2><div class="meta-grid">${cells}</div></section>`;
}

function renderNotices(
  data: TranscriptData,
  part: { part: number; totalParts: number },
  resolved: ResolvedOptions,
): string {
  const notices: string[] = [];

  if (data.truncated) {
    notices.push(
      'This channel held more messages than the transcript limit. Only the most recent messages are included.',
    );
  }
  if (part.totalParts > 1) {
    notices.push(
      `This transcript was split into ${String(part.totalParts)} files to stay within Discord's upload limit. This is part ${String(part.part)}.`,
    );
  }
  notices.push(...resolved.notices);

  return notices.map((notice) => `<div class="notice">${escapeHtml(notice)}</div>`).join('');
}

function exportedLine(count: number): string {
  return `Exported ${String(count)} message${count === 1 ? '' : 's'}`;
}

function renderDaySeparator(date: Date): string {
  // Discord's own wording for the divider: "July 30, 2026", with no weekday.
  const label = date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `<div class="divider-day">${escapeHtml(label)}</div>`;
}

/**
 * The tag Discord puts beside an application's name. It reads APP, not BOT -
 * Discord renamed it - and is the same tag in a heading and in a reply, so both
 * render this one constant.
 */
const APP_BADGE = '<span class="badge">app</span>';

const EDITED_MARKER = '<span class="edited">(edited)</span>';

function renderMessage(
  message: TranscriptMessage,
  mentions: MentionIndex,
  grouped: boolean,
  generatedAt: Date,
  jumpable: ReadonlySet<string>,
): string {
  if (message.systemAction !== null) return renderSystemMessage(message, generatedAt, jumpable);

  const classes = ['message'];
  if (grouped) classes.push('grouped');
  else classes.push('start');
  if (message.system) classes.push('system');
  // The reply (or command-invocation) row sits above the avatar, which is
  // positioned out of flow and would otherwise be drawn across it.
  if (message.reference || message.interaction) classes.push('has-reply');

  const parts: string[] = [];

  if (grouped) {
    parts.push(
      `<span class="gutter-time" title="${escapeHtml(formatTimestampTooltip(message.createdAt))}">` +
        `${escapeHtml(formatTime(message.createdAt))}</span>`,
    );
  } else {
    parts.push(renderAvatar(message));
  }

  if (message.reference) {
    parts.push(renderReply(message, mentions, jumpable));
  } else if (message.interaction) {
    parts.push(renderInteraction(message.interaction));
  }

  if (!grouped) {
    const color = safeHexColor(message.author.color);
    const nameStyle = color === null ? '' : ` style="color:${escapeHtml(color)}"`;
    parts.push(
      '<div class="heading">' +
        `<span class="name"${nameStyle}>${escapeHtml(message.author.displayName)}</span>` +
        (message.author.bot ? APP_BADGE : '') +
        `<span class="time" title="${escapeHtml(formatTimestampTooltip(message.createdAt))}">${escapeHtml(formatDiscordTimestamp(message.createdAt, generatedAt))}</span>` +
        (message.pinned ? '<span class="edited">pinned</span>' : '') +
        '</div>',
    );
  }

  if (message.forwarded) {
    parts.push(renderForward(message.forwarded, mentions, jumpable));
  }

  // Rendered up front because whether the body shows its URL depends on whether
  // an embed actually displayed the media that URL points at.
  const embeds = message.embeds.map((embed) => renderEmbed(embed, mentions));

  const body: string[] = [];
  if (message.content.trim() !== '' && !isDisplayedAsMedia(message.content, embeds)) {
    body.push(renderMarkdown(message.content, mentions));
    if (message.editedAt) body.push(EDITED_MARKER);
  }
  // `dir="auto"` on the text alone, never on the row: the message keeps the
  // document's layout - which side the avatar is on, where the gutter is -
  // while what was written reads in the direction it was written in.
  if (body.length > 0) parts.push(`<div class="content" dir="auto">${body.join(' ')}</div>`);

  // A Components V2 message displays only what its own tree references, so its
  // uploads are already drawn by the File and MediaGallery components in it.
  // Listing them again here would show every one of them twice.
  if (message.attachments.length > 0 && !message.componentsV2) {
    parts.push(
      `<div class="attachments">${message.attachments.map(renderAttachment).join('')}</div>`,
    );
  }

  if (message.stickers.length > 0) {
    parts.push(`<div class="stickers">${message.stickers.map(renderSticker).join('')}</div>`);
  }

  for (const embed of embeds) {
    parts.push(embed.html);
  }

  const components = layoutComponents(message);
  for (const component of components) {
    parts.push(renderLayoutComponent(component, mentions));
  }

  // A Components V2 message has no content for the marker to sit beside, so it
  // follows the tree instead. Without this an edited one reads as never edited.
  if (message.editedAt && body.length === 0 && components.length > 0) {
    parts.push(EDITED_MARKER);
  }

  if (message.thread) {
    parts.push(renderThreadChip(message.thread, mentions, generatedAt));
  }

  if (message.reactions.length > 0) {
    parts.push(`<div class="reactions">${message.reactions.map(renderReaction).join('')}</div>`);
  }

  return `<div class="${classes.join(' ')}" id="m${escapeHtml(message.id)}">${parts.join('')}</div>\n`;
}

/**
 * The row Discord shows above an application's reply to a slash command:
 * "Eissa used /close". It occupies the reply slot - a command reply carries
 * no message reference, so the two never collide. The invoker's name takes
 * their role colour, and the command sits in a mention-coloured chip behind
 * the apps glyph, which is how the current client draws it.
 */
/** Discord's apps glyph, shown beside an executed command's name. */
const APPS_ICON =
  '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">' +
  '<path fill="currentColor" d="M2.06 7.61c-.25.95.31 1.92 1.26 2.18l4.3 1.15c.94.25 1.91-.31 2.17-1.26l1.15-4.3c.25-.94-.31-1.91-1.26-2.17l-4.3-1.15c-.94-.25-1.91.31-2.17 1.26l-1.15 4.3ZM12.98 7.87a2 2 0 0 0 1.75 2.95H20a2 2 0 0 0 1.76-2.95l-2.63-4.83a2 2 0 0 0-3.51 0l-2.63 4.83ZM5.86 13.27a.89.89 0 0 1 1.28 0l.75.77a.9.9 0 0 0 .54.26l1.06.12c.5.06.85.52.8 1.02l-.13 1.08c-.02.2.03.42.14.6l.56.92c.27.43.14 1-.28 1.26l-.9.58a.92.92 0 0 0-.37.48l-.36 1.02a.9.9 0 0 1-1.15.57l-1-.36a.89.89 0 0 0-.6 0l-1 .36a.9.9 0 0 1-1.15-.57l-.36-1.02a.92.92 0 0 0-.37-.48l-.9-.58a.93.93 0 0 1-.28-1.26l.56-.93c.11-.17.16-.38.14-.59l-.12-1.08c-.06-.5.3-.96.8-1.02l1.05-.12a.9.9 0 0 0 .54-.26l.75-.77ZM18.52 13.71a1.1 1.1 0 0 0-2.04 0l-.46 1.24c-.19.5-.57.88-1.07 1.07l-1.24.46a1.1 1.1 0 0 0 0 2.04l1.24.46c.5.19.88.57 1.07 1.07l.46 1.24c.35.95 1.7.95 2.04 0l.46-1.24c.19-.5.57-.88 1.07-1.07l1.24-.46a1.1 1.1 0 0 0 0-2.04l-1.24-.46a1.8 1.8 0 0 1-1.07-1.07l-.46-1.24Z"/>' +
  '</svg>';

function renderInteraction(interaction: TranscriptCommandInteraction): string {
  const avatar = safeMediaUrl(interaction.userAvatarUrl);
  const color = safeHexColor(interaction.userColor);
  const nameStyle = color === null ? '' : ` style="color:${escapeHtml(color)}"`;

  return (
    '<div class="reply">' +
    (avatar === null
      ? ''
      : `<img class="avatar-small" src="${escapeHtml(avatar)}" alt="" loading="lazy">`) +
    `<span class="name"${nameStyle}>${escapeHtml(interaction.userName)}</span>` +
    `<span class="excerpt">used <span class="mention command-mention">${APPS_ICON}${escapeHtml(interaction.commandName)}</span></span>` +
    '</div>'
  );
}

/** Discord's forward glyph, beside the Forwarded label. */
const FORWARD_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
  '<path fill="currentColor" d="M21.7 7.3a1 1 0 0 1 0 1.4l-5 5a1 1 0 0 1-1.4-1.4L18.58 9H13a7 7 0 0 0-7 7v4a1 1 0 1 1-2 0v-4a9 9 0 0 1 9-9h5.59l-3.3-3.3a1 1 0 0 1 1.42-1.4l5 5Z"/>' +
  '</svg>';

/** The chevron on the forward's origin row. */
const FORWARD_CHEVRON =
  '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">' +
  '<path fill="currentColor" d="M9.3 5.3a1 1 0 0 0 0 1.4l5.29 5.3-5.3 5.3a1 1 0 1 0 1.42 1.4l6-6a1 1 0 0 0 0-1.4l-6-6a1 1 0 0 0-1.42 0Z"/>' +
  '</svg>';

/**
 * A forwarded message, as the client draws it: a "Forwarded" label, the
 * snapshot's material inside a quoted block, and the origin - channel and
 * time - beneath it.
 */
function renderForward(
  forward: TranscriptForward,
  mentions: MentionIndex,
  jumpable: ReadonlySet<string>,
): string {
  const parts: string[] = [];

  if (forward.content.trim() !== '') {
    parts.push(
      `<div class="content" dir="auto">${renderMarkdown(forward.content, mentions)}</div>`,
    );
  }
  if (forward.attachments.length > 0) {
    parts.push(
      `<div class="attachments">${forward.attachments.map(renderAttachment).join('')}</div>`,
    );
  }
  if (forward.stickers.length > 0) {
    parts.push(`<div class="stickers">${forward.stickers.map(renderSticker).join('')}</div>`);
  }
  for (const embed of forward.embeds) {
    parts.push(renderEmbed(embed, mentions).html);
  }
  for (const component of forward.components) {
    parts.push(renderLayoutComponent(component, mentions));
  }

  return (
    '<div class="forward">' +
    `<div class="forward-label">${FORWARD_ICON}Forwarded</div>` +
    parts.join('') +
    renderForwardOrigin(forward, jumpable) +
    '</div>'
  );
}

/**
 * The forward's origin row - "#channel · time ›" - pressable as in the
 * client. When the original message is inside this very transcript the row
 * jumps to it; otherwise it links to the message on discord.com, which opens
 * the app at the original.
 */
function renderForwardOrigin(forward: TranscriptForward, jumpable: ReadonlySet<string>): string {
  const origin: string[] = [];
  if (forward.originChannelName !== null) origin.push(`#${forward.originChannelName}`);
  if (forward.originTimestamp !== null) origin.push(formatDate(forward.originTimestamp));

  const jump =
    forward.originMessageId === null ? null : jumpTarget(forward.originMessageId, jumpable);
  const href = jump === null ? safeLinkUrl(forward.originUrl) : null;

  const label = origin.length > 0 ? origin.join(' · ') : 'Original message';
  const inner = escapeHtml(label) + FORWARD_CHEVRON;

  if (jump !== null) {
    return `<a class="forward-origin" ${jump}>${inner}</a>`;
  }
  if (href !== null) {
    return `<a class="forward-origin" href="${escapeHtml(href)}" rel="noopener noreferrer nofollow" target="_blank">${inner}</a>`;
  }
  if (origin.length === 0) return '';
  return `<div class="forward-origin">${escapeHtml(label)}</div>`;
}

/**
 * The card Discord puts under a message a thread hangs off: the thread's name
 * and message count on the top line, its latest message previewed beneath -
 * avatar, author in their role colour, one clamped line of text, and the
 * clock. Static: the thread's own conversation is a separate channel,
 * transcribed on its own.
 */
function renderThreadChip(
  thread: TranscriptThreadSummary,
  mentions: MentionIndex,
  generatedAt: Date,
): string {
  const cta =
    thread.messageCount === null
      ? ''
      : `<span class="thread-cta">${escapeHtml(`${String(thread.messageCount)} Message${thread.messageCount === 1 ? '' : 's'}`)} ›</span>`;

  return (
    '<div class="thread-chip">' +
    '<div class="thread-top">' +
    `<span class="thread-name">${escapeHtml(thread.name)}</span>` +
    cta +
    '</div>' +
    renderThreadPreview(thread.lastMessage, mentions, generatedAt) +
    '</div>'
  );
}

function renderThreadPreview(
  last: TranscriptThreadLastMessage | null,
  mentions: MentionIndex,
  generatedAt: Date,
): string {
  if (last === null) return '';

  const avatar = safeMediaUrl(last.authorAvatarUrl);
  const color = safeHexColor(last.authorColor);
  const nameStyle = color === null ? '' : ` style="color:${escapeHtml(color)}"`;
  const time =
    last.createdAt === null
      ? ''
      : `<span class="thread-time" title="${escapeHtml(formatTimestampTooltip(last.createdAt))}">${escapeHtml(formatDiscordTimestamp(last.createdAt, generatedAt))}</span>`;

  return (
    '<div class="thread-bottom">' +
    (avatar === null
      ? ''
      : `<img class="thread-avatar" src="${escapeHtml(avatar)}" alt="" loading="lazy">`) +
    `<span class="thread-author"${nameStyle}>${escapeHtml(last.authorName)}</span>` +
    `<span class="thread-preview">${renderMarkdown(last.content, mentions)}</span>` +
    time +
    '</div>'
  );
}

/**
 * The message's layout tree, from whichever shape the data carries.
 *
 * Data collected by this package always fills `components`; data assembled by
 * hand may carry only the plain `actionRows`, so those are lifted into the
 * same shape rather than rendered by a second path.
 */
function layoutComponents(message: TranscriptMessage): readonly TranscriptLayoutComponent[] {
  const tree = message.components as readonly TranscriptLayoutComponent[] | undefined;
  if (tree !== undefined && tree.length > 0) return tree;

  return message.actionRows.map((row): TranscriptLayoutActionRow => ({
    kind: 'actionRow',
    components: row.components,
  }));
}

/**
 * One component, drawn the way the client draws it.
 *
 * A Components V2 message has no content and no embeds - every word of it is a
 * TextDisplay somewhere in here - so this is the whole of such a message, not
 * an ornament under it. An unrecognised kind renders nothing rather than
 * guessing.
 */
function renderLayoutComponent(
  component: TranscriptLayoutComponent,
  mentions: MentionIndex,
): string {
  switch (component.kind) {
    case 'actionRow':
      return renderActionRow(component);
    case 'container':
      return renderContainer(component, mentions);
    case 'section':
      return renderSection(component, mentions);
    case 'textDisplay':
      return `<div class="content" dir="auto">${renderMarkdown(component.content, mentions)}</div>`;
    case 'mediaGallery':
      return renderMediaGallery(component);
    case 'file':
      return renderFileCard(component);
    case 'separator':
      return renderSeparator(component);
    default:
      return '';
  }
}

/**
 * A container is the Components V2 answer to an embed, and the client draws it
 * the same way: a bordered block with its accent colour down its leading edge.
 * A container that set no accent colour keeps the border but not the colour.
 */
function renderContainer(container: TranscriptContainer, mentions: MentionIndex): string {
  const color = safeHexColor(container.color);
  const style = color === null ? '' : ` style="border-inline-start-color:${escapeHtml(color)}"`;
  const inner = container.components
    .map((component) => renderLayoutComponent(component, mentions))
    .join('');

  return `<div class="dcontainer"${style}>${inner}</div>`;
}

/** Text with its one accessory - a button or a thumbnail - beside it. */
function renderSection(section: TranscriptSection, mentions: MentionIndex): string {
  const text = section.content
    .map((component) => renderLayoutComponent(component, mentions))
    .join('');

  const accessory =
    section.accessory === null
      ? ''
      : `<div class="dsection-accessory">${renderAccessory(section.accessory)}</div>`;

  return `<div class="dsection"><div class="dsection-text">${text}</div>${accessory}</div>`;
}

function renderAccessory(accessory: TranscriptSectionAccessory): string {
  if (accessory.kind === 'thumbnail') return renderThumbnail(accessory);
  return renderComponent(accessory);
}

function renderThumbnail(thumbnail: TranscriptThumbnail): string {
  const media = pickMedia(thumbnail.media.proxyUrl, thumbnail.media.url);
  if (media === null) return '';

  const alt = escapeHtml(thumbnail.media.description ?? '');
  return `<img class="dthumb" src="${escapeHtml(media)}" alt="${alt}" loading="lazy">`;
}

/**
 * Discord tiles a gallery's items rather than stacking them, and an item whose
 * media neither copy of makes displayable is left out instead of showing as a
 * broken picture.
 */
function renderMediaGallery(gallery: { readonly items: readonly TranscriptMedia[] }): string {
  const items = gallery.items.map(renderGalleryItem).filter((item) => item !== '');
  if (items.length === 0) return '';

  return `<div class="dgallery">${items.join('')}</div>`;
}

function renderGalleryItem(item: TranscriptMedia): string {
  const media = pickMedia(item.proxyUrl, item.url);
  if (media === null) return '';

  const alt = escapeHtml(item.description ?? '');
  return `<img src="${escapeHtml(media)}" alt="${alt}" loading="lazy">`;
}

/**
 * A separator is padding, and optionally a rule. It carries no content, so it
 * is the one component that is purely a stylesheet hook.
 */
function renderSeparator(separator: {
  readonly divider: boolean;
  readonly spacing: string;
}): string {
  const classes = ['dseparator'];
  classes.push(separator.spacing === 'large' ? 'dseparator-large' : 'dseparator-small');
  if (separator.divider) classes.push('divided');

  return `<hr class="${classes.join(' ')}">`;
}

/**
 * The card Discord shows for a file it does not preview.
 *
 * A File component shows this same card whatever the file is - an image posted
 * through one is a download, not a picture - so both render through here
 * rather than through two card markups that could drift apart.
 */
function renderFileCard(file: {
  readonly name: string;
  readonly url: string | null;
  readonly size: number | null;
}): string {
  const href = safeLinkUrl(file.url);
  const label = escapeHtml(file.name);
  const link =
    href === null
      ? `<span>${label}</span>`
      : `<a href="${escapeHtml(href)}" rel="noopener noreferrer nofollow" target="_blank">${label}</a>`;

  return (
    '<div class="attachment-file">📎<div>' +
    link +
    `<div class="size">${escapeHtml(formatBytes(file.size ?? Number.NaN))}</div>` +
    '<div class="attachment-note">Served by Discord; the link may expire.</div>' +
    '</div></div>'
  );
}

/** The pin and join glyphs Discord puts in the gutter of a system row. */
const PIN_ICON =
  '<path fill="currentColor" d="M19.38 11.38a3 3 0 0 0 4.24 0l.03-.03a.5.5 0 0 0 0-.7L13.35.35a.5.5 0 0 0-.7 0l-.03.03a3 3 0 0 0 0 4.24L13 5l-2.92 2.92-3.65-.34a2 2 0 0 0-1.6.58l-.62.63a1 1 0 0 0 0 1.42l9.58 9.58a1 1 0 0 0 1.42 0l.63-.63a2 2 0 0 0 .58-1.6l-.34-3.64L19 11l.38.38ZM9.07 17.07a.5.5 0 0 1-.08.77l-5.15 3.43a.5.5 0 0 1-.63-.06l-.42-.42a.5.5 0 0 1-.06-.63L6.16 15a.5.5 0 0 1 .77-.08l2.14 2.14Z"/>';

/** Discord's boost gem, simplified to a diamond the gutter size can hold. */
const BOOST_ICON =
  '<path fill="#f47fff" d="M12 1.6 20.5 8.2a1 1 0 0 1 .3 1.2l-8 12.7a1 1 0 0 1-1.6 0l-8-12.7a1 1 0 0 1 .3-1.2L12 1.6Z"/>';

const SYSTEM_ICONS: Readonly<Record<TranscriptSystemAction, string>> = {
  pinned: PIN_ICON,
  joined:
    '<path fill="currentColor" d="M12 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM3 20a9 9 0 0 1 18 0 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  boosted: BOOST_ICON,
  boostedTier1: BOOST_ICON,
  boostedTier2: BOOST_ICON,
  boostedTier3: BOOST_ICON,
};

/**
 * How each event reads, split around the phrase Discord makes a link.
 *
 * A pin names the message it pinned, and pressing that phrase jumps to it -
 * which is the only way, in a channel of any length, to find out what was
 * pinned.
 */
const SYSTEM_TEXT: Readonly<
  Record<TranscriptSystemAction, { before: string; link: string | null; after: string }>
> = {
  pinned: { before: 'pinned ', link: 'a message', after: ' to this channel.' },
  joined: { before: 'joined the channel.', link: null, after: '' },
  boosted: { before: 'just boosted the server!', link: null, after: '' },
  boostedTier1: {
    before: 'just boosted the server! The server has achieved Level 1!',
    link: null,
    after: '',
  },
  boostedTier2: {
    before: 'just boosted the server! The server has achieved Level 2!',
    link: null,
    after: '',
  },
  boostedTier3: {
    before: 'just boosted the server! The server has achieved Level 3!',
    link: null,
    after: '',
  },
};

/**
 * A system event, laid out as Discord lays it out: an icon in the gutter and a
 * single line naming who did what, with no avatar or heading of its own.
 */
function renderSystemMessage(
  message: TranscriptMessage,
  generatedAt: Date,
  jumpable: ReadonlySet<string>,
): string {
  const action = message.systemAction;
  if (action === null) return '';

  const color = safeHexColor(message.author.color);
  const nameStyle = color === null ? '' : ` style="color:${escapeHtml(color)}"`;

  const wording = SYSTEM_TEXT[action];
  const subject =
    wording.link === null ? '' : renderSystemSubject(wording.link, message.reference, jumpable);

  return (
    `<div class="message system-event" id="m${escapeHtml(message.id)}">` +
    `<svg class="system-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${SYSTEM_ICONS[action]}</svg>` +
    '<div class="system-text">' +
    `<span class="name"${nameStyle}>${escapeHtml(message.author.displayName)}</span> ` +
    escapeHtml(wording.before) +
    subject +
    escapeHtml(wording.after) +
    `<span class="time" title="${escapeHtml(formatTimestampTooltip(message.createdAt))}">${escapeHtml(formatDiscordTimestamp(message.createdAt, generatedAt))}</span>` +
    '</div></div>\n'
  );
}

/**
 * The phrase a system event points at - "a message" on a pin.
 *
 * Discord fills the reference of a pin event with the message that was pinned,
 * so the jump target comes for free. When that message is outside the collected
 * range there is nothing to land on, and the phrase stays plain text rather
 * than becoming a link that goes nowhere.
 */
function renderSystemSubject(
  label: string,
  reference: TranscriptMessage['reference'],
  jumpable: ReadonlySet<string>,
): string {
  const jump = reference?.resolved === true ? jumpTarget(reference.messageId, jumpable) : null;

  return jump === null
    ? `<span class="system-subject">${escapeHtml(label)}</span>`
    : `<a class="system-subject" ${jump}>${escapeHtml(label)}</a>`;
}

function renderAvatar(message: TranscriptMessage): string {
  const avatar = safeMediaUrl(message.author.avatarUrl);
  return avatar === null
    ? `<div class="avatar-fallback">${escapeHtml(initial(message.author.displayName))}</div>`
    : `<img class="avatar" src="${escapeHtml(avatar)}" alt="" loading="lazy">`;
}

function renderReply(
  message: TranscriptMessage,
  mentions: MentionIndex,
  jumpable: ReadonlySet<string>,
): string {
  const reference = message.reference;
  if (!reference) return '';

  const who = reference.authorName ?? 'Unknown user';
  const color = safeHexColor(reference.authorColor);
  const nameStyle = color === null ? '' : ` style="color:${escapeHtml(color)}"`;
  const avatar = safeMediaUrl(reference.authorAvatarUrl);

  // Order is Discord's, and differs from the message heading: in a reply the
  // app tag precedes the name, where in the heading it follows it.
  return (
    '<div class="reply">' +
    renderReplyJump(reference, jumpable) +
    (avatar === null
      ? ''
      : `<img class="avatar-small" src="${escapeHtml(avatar)}" alt="" loading="lazy">`) +
    (reference.authorBot ? APP_BADGE : '') +
    `<span class="name"${nameStyle}>${escapeHtml(who)}</span>` +
    `<span class="excerpt">${renderReplyExcerpt(reference, mentions)}</span>` +
    (reference.resolved && reference.hasMedia ? REPLY_MEDIA_ICON : '') +
    '</div>'
  );
}

/**
 * The icon Discord puts after the quoted line when the message replied to
 * carried media. Inline markup rather than a fetched image, so it survives the
 * document's image policy and the file staying self-contained.
 */
const REPLY_MEDIA_ICON =
  '<svg class="reply-media-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
  '<path fill="currentColor" fill-rule="evenodd" d="M2 5a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V5Zm13.35 8.13 3.5 4.67c.37.5.02 1.2-.6 1.2H5.81a.75.75 0 0 1-.59-1.22l1.86-2.32a1.5 1.5 0 0 1 2.34 0l.5.64 2.23-2.97a2 2 0 0 1 3.2 0ZM10.2 5.98c.23-.91-.88-1.55-1.55-.9a.93.93 0 0 1-1.3 0c-.67-.65-1.78-.01-1.55.9a.93.93 0 0 1-.65 1.12c-.9.26-.9 1.54 0 1.8.48.14.77.63.65 1.12-.23.91.88 1.55 1.55.9a.93.93 0 0 1 1.3 0c.67.65 1.78.01 1.55-.9a.93.93 0 0 1 .65-1.12c.9-.26.9-1.54 0-1.8a.93.93 0 0 1-.65-1.12Z" clip-rule="evenodd"/>' +
  '</svg>';

/**
 * Makes the reply row jump to the message it answers, as pressing one does in
 * Discord: the view scrolls to it and it flashes, and the address bar is left
 * alone.
 *
 * It is a transparent overlay rather than a wrapper because the quoted text can
 * itself contain links, and an anchor cannot be nested inside another. Discord
 * separates the two the same way.
 */
function renderReplyJump(
  reference: NonNullable<TranscriptMessage['reference']>,
  jumpable: ReadonlySet<string>,
): string {
  // A message outside the collected range has no anchor to jump to.
  const jump = reference.resolved ? jumpTarget(reference.messageId, jumpable) : null;
  if (jump === null) return '';

  return `<a class="reply-jump" ${jump} aria-label="Jump to the message this replies to"></a>`;
}

/**
 * The attributes that make an element jump to a message, or null when the ID
 * is not one this document holds an anchor for - because it is not a valid
 * snowflake, or because the message it names landed in a different file of a
 * split transcript.
 *
 * Both halves are deliberate. `data-goto` is what the document's one script
 * acts on, scrolling smoothly and leaving the address bar alone. `href` is the
 * same jump as a plain anchor, so with scripts blocked it still goes somewhere.
 */
function jumpTarget(messageId: string, jumpable: ReadonlySet<string>): string | null {
  if (!/^\d{17,20}$/.test(messageId)) return null;
  if (!jumpable.has(messageId)) return null;

  const id = escapeHtml(messageId);
  return `href="#m${id}" data-goto="${id}"`;
}

/**
 * The quoted line of a reply.
 *
 * A message that is only an image or a file has no text to quote, so Discord
 * names the attachment instead of showing an empty row. Reproducing that keeps
 * a reply to a screenshot from looking like a reply to nothing.
 */
function renderReplyExcerpt(
  reference: NonNullable<TranscriptMessage['reference']>,
  mentions: MentionIndex,
): string {
  if (!reference.resolved) return '<em>message not included in this transcript</em>';

  const excerpt = reference.excerpt ?? '';
  if (excerpt.trim() !== '') return renderMarkdown(excerpt, mentions);

  return reference.hasMedia ? '<span class="attachment-hint">Click to see attachment</span>' : '';
}

function renderAttachment(attachment: {
  readonly name: string;
  readonly url: string;
  readonly size: number;
  readonly contentType: string | null;
  readonly isImage: boolean;
}): string {
  const preview = attachment.isImage ? safeMediaUrl(attachment.url) : null;

  if (preview !== null) {
    const href = safeLinkUrl(attachment.url);
    const image = `<img class="attachment-image" src="${escapeHtml(preview)}" alt="${escapeHtml(attachment.name)}" loading="lazy">`;
    return href === null
      ? image
      : `<a href="${escapeHtml(href)}" rel="noopener noreferrer nofollow" target="_blank">${image}</a>`;
  }

  // Video and audio play inline, as in the client. The URL passes the same
  // policy as an image's, and media-src admits the same four hosts - a
  // rejected URL degrades to the file card rather than a dead player.
  const media = safeMediaUrl(attachment.url);
  if (media !== null && attachment.contentType?.startsWith('video/') === true) {
    return `<video class="attachment-video" controls preload="metadata" src="${escapeHtml(media)}"></video>`;
  }
  if (media !== null && attachment.contentType?.startsWith('audio/') === true) {
    return `<audio class="attachment-audio" controls preload="metadata" src="${escapeHtml(media)}"></audio>`;
  }

  return renderFileCard(attachment);
}

interface RenderedEmbed {
  readonly html: string;
  /** The URL whose media this embed displayed, when it displayed one. */
  readonly displaysUrl: string | null;
}

/**
 * Discord unfurls a bare media link into an embed and then hides the link text,
 * showing only the picture. Reproducing that keeps a posted image or GIF from
 * appearing twice - once as a raw URL, once as the media it points at.
 *
 * Two conditions, both Discord's own: the link must be the entire message, and
 * the media must actually have been displayed. The second matters because an
 * embed whose media the image policy rejects falls back to a card - hiding the
 * URL then would drop the only trace of what was posted.
 */
function isDisplayedAsMedia(content: string, embeds: readonly RenderedEmbed[]): boolean {
  const trimmed = content.trim();
  if (trimmed === '' || /\s/.test(trimmed)) return false;

  return embeds.some((embed) => embed.displaysUrl === trimmed);
}

/** Embeds Discord renders as the picture alone, with no card around it. */
function isBareMedia(embed: TranscriptEmbed): boolean {
  return embed.kind === 'image' || embed.kind === 'gifv';
}

/**
 * Picks a displayable URL for embed media.
 *
 * An unfurl of a third-party link carries the origin URL, which the image
 * policy rejects; Discord's proxy copy of the same media is on an allowed host,
 * so it is tried first and the origin only serves Discord-hosted media.
 */
function pickMedia(proxyUrl: string | null, originUrl: string | null): string | null {
  return safeMediaUrl(proxyUrl) ?? safeMediaUrl(originUrl);
}

/**
 * Renders an image or GIF unfurl the way the client does: full width, no card,
 * linking to the original. Returns null when neither copy of the media is
 * displayable, which lets the caller fall back to a normal embed.
 */
function renderBareMedia(embed: TranscriptEmbed): string | null {
  const media =
    pickMedia(embed.imageProxyUrl, embed.imageUrl) ??
    pickMedia(embed.thumbnailProxyUrl, embed.thumbnailUrl);
  if (media === null) return null;

  const image = `<img class="media-embed" src="${escapeHtml(media)}" alt="" loading="lazy">`;
  const href = safeLinkUrl(embed.url);

  return href === null
    ? `<div class="media">${image}</div>`
    : `<div class="media"><a href="${escapeHtml(href)}" rel="noopener noreferrer nofollow" target="_blank">${image}</a></div>`;
}

/**
 * Stickers are served from the CDN by ID and format. Lottie is a vector
 * animation with no image rendering behind a URL, so it degrades to its name
 * rather than a broken picture.
 */
function renderSticker(sticker: TranscriptSticker): string {
  const label = escapeHtml(`:${sticker.name}:`);

  if (sticker.format === 'lottie' || !/^\d{17,20}$/.test(sticker.id)) {
    return `<div class="sticker-fallback" title="${label}">${label}</div>`;
  }

  const extension = sticker.format === 'gif' ? 'gif' : 'png';
  const url = safeMediaUrl(`https://media.discordapp.net/stickers/${sticker.id}.${extension}`);
  if (url === null) return `<div class="sticker-fallback" title="${label}">${label}</div>`;

  return `<img class="sticker" src="${escapeHtml(url)}" alt="${label}" title="${label}" loading="lazy">`;
}

/** Discord lays embed fields out on a twelve-column grid. */
const FIELD_COLUMNS = 12;

/** At most three inline fields share a row, as in the client. */
const MAX_FIELDS_PER_ROW = 3;

/**
 * Places embed fields the way Discord does.
 *
 * A field that is not inline takes the full width. Runs of consecutive inline
 * fields are packed up to three per row, and a short final row spreads its
 * fields across the full width rather than leaving a gap. Ignoring `inline`
 * makes a three-across status strip wrap into a ragged column.
 */
function renderEmbedFields(
  fields: readonly TranscriptEmbedField[],
  mentions: MentionIndex,
): string {
  const cells: string[] = [];
  let index = 0;

  while (index < fields.length) {
    const field = fields[index];
    if (field === undefined) break;

    if (!field.inline) {
      cells.push(renderEmbedField(field, FIELD_COLUMNS, mentions));
      index += 1;
      continue;
    }

    const run: TranscriptEmbedField[] = [];
    for (let next = fields[index]; next?.inline === true; next = fields[index]) {
      run.push(next);
      index += 1;
    }

    for (let start = 0; start < run.length; start += MAX_FIELDS_PER_ROW) {
      const row = run.slice(start, start + MAX_FIELDS_PER_ROW);
      const span = Math.floor(FIELD_COLUMNS / row.length);
      for (const inline of row) cells.push(renderEmbedField(inline, span, mentions));
    }
  }

  return cells.join('');
}

function renderEmbedField(
  field: TranscriptEmbedField,
  span: number,
  mentions: MentionIndex,
): string {
  return (
    `<div class="efield" style="grid-column:span ${String(span)}">` +
    `<div class="k">${escapeHtml(field.name)}</div>` +
    `<div class="v">${renderMarkdown(field.value, mentions)}</div>` +
    '</div>'
  );
}

function renderEmbed(embed: TranscriptEmbed, mentions: MentionIndex): RenderedEmbed {
  if (isBareMedia(embed)) {
    const media = renderBareMedia(embed);
    if (media !== null) return { html: media, displaysUrl: embed.url };
  }

  const color = safeHexColor(embed.color);
  const style = color === null ? '' : ` style="border-left-color:${escapeHtml(color)}"`;
  const parts: string[] = [];

  if (embed.authorName) {
    const icon = pickMedia(embed.authorIconProxyUrl, embed.authorIconUrl);
    const iconHtml =
      icon === null
        ? ''
        : `<img class="eauthor-icon" src="${escapeHtml(icon)}" alt="" loading="lazy">`;
    const authorHref = safeLinkUrl(embed.authorUrl);
    const name = escapeHtml(embed.authorName);
    const nameHtml =
      authorHref === null
        ? name
        : `<a href="${escapeHtml(authorHref)}" rel="noopener noreferrer nofollow" target="_blank">${name}</a>`;
    parts.push(`<div class="eauthor">${iconHtml}${nameHtml}</div>`);
  }

  if (embed.title) {
    const href = safeLinkUrl(embed.url);
    const title = escapeHtml(embed.title);
    parts.push(
      href === null
        ? `<div class="etitle">${title}</div>`
        : `<div class="etitle"><a href="${escapeHtml(href)}" rel="noopener noreferrer nofollow" target="_blank">${title}</a></div>`,
    );
  }

  if (embed.description) {
    parts.push(`<div class="edesc">${renderMarkdown(embed.description, mentions)}</div>`);
  }

  if (embed.fields.length > 0) {
    parts.push(`<div class="efields">${renderEmbedFields(embed.fields, mentions)}</div>`);
  }

  const thumbnail = pickMedia(embed.thumbnailProxyUrl, embed.thumbnailUrl);
  // A video unfurl (YouTube, say) shows its poster full width inside the
  // card, not as the corner thumbnail an article's preview takes.
  if (thumbnail !== null && embed.kind !== 'video') {
    parts.push(`<img class="ethumb" src="${escapeHtml(thumbnail)}" alt="" loading="lazy">`);
  }
  const image =
    pickMedia(embed.imageProxyUrl, embed.imageUrl) ?? (embed.kind === 'video' ? thumbnail : null);
  if (image !== null) {
    parts.push(`<img class="eimage" src="${escapeHtml(image)}" alt="" loading="lazy">`);
  }
  if (embed.footerText) {
    const icon = pickMedia(embed.footerIconProxyUrl, embed.footerIconUrl);
    const iconHtml =
      icon === null
        ? ''
        : `<img class="efooter-icon" src="${escapeHtml(icon)}" alt="" loading="lazy">`;
    parts.push(`<div class="efooter">${iconHtml}${escapeHtml(embed.footerText)}</div>`);
  }

  return {
    html: `<div class="embed"${style}>${parts.join('')}</div>`,
    displaysUrl: null,
  };
}

/**
 * The controls a message carried.
 *
 * Rendered as inert markup rather than as `<button>` elements: the document
 * forbids scripts, so anything shaped like a control that cannot act would
 * invite a press and do nothing. They keep Discord's colours and their disabled
 * state, because which controls were greyed out is part of the record.
 */
function renderActionRow(row: TranscriptLayoutActionRow): string {
  const components = row.components.map(renderComponent).join('');
  return `<div class="action-row">${components}</div>`;
}

function renderComponent(component: TranscriptComponent): string {
  return component.kind === 'button' ? renderButton(component) : renderSelect(component);
}

/**
 * The six styles the stylesheet knows. `button.style` lands in a class
 * attribute, and TranscriptData can arrive from JSON rather than from this
 * package's own collector - so it is validated like every other value from
 * outside, not trusted because the TypeScript type says so.
 */
const BUTTON_STYLE_NAMES: ReadonlySet<string> = new Set([
  'primary',
  'secondary',
  'success',
  'danger',
  'link',
  'premium',
]);

function renderButton(button: TranscriptButton): string {
  const style = BUTTON_STYLE_NAMES.has(button.style) ? button.style : 'secondary';
  const classes = ['dbutton', `dbutton-${style}`];
  if (button.disabled) classes.push('disabled');

  const emoji = button.emoji === null ? '' : renderComponentEmoji(button.emoji);
  const label = button.label === null ? '' : `<span>${escapeHtml(button.label)}</span>`;
  const inner = emoji + label;

  // A link button led somewhere real, so it stays a link. Every other style
  // triggered an interaction that no longer exists.
  const href = button.style === 'link' && !button.disabled ? safeLinkUrl(button.url) : null;

  return href === null
    ? `<span class="${classes.join(' ')}">${inner}</span>`
    : `<a class="${classes.join(' ')}" href="${escapeHtml(href)}" rel="noopener noreferrer nofollow" target="_blank">${inner}</a>`;
}

function renderSelect(select: TranscriptSelect): string {
  const classes = ['dselect'];
  if (select.disabled) classes.push('disabled');

  const label = select.placeholder ?? 'Make a selection';
  return (
    `<span class="${classes.join(' ')}">${escapeHtml(label)}` +
    '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
    '<path fill="currentColor" d="M5.3 9.3a1 1 0 0 1 1.4 0l5.3 5.29 5.3-5.3a1 1 0 1 1 1.4 1.42l-6 6a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1 0-1.42Z"/>' +
    '</svg></span>'
  );
}

function renderComponentEmoji(emoji: TranscriptComponentEmoji): string {
  if (emoji.id === null) return `<span class="bemoji">${escapeHtml(emoji.name)}</span>`;

  const url = safeMediaUrl(
    `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}`,
  );
  return url === null
    ? ''
    : `<img class="bemoji" src="${escapeHtml(url)}" alt="${escapeHtml(`:${emoji.name}:`)}" loading="lazy">`;
}

function renderReaction(reaction: TranscriptReaction): string {
  const count = `<span>${escapeHtml(String(reaction.count))}</span>`;

  if (reaction.id === null) {
    return `<span class="reaction">${escapeHtml(reaction.name)}${count}</span>`;
  }

  const url = `https://cdn.discordapp.com/emojis/${reaction.id}.${reaction.animated ? 'gif' : 'png'}`;
  const safe = safeMediaUrl(url);
  const icon =
    safe === null
      ? escapeHtml(`:${reaction.name}:`)
      : `<img src="${escapeHtml(safe)}" alt="${escapeHtml(`:${reaction.name}:`)}" loading="lazy">`;

  return `<span class="reaction">${icon}${count}</span>`;
}

function initial(name: string): string {
  // Array.from iterates code points, so a leading emoji stays intact.
  const character = Array.from(name.trim())[0];
  return (character ?? '?').toUpperCase();
}

/**
 * Every timestamp written out in full carries its zone, so a line copied out of
 * the document is still unambiguous - the convention logs, exports and audit
 * records follow. The Discord-style clocks in the conversation are a
 * reproduction and stay bare, with the zone on their tooltip.
 *
 * Fixed UTC also keeps a transcript identical wherever it is opened.
 */
function formatDate(date: Date): string {
  return `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

/** `4:30 AM`, the clock Discord shows. */
function formatClock(date: Date): string {
  const hours = date.getUTCHours();
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const suffix = hours < 12 ? 'AM' : 'PM';
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(hour)}:${minutes} ${suffix}`;
}

/**
 * A message timestamp, worded as Discord words it: the clock alone for today,
 * `Yesterday at` for the day before, and a date for anything older.
 *
 * "Today" is measured against when the transcript was generated, not when it is
 * opened. A file that reworded itself as it aged would no longer be a record of
 * anything, and this is what Discord showed at the moment the transcript was
 * made.
 *
 * The clock is UTC. Discord renders in the reader's own zone, which a document
 * that forbids scripts cannot do; the full UTC instant is on the tooltip.
 */
function formatDiscordTimestamp(date: Date, generatedAt: Date): string {
  const day = date.toISOString().slice(0, 10);
  const today = generatedAt.toISOString().slice(0, 10);
  const yesterday = new Date(generatedAt.getTime() - DAY_MS).toISOString().slice(0, 10);
  const clock = formatClock(date);

  if (day === today) return clock;
  if (day === yesterday) return `Yesterday at ${clock}`;

  const month = date.getUTCMonth() + 1;
  const dayOfMonth = date.getUTCDate();
  return `${String(month)}/${String(dayOfMonth)}/${String(date.getUTCFullYear())} ${clock}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The long form Discord shows on hover. */
function formatTimestampTooltip(date: Date): string {
  const weekday = date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${weekday} at ${formatClock(date)} UTC`;
}

function formatTime(date: Date): string {
  return formatClock(date);
}
