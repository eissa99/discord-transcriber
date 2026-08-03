import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../src/html.js';
import { EMPTY_MENTIONS } from '../src/markdown.js';
import { TRANSCRIPT_SCRIPT, TRANSCRIPT_SCRIPT_HASH } from '../src/script.js';
import { renderTranscript, transcriptFileName } from '../src/renderer.js';
import type { RenderTranscriptOptions } from '../src/options.js';
import type {
  TranscriptButtonStyle,
  TranscriptData,
  TranscriptEmbed,
  TranscriptMessage,
} from '../src/types.js';

const BASE_DATE = new Date('2026-03-04T12:30:00.000Z');

function message(overrides: Partial<TranscriptMessage> = {}): TranscriptMessage {
  return {
    id: '900000000000000001',
    author: {
      id: '300000000000000001',
      displayName: '7sO',
      username: '7so',
      avatarUrl: 'https://cdn.discordapp.com/avatars/1/a.png',
      bot: false,
      // An arbitrary role colour, deliberately unrelated to the brand palette.
      color: '#00b0f4',
    },
    createdAt: BASE_DATE,
    editedAt: null,
    content: 'Hello, support!',
    attachments: [],
    embeds: [],
    stickers: [],
    actionRows: [],
    components: [],
    componentsV2: false,
    reference: null,
    forwarded: null,
    interaction: null,
    thread: null,
    reactions: [],
    system: false,
    systemAction: null,
    pinned: false,
    groupedWithPrevious: false,
    ...overrides,
  };
}

function data(overrides: Partial<TranscriptData> = {}): TranscriptData {
  return {
    guildName: 'Awesome Guild',
    channelName: 'support-1042',
    messages: [message()],
    truncated: false,
    generatedAt: new Date('2026-03-04T13:00:05.000Z'),
    mentions: EMPTY_MENTIONS,
    ...overrides,
  };
}

function reply(
  overrides: Partial<NonNullable<TranscriptMessage['reference']>> = {},
): NonNullable<TranscriptMessage['reference']> {
  return {
    messageId: '900000000000000002',
    authorName: 'Eissa',
    excerpt: 'Are you still there?',
    resolved: true,
    authorColor: null,
    authorAvatarUrl: 'https://cdn.discordapp.com/avatars/2/b.png',
    authorBot: false,
    hasMedia: false,
    ...overrides,
  };
}

const BIG_BUDGET = 8 * 1024 * 1024;

describe('transcript rendering', () => {
  it('produces one standalone HTML document', () => {
    const parts = renderTranscript(data(), { maxBytes: BIG_BUDGET });

    expect(parts).toHaveLength(1);
    const html = parts[0]!.content.toString('utf8');

    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('</html>');
    expect(html).toContain('support-1042');
    expect(html).toContain('Awesome Guild');
    expect(html).toContain('Hello, support!');
    expect(parts[0]!.filename).toBe('transcript.html');
  });

  it('titles the document after the channel and guild', () => {
    const html = renderTranscript(data(), { maxBytes: BIG_BUDGET })[0]!.content.toString('utf8');
    expect(html).toContain('<title>#support-1042 · Awesome Guild</title>');
  });

  it('takes a custom title', () => {
    const html = renderTranscript(data(), { maxBytes: BIG_BUDGET, title: 'Ticket 1042' })[0]!
      .content.toString('utf8');
    expect(html).toContain('<title>Ticket 1042</title>');
  });

  it('renders with no options at all', () => {
    const parts = renderTranscript(data());
    expect(parts).toHaveLength(1);
    expect(parts[0]!.content.toString('utf8')).toContain('Hello, support!');
  });

  it('is self-contained: nothing is fetched, and styling is inline', () => {
    const html = renderTranscript(data(), { maxBytes: BIG_BUDGET })[0]!.content.toString('utf8');

    expect(html).not.toContain('javascript:');
    expect(html).toContain('<style>');
    expect(html).not.toMatch(/<link[^>]+stylesheet/i);
    // The one script is inline too; nothing is loaded from anywhere.
    expect(html).not.toMatch(/<script[^>]+src=/i);
    // The only remote references allowed are Discord CDN images.
    const srcs = [...html.matchAll(/src="([^"]+)"/g)].map((match) => match[1] ?? '');
    for (const src of srcs) {
      expect(
        src.startsWith('https://cdn.discordapp.com') ||
          src.startsWith('https://media.discordapp.net'),
      ).toBe(true);
    }
  });

  it('writes every full timestamp with its zone', () => {
    const html = renderTranscript(data(), { maxBytes: BIG_BUDGET })[0]!.content.toString('utf8');

    // Self-describing rather than explained by a note elsewhere, so a line
    // copied out of the document stays unambiguous. The generation instant in
    // the footer and every tooltip in the conversation all carry it.
    expect(html).toContain('2026-03-04 13:00:05 UTC');
    expect(html).toMatch(/title="[^"]+ UTC"/);
  });

  it('carries no logo and no brand line unless one is provided', () => {
    const html = renderTranscript(data(), { maxBytes: BIG_BUDGET })[0]!.content.toString('utf8');

    expect(html).not.toContain('class="brand-mark"');
    expect(html).not.toContain('<div class="brand">');
  });

  it('declares a content security policy that admits only its own script', () => {
    const html = renderTranscript(data(), { maxBytes: BIG_BUDGET })[0]!.content.toString('utf8');

    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('default-src &#39;none&#39;');
    expect(html).toContain('form-action &#39;none&#39;');

    // A hash source, never a blanket allowance: content injected through a
    // rendering mistake cannot match it, and no inline handler runs either.
    // Escaped because base64 padding is `=`, which the attribute encodes.
    expect(html).toContain(escapeHtml(`script-src '${TRANSCRIPT_SCRIPT_HASH}'`));
    expect(html).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(html).not.toMatch(/script-src[^;]*unsafe-hashes/);
    expect(html).not.toMatch(/script-src[^;]*unsafe-eval/);
  });

  it('ships the exact bytes its policy hashes', () => {
    const html = renderTranscript(data(), { maxBytes: BIG_BUDGET })[0]!.content.toString('utf8');

    // The hash is derived from the script constant, so a drift between the two
    // is impossible by construction - this guards the wiring, not the maths.
    expect(html).toContain(`<script>${TRANSCRIPT_SCRIPT}</script>`);
    const digest = createHash('sha256').update(TRANSCRIPT_SCRIPT, 'utf8').digest('base64');
    expect(TRANSCRIPT_SCRIPT_HASH).toBe(`sha256-${digest}`);
  });

  it('keeps the jump working when scripts are blocked', () => {
    const html = renderTranscript(
      data({
        messages: [
          message({ id: '900000000000000002' }),
          message({ id: '900000000000000003', reference: reply() }),
        ],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    // `data-goto` is what the script acts on; `href` is the fallback, so a
    // reader whose browser refuses the script still lands on the message.
    expect(html).toContain('data-goto="900000000000000002"');
    expect(html).toContain('href="#m900000000000000002"');
    expect(html).toMatch(/\.message\.flash, \.message:target \{ background: var\(--jump-flash\)/);
    // Discord's wash, and a background only: a left rule is the embed's
    // language and reads as one on a message.
    expect(html).toContain('--jump-flash: #383b57');
    expect(html).not.toMatch(/\.message\.flash[^}]*box-shadow/);
  });

  it('escapes hostile content everywhere it can appear', () => {
    const payload = '<script>alert("xss")</script>';
    const parts = renderTranscript(
      data({
        channelName: payload,
        guildName: payload,
        messages: [
          message({
            content: payload,
            author: {
              id: '1',
              displayName: payload,
              username: payload,
              avatarUrl: 'javascript:alert(1)',
              bot: false,
              color: 'red;background:url(x)',
            },
            attachments: [
              {
                id: '1',
                name: payload,
                url: 'javascript:alert(1)',
                size: 10,
                contentType: 'image/png',
                isImage: true,
              },
            ],
            embeds: [
              {
                kind: 'rich',
                title: payload,
                description: payload,
                url: 'javascript:alert(1)',
                color: 'red;',
                authorName: payload,
                authorUrl: 'javascript:alert(1)',
                authorIconUrl: 'javascript:alert(1)',
                authorIconProxyUrl: 'https://evil.example.com/x.png',
                footerText: payload,
                footerIconUrl: 'https://evil.example.com/x.png',
                footerIconProxyUrl: 'javascript:alert(1)',
                imageUrl: 'javascript:alert(1)',
                thumbnailUrl: 'https://evil.example.com/x.png',
                imageProxyUrl: 'javascript:alert(1)',
                thumbnailProxyUrl: 'https://evil.example.com/x.png',
                timestamp: null,
                fields: [{ name: payload, value: payload, inline: false }],
              },
            ],
            stickers: [{ id: 'javascript:alert(1)', name: payload, format: 'png' }],
            reference: {
              messageId: '2',
              authorName: payload,
              excerpt: payload,
              resolved: true,
              authorColor: null,
              authorAvatarUrl: null,
              authorBot: false,
              hasMedia: false,
            },
          }),
        ],
      }),
      {
        maxBytes: BIG_BUDGET,
        title: payload,
        filename: '../../../etc/passwd',
        brand: { name: payload, footerText: payload, accentColor: 'red;}</style>' },
        metadata: [{ label: payload, value: payload }],
        metadataTitle: payload,
        notices: [payload],
      },
    );

    const html = parts[0]!.content.toString('utf8');

    // The document carries exactly one script - its own - so the payload
    // produced no second one anywhere it was interpolated.
    expect([...html.matchAll(/<script/g)]).toHaveLength(1);
    expect(html).toContain(`<script>${TRANSCRIPT_SCRIPT}</script>`);
    expect(html).not.toContain('alert("xss")');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('evil.example.com');
    expect(html).toContain('&lt;script&gt;');
    // A rejected avatar falls back to an initial rather than a broken image.
    expect(html).toContain('avatar-fallback');
    // A rejected colour must not reach a style attribute.
    expect(html).not.toContain('background:url');
    // A hostile accent cannot terminate the stylesheet; the default stands in.
    expect(html).toContain('--accent: #5865f2');
    // A hostile filename cannot traverse directories.
    expect(parts[0]!.filename).not.toContain('/');
    expect(parts[0]!.filename.endsWith('.html')).toBe(true);
  });

  it('marks edited, pinned, bot and system messages', () => {
    const html = renderTranscript(
      data({
        messages: [
          message({ editedAt: BASE_DATE, pinned: true }),
          message({
            id: '2',
            system: true,
            content: '7sO pinned a message.',
            author: { ...message().author, bot: true },
          }),
        ],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect(html).toContain('(edited)');
    expect(html).toContain('>pinned<');
    expect(html).toContain('message start system');
    // Discord's tag for an application reads APP, and is the same in a heading
    // as in a reply.
    expect(html).toContain('>app<');
    expect(html).not.toContain('>bot<');
  });

  it('notes when a reply points outside the transcript', () => {
    const html = renderTranscript(
      data({
        messages: [
          message({
            reference: {
              messageId: '99',
              authorName: null,
              excerpt: null,
              resolved: false,
              authorColor: null,
              authorAvatarUrl: null,
              authorBot: false,
              hasMedia: false,
            },
          }),
        ],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect(html).toContain('not included in this transcript');
  });

  it('reports truncation to whoever reads the file', () => {
    const html = renderTranscript(data({ truncated: true }), {
      maxBytes: BIG_BUDGET,
    })[0]!.content.toString('utf8');
    expect(html).toContain('more messages than the transcript limit');
  });

  it('defaults the accent to Discord blurple', () => {
    const html = renderTranscript(data(), { maxBytes: BIG_BUDGET })[0]!.content.toString('utf8');

    // Scoped to the stylesheet variable: a message author's role colour is
    // unrelated data that also lands in the document.
    expect(html).toContain('--accent: #5865f2');
    expect(html.match(/--accent:/g)).toHaveLength(1);
  });

  it('takes a custom accent for the chrome', () => {
    const html = renderTranscript(data(), {
      maxBytes: BIG_BUDGET,
      brand: { accentColor: '#9146FF' },
    })[0]!.content.toString('utf8');

    expect(html).toMatch(/--accent:\s*#9146ff/);
    expect(html.match(/--accent:/g)).toHaveLength(1);
  });

  it('marks an application in Discord blurple, not in the accent', () => {
    const html = renderTranscript(data(), {
      maxBytes: BIG_BUDGET,
      brand: { accentColor: '#9146ff' },
    })[0]!.content.toString('utf8');

    // The APP tag is Discord's own marking reproduced inside the conversation.
    // The accent belongs to the chrome around it.
    expect(html).toContain('--app-tag: #5865f2');
    expect(html).toMatch(/\.heading \.badge, \.reply \.badge \{[^}]*background: var\(--app-tag\)/);
  });

  it('renders an empty channel without failing', () => {
    const parts = renderTranscript(data({ messages: [] }), { maxBytes: BIG_BUDGET });
    expect(parts).toHaveLength(1);
    expect(parts[0]!.content.toString('utf8')).toContain('contains no messages');
  });

  it('keeps the avatar clear of the reply row above it', () => {
    const html = renderTranscript(data({ messages: [message({ reference: reply() })] }), {
      maxBytes: BIG_BUDGET,
    })[0]!.content.toString('utf8');

    // Without the marker the avatar, which is positioned out of flow, is drawn
    // across the reply row and its connector.
    expect(html).toContain('message start has-reply');
    // Discord's own metrics: a 22px row, 4px beneath it, past the message's 2px.
    expect(html).toMatch(/\.message\.has-reply \.avatar[^}]*top: 28px/);
    expect(html).toMatch(/\.reply \{[^}]*height: 22px/);
    expect(html).toMatch(/\.reply \{[^}]*margin-bottom: 4px/);
  });

  it('names the attachment when the message replied to had no text', () => {
    const html = renderTranscript(
      data({ messages: [message({ reference: reply({ excerpt: '', hasMedia: true }) })] }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect(html).toContain('Click to see attachment');
  });

  it('leaves the quoted line empty when there was nothing to quote', () => {
    const html = renderTranscript(
      data({ messages: [message({ reference: reply({ excerpt: '', hasMedia: false }) })] }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect(html).not.toContain('Click to see attachment');
    expect(html).toContain('<span class="excerpt"></span>');
  });

  it('marks a reply to a bot the way Discord does', () => {
    const html = renderTranscript(
      data({ messages: [message({ reference: reply({ authorBot: true }) })] }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    // Discord puts the app tag before the name in a reply and after it in the
    // heading, so the two orders are deliberately different.
    expect(html).toMatch(/<span class="badge">app<\/span><span class="name"[^>]*>Eissa</);
  });

  it('flags that the message replied to carried media', () => {
    const html = renderTranscript(
      data({ messages: [message({ reference: reply({ hasMedia: true }) })] }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect(html).toContain('class="reply-media-icon"');
  });

  it('does not flag media on a reply pointing outside the transcript', () => {
    const html = renderTranscript(
      data({
        messages: [message({ reference: reply({ resolved: false, hasMedia: true }) })],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    // `hasMedia` is unknowable for a message that was never collected.
    expect(html).not.toContain('class="reply-media-icon"');
  });
});

describe('embed fields', () => {
  function fieldEmbed(fields: TranscriptEmbed['fields']): TranscriptEmbed {
    return { ...mediaEmbed(), kind: 'rich', url: null, thumbnailUrl: null, fields };
  }

  it('gives a field that is not inline the full width', () => {
    const html = renderTranscript(
      data({
        messages: [
          message({ embeds: [fieldEmbed([{ name: 'Subject', value: '11111', inline: false }])] }),
        ],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect(html).toContain('style="grid-column:span 12"');
  });

  it('puts three inline fields across one row', () => {
    const html = renderTranscript(
      data({
        messages: [
          message({
            embeds: [
              fieldEmbed([
                { name: 'Created by', value: 'a', inline: true },
                { name: 'Category', value: 'b', inline: true },
                { name: 'Status', value: 'c', inline: true },
              ]),
            ],
          }),
        ],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect([...html.matchAll(/grid-column:span 4/g)]).toHaveLength(3);
  });

  it('spreads a short row of inline fields rather than leaving a gap', () => {
    const html = renderTranscript(
      data({
        messages: [
          message({
            embeds: [
              fieldEmbed([
                { name: 'a', value: '1', inline: true },
                { name: 'b', value: '2', inline: true },
              ]),
            ],
          }),
        ],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect([...html.matchAll(/grid-column:span 6/g)]).toHaveLength(2);
  });

  it('starts a new row when a full-width field interrupts inline ones', () => {
    const html = renderTranscript(
      data({
        messages: [
          message({
            embeds: [
              fieldEmbed([
                { name: 'a', value: '1', inline: true },
                { name: 'wide', value: '2', inline: false },
                { name: 'b', value: '3', inline: true },
              ]),
            ],
          }),
        ],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    // Each inline run is packed on its own, so neither pairs across the divider.
    expect([...html.matchAll(/grid-column:span 12/g)]).toHaveLength(3);
  });
});

describe('message components', () => {
  const row = (components: TranscriptMessage['actionRows'][number]['components']) => ({
    components,
  });

  it('keeps the controls a message carried', () => {
    const html = renderTranscript(
      data({
        messages: [
          message({
            actionRows: [
              row([
                {
                  kind: 'button',
                  label: 'Unclaim',
                  style: 'primary',
                  disabled: false,
                  url: null,
                  emoji: null,
                },
                {
                  kind: 'button',
                  label: 'Close ticket',
                  style: 'danger',
                  disabled: false,
                  url: null,
                  emoji: null,
                },
              ]),
            ],
          }),
        ],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    // Buttons are message content: which actions staff were offered is part of
    // the record, and the transcript used to drop them entirely.
    expect(html).toContain('Unclaim');
    expect(html).toContain('Close ticket');
    expect(html).toContain('dbutton dbutton-primary');
    expect(html).toContain('dbutton dbutton-danger');
  });

  it('records which controls were greyed out', () => {
    const html = renderTranscript(
      data({
        messages: [
          message({
            actionRows: [
              row([
                {
                  kind: 'button',
                  label: 'Remove participant',
                  style: 'primary',
                  disabled: true,
                  url: null,
                  emoji: null,
                },
              ]),
            ],
          }),
        ],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect(html).toContain('dbutton dbutton-primary disabled');
  });

  it('renders an interaction button as inert but a link button as a link', () => {
    const html = renderTranscript(
      data({
        messages: [
          message({
            actionRows: [
              row([
                {
                  kind: 'button',
                  label: 'Claim',
                  style: 'primary',
                  disabled: false,
                  url: null,
                  emoji: null,
                },
                {
                  kind: 'button',
                  label: 'Docs',
                  style: 'link',
                  disabled: false,
                  url: 'https://example.com/docs',
                  emoji: null,
                },
              ]),
            ],
          }),
        ],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    // The interaction behind Claim no longer exists; the link still leads
    // where it always did.
    expect(html).toContain('<span class="dbutton dbutton-primary"><span>Claim</span></span>');
    expect(html).toContain('<a class="dbutton dbutton-link" href="https://example.com/docs"');
  });

  it('shows a menu as the closed control it was', () => {
    const html = renderTranscript(
      data({
        messages: [
          message({
            actionRows: [row([{ kind: 'select', placeholder: 'Pick a member', disabled: false }])],
          }),
        ],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect(html).toContain('class="dselect"');
    expect(html).toContain('Pick a member');
  });
});

describe('jumping to a replied-to message', () => {
  it('links the reply to the anchor the message carries', () => {
    const html = renderTranscript(
      data({
        messages: [
          message({ id: '900000000000000002' }),
          message({ id: '900000000000000003', reference: reply() }),
        ],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect(html).toContain('id="m900000000000000002"');
    expect(html).toContain('href="#m900000000000000002"');
  });

  it('offers no jump when the message is outside the transcript', () => {
    const html = renderTranscript(
      data({ messages: [message({ reference: reply({ resolved: false }) })] }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    // There is no anchor to land on, so the row carries no link. Asserted on
    // the markup rather than the class name, which the stylesheet also holds.
    expect(html).not.toContain('<a class="reply-jump"');
    expect(html).not.toMatch(/href="#m/);
  });

  it('overlays the jump rather than wrapping the row', () => {
    const html = renderTranscript(data({ messages: [message({ reference: reply() })] }), {
      maxBytes: BIG_BUDGET,
    })[0]!.content.toString('utf8');

    // The quoted text can contain links, and an anchor cannot nest in another.
    expect(html).toMatch(/\.reply-jump \{[^}]*position: absolute/);
  });
});

describe('timestamps', () => {
  const generatedAt = new Date('2026-07-31T10:00:00.000Z');

  const at = (iso: string): string =>
    renderTranscript(data({ generatedAt, messages: [message({ createdAt: new Date(iso) })] }), {
      maxBytes: BIG_BUDGET,
    })[0]!.content.toString('utf8');

  it('shows the clock alone for the day the transcript was made', () => {
    expect(at('2026-07-31T04:30:00.000Z')).toContain('>4:30 AM<');
  });

  it('words the day before as Discord does', () => {
    expect(at('2026-07-30T14:00:00.000Z')).toContain('>Yesterday at 2:00 PM<');
  });

  it('dates anything older', () => {
    expect(at('2026-07-26T09:09:00.000Z')).toContain('>7/26/2026 9:09 AM<');
  });

  it('keeps the full instant on the tooltip', () => {
    expect(at('2026-07-26T09:09:00.000Z')).toContain('title="Sunday, 26 July 2026 at 9:09 AM UTC"');
  });

  it('names the day on a divider the way Discord does', () => {
    expect(at('2026-07-30T14:00:00.000Z')).toContain('>July 30, 2026<');
  });

  it('measures today against generation, not against when it is opened', () => {
    // A file that reworded itself as it aged would stop being a record.
    const first = at('2026-07-31T04:30:00.000Z');
    const second = at('2026-07-31T04:30:00.000Z');
    expect(first).toBe(second);
  });
});

describe('system events', () => {
  it('words a pin, which Discord sends with no content at all', () => {
    const html = renderTranscript(
      data({
        messages: [message({ content: '', system: true, systemAction: 'pinned' })],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect(html).toContain('pinned ');
    expect(html).toContain('a message');
    expect(html).toContain(' to this channel.');
    expect(html).toContain('class="system-icon"');
    // Discord gives a system event no avatar and no heading of its own.
    expect(html).not.toContain('class="avatar"');
    expect(html).not.toContain('class="heading"');
  });

  it('jumps to the message a pin points at', () => {
    const html = renderTranscript(
      data({
        messages: [
          message({ id: '900000000000000002' }),
          message({
            id: '3',
            content: '',
            system: true,
            systemAction: 'pinned',
            reference: reply(),
          }),
        ],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    // Discord fills a pin event's reference with the message that was pinned,
    // which in a long channel is the only way to find out what it was.
    expect(html).toContain(
      '<a class="system-subject" href="#m900000000000000002" data-goto="900000000000000002">a message</a>',
    );
  });

  it('leaves the phrase plain when the pinned message is not in the transcript', () => {
    const html = renderTranscript(
      data({
        messages: [message({ content: '', system: true, systemAction: 'pinned', reference: null })],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect(html).toContain('<span class="system-subject">a message</span>');
  });

  it('leaves an unnamed system message on the ordinary path', () => {
    const html = renderTranscript(
      data({
        messages: [message({ content: 'Something happened.', system: true, systemAction: null })],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect(html).toContain('message start system');
    expect(html).toContain('Something happened.');
  });
});

const GIF_URL = 'https://cdn.discordapp.com/attachments/1/2/meme.gif';

function mediaEmbed(overrides: Partial<TranscriptEmbed> = {}): TranscriptEmbed {
  return {
    kind: 'image',
    title: null,
    description: null,
    url: GIF_URL,
    color: null,
    authorName: null,
    authorUrl: null,
    authorIconUrl: null,
    authorIconProxyUrl: null,
    footerText: null,
    footerIconUrl: null,
    footerIconProxyUrl: null,
    imageUrl: null,
    thumbnailUrl: GIF_URL,
    imageProxyUrl: null,
    thumbnailProxyUrl: null,
    timestamp: null,
    fields: [],
    ...overrides,
  };
}

describe('posted images and GIFs', () => {
  it('shows the picture itself rather than a thumbnail in a card', () => {
    const html = renderTranscript(
      data({ messages: [message({ content: GIF_URL, embeds: [mediaEmbed()] })] }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect(html).toContain(`<img class="media-embed" src="${GIF_URL}"`);
    // The bordered embed card and its 80px thumbnail are what made a posted GIF
    // read as a link preview.
    expect(html).not.toContain('class="ethumb"');
    expect(html).not.toContain('class="embed"');
  });

  it('hides the URL when the link is the whole message, as Discord does', () => {
    const html = renderTranscript(
      data({ messages: [message({ content: GIF_URL, embeds: [mediaEmbed()] })] }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect(html).not.toContain('<a class="link"');
  });

  it('keeps the URL visible when the message also says something', () => {
    const html = renderTranscript(
      data({ messages: [message({ content: `look at this ${GIF_URL}`, embeds: [mediaEmbed()] })] }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect(html).toContain('look at this');
    expect(html).toContain('<a class="link"');
    expect(html).toContain('class="media-embed"');
  });

  it('displays a third-party GIF through the Discord proxy the policy allows', () => {
    const proxy = 'https://images-ext-1.discordapp.net/external/abc/tenor.gif';
    const html = renderTranscript(
      data({
        messages: [
          message({
            content: 'https://tenor.com/view/funny-123',
            embeds: [
              mediaEmbed({
                kind: 'gifv',
                url: 'https://tenor.com/view/funny-123',
                thumbnailUrl: 'https://media.tenor.com/abc/tenor.gif',
                thumbnailProxyUrl: proxy,
              }),
            ],
          }),
        ],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    // The origin URL is on a host the image policy rejects; only the proxy copy
    // is displayable, so falling back to the origin would show nothing at all.
    expect(html).toContain(`src="${proxy}"`);
    expect(html).not.toContain('media.tenor.com');
  });

  it('keeps the URL when no copy of the media is displayable', () => {
    const html = renderTranscript(
      data({
        messages: [
          message({
            content: 'https://example.com/x.png',
            embeds: [
              mediaEmbed({
                url: 'https://example.com/x.png',
                thumbnailUrl: 'https://example.com/x.png',
              }),
            ],
          }),
        ],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    // Hiding the URL is only safe once the picture has replaced it. The image
    // policy rejects this host, so suppressing the link too would leave the
    // message blank and lose what was posted.
    expect(html).toContain('<a class="link"');
    expect(html).toContain('https://example.com/x.png');
    expect(html).not.toContain('class="media-embed"');
  });
});

describe('stickers', () => {
  it('renders a sticker as its image', () => {
    const html = renderTranscript(
      data({
        messages: [
          message({
            content: '',
            stickers: [{ id: '11111111111111111', name: 'wave', format: 'png' }],
          }),
        ],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect(html).toContain(
      '<img class="sticker" src="https://media.discordapp.net/stickers/11111111111111111.png"',
    );
    expect(html).toContain('alt=":wave:"');
  });

  it('serves an animated sticker as a GIF', () => {
    const html = renderTranscript(
      data({
        messages: [
          message({
            content: '',
            stickers: [{ id: '11111111111111111', name: 'dance', format: 'gif' }],
          }),
        ],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect(html).toContain('stickers/11111111111111111.gif');
  });

  it('names a Lottie sticker instead of linking a picture that does not exist', () => {
    const html = renderTranscript(
      data({
        messages: [
          message({
            content: '',
            stickers: [{ id: '11111111111111111', name: 'hello', format: 'lottie' }],
          }),
        ],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect(html).toContain('sticker-fallback');
    expect(html).toContain(':hello:');
    expect(html).not.toContain('stickers/11111111111111111');
  });
});

describe('oversized transcripts', () => {
  const many = Array.from({ length: 400 }, (_value, index) =>
    message({ id: String(index), content: `Message number ${String(index)} `.repeat(40) }),
  );

  it('splits into several complete standalone files instead of hosting anything', () => {
    const parts = renderTranscript(data({ messages: many }), { maxBytes: 200 * 1024 });

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      const html = part.content.toString('utf8');
      expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
      expect(html).toContain('</html>');
      expect(html).toContain('Part ');
      expect(html).toContain('split into');
      expect(part.totalParts).toBe(parts.length);
      // No part may point at a hosted copy.
      expect(html).not.toContain('View online');
    }

    expect(parts.map((part) => part.partNumber)).toEqual(
      Array.from({ length: parts.length }, (_value, index) => index + 1),
    );
  });

  it('preserves every message across the split', () => {
    const parts = renderTranscript(data({ messages: many }), { maxBytes: 200 * 1024 });
    const total = parts.reduce((sum, part) => sum + part.messageCount, 0);
    expect(total).toBe(many.length);
  });

  it('names split files distinctly', () => {
    expect(transcriptFileName('transcript-general', 1, 1)).toBe('transcript-general.html');
    expect(transcriptFileName('transcript-general', 2, 3)).toBe(
      'transcript-general-part2of3.html',
    );

    const parts = renderTranscript(data({ messages: many }), {
      maxBytes: 200 * 1024,
      filename: 'my-log',
    });
    const names = new Set(parts.map((part) => part.filename));
    expect(names.size).toBe(parts.length);
    for (const name of names) {
      expect(name.startsWith('my-log')).toBe(true);
      expect(name.endsWith('.html')).toBe(true);
    }
  });
});

describe('branding and chrome options', () => {
  const LOGO =
    '<svg class="brand-mark" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg">' +
    '<circle cx="5" cy="5" r="5" fill="currentColor"/></svg>';

  const render = (options: RenderTranscriptOptions): string =>
    renderTranscript(data(), { maxBytes: BIG_BUDGET, ...options })[0]!.content.toString('utf8');

  it('carries a provided logo in the header as well as the footer', () => {
    const html = render({ brand: { logoSvg: LOGO } });

    // One constant, sized per context by the stylesheet: an inline <svg> has no
    // intrinsic size, so the stylesheet must give it one.
    expect([...html.matchAll(/class="brand-mark"/g)]).toHaveLength(2);
    expect(html).toMatch(/\.doc-header \.brand-mark \{[^}]*width: 44px/);
    expect(html).toMatch(/\.doc-footer \.brand-mark \{[^}]*width: 16px/);
    // Inline markup, not an image: a URL to some host would break both the
    // img-src policy and the promise that the file reads offline.
    expect(html).not.toMatch(/<img[^>]+brand-mark/);
  });

  it('shows the brand name above the channel name', () => {
    const html = render({ brand: { name: 'CastCord Support' } });
    expect(html).toContain('<div class="brand">CastCord Support</div>');
  });

  it('names this library in the footer by default', () => {
    const html = render({});
    expect(html).toContain('Generated with discord-transcriber');
  });

  it('takes a custom footer line', () => {
    const html = render({ brand: { footerText: 'Generated by CastCord Helper' } });
    expect(html).toContain('Generated by CastCord Helper');
    expect(html).not.toContain('Generated with discord-transcriber');
  });
});

describe('metadata panel and notices', () => {
  const render = (options: RenderTranscriptOptions): string =>
    renderTranscript(data(), { maxBytes: BIG_BUDGET, ...options })[0]!.content.toString('utf8');

  it('renders no panel unless entries are provided', () => {
    expect(render({})).not.toContain('class="panel"');
  });

  it('renders the entries with their icons and layout', () => {
    const html = render({
      metadata: [
        { label: 'Category', value: 'Technical Support', icon: 'tag' },
        { label: 'Close reason', value: 'Resolved', icon: 'note', wide: true },
      ],
    });

    expect(html).toContain('<h2>Details</h2>');
    expect(html).toContain('Technical Support');
    expect(html).toContain('<div class="meta-cell wide">');
    // The tag glyph is inline SVG, so the image policy never sees it.
    expect(html).toContain('<svg viewBox="0 0 24 24" width="14" height="14"');
  });

  it('names the panel whatever the caller wants', () => {
    const html = render({
      metadata: [{ label: 'القسم', value: 'الدعم الفني' }],
      metadataTitle: 'التفاصيل',
    });
    expect(html).toContain('<h2>التفاصيل</h2>');
    expect(html).toContain('الدعم الفني');
  });

  it('shows custom notices above the conversation', () => {
    const html = render({ notices: ['Exported for the moderation review.'] });
    expect(html).toContain('class="notice"');
    expect(html).toContain('Exported for the moderation review.');
  });

  it('keeps the line breaks of a multiline value', () => {
    const html = render({
      metadata: [
        { label: 'Close reason', value: 'First paragraph.\nSecond paragraph.', wide: true },
      ],
    });

    expect(html).toContain('First paragraph.<br>Second paragraph.');
  });
});

describe('Components V2 messages', () => {
  const renderOne = (overrides: Partial<TranscriptMessage>): string =>
    renderTranscript(data({ messages: [message({ content: '', ...overrides })] }), {
      maxBytes: BIG_BUDGET,
    })[0]!.content.toString('utf8');

  it('renders the words the layout tree carries instead of a blank row', () => {
    const html = renderOne({
      componentsV2: true,
      components: [
        {
          kind: 'container',
          color: '#9146ff',
          components: [
            { kind: 'textDisplay', content: '## Welcome to **support**' },
            { kind: 'separator', divider: true, spacing: 'large' },
            {
              kind: 'actionRow',
              components: [
                {
                  kind: 'button',
                  label: 'Close',
                  style: 'danger',
                  disabled: false,
                  url: null,
                  emoji: null,
                },
              ],
            },
          ],
        },
      ],
    });

    expect(html).toContain('class="dcontainer"');
    expect(html).toContain('border-inline-start-color:#9146ff');
    expect(html).toContain('md-heading h2');
    expect(html).toContain('<strong>support</strong>');
    expect(html).toContain('<hr class="dseparator dseparator-large divided">');
    expect(html).toContain('dbutton dbutton-danger');
  });

  it('renders a section with its thumbnail accessory', () => {
    const html = renderOne({
      componentsV2: true,
      components: [
        {
          kind: 'section',
          content: [{ kind: 'textDisplay', content: 'Pick a plan below.' }],
          accessory: {
            kind: 'thumbnail',
            media: {
              url: 'https://cdn.discordapp.com/attachments/1/2/logo.png',
              proxyUrl: null,
              description: 'the logo',
            },
          },
        },
      ],
    });

    expect(html).toContain('class="dsection"');
    expect(html).toContain('Pick a plan below.');
    expect(html).toContain('class="dthumb"');
    expect(html).toContain('alt="the logo"');
  });

  it('tiles a media gallery through the proxy the image policy allows', () => {
    const html = renderOne({
      componentsV2: true,
      components: [
        {
          kind: 'mediaGallery',
          items: [
            {
              url: 'https://evil.example.com/a.png',
              proxyUrl: 'https://media.discordapp.net/external/abc/a.png',
              description: null,
            },
          ],
        },
      ],
    });

    expect(html).toContain('class="dgallery"');
    expect(html).toContain('https://media.discordapp.net/external/abc/a.png');
    expect(html).not.toContain('evil.example.com');
  });

  it('shows a file component as the card Discord shows', () => {
    const html = renderOne({
      componentsV2: true,
      components: [
        {
          kind: 'file',
          name: 'logs.txt',
          url: 'https://cdn.discordapp.com/attachments/1/2/logs.txt',
          size: 2048,
        },
      ],
    });

    expect(html).toContain('class="attachment-file"');
    expect(html).toContain('logs.txt');
    expect(html).toContain('2.0 KB');
  });

  it('does not list uploads twice on a Components V2 message', () => {
    const html = renderOne({
      componentsV2: true,
      attachments: [
        {
          id: '1',
          name: 'photo.png',
          url: 'https://cdn.discordapp.com/attachments/1/2/photo.png',
          size: 1000,
          contentType: 'image/png',
          isImage: true,
        },
      ],
      components: [
        {
          kind: 'mediaGallery',
          items: [
            {
              url: 'https://cdn.discordapp.com/attachments/1/2/photo.png',
              proxyUrl: null,
              description: null,
            },
          ],
        },
      ],
    });

    // The gallery draws the upload; the attachment list must not repeat it.
    expect(html).toContain('class="dgallery"');
    expect(html).not.toContain('class="attachments"');
  });

  it('marks an edited Components V2 message', () => {
    const html = renderOne({
      componentsV2: true,
      editedAt: BASE_DATE,
      components: [{ kind: 'textDisplay', content: 'Updated notice.' }],
    });

    expect(html).toContain('(edited)');
  });

  it('validates a hostile button style instead of interpolating it', () => {
    const html = renderOne({
      actionRows: [
        {
          components: [
            {
              kind: 'button',
              label: 'x',
              style: '" onmouseover="alert(1)' as unknown as TranscriptButtonStyle,
              disabled: false,
              url: null,
              emoji: null,
            },
          ],
        },
      ],
    });

    expect(html).toContain('dbutton dbutton-secondary');
    expect(html).not.toContain('onmouseover');
  });
});

describe('day boundaries and split parts', () => {
  it('never groups across midnight', () => {
    const html = renderTranscript(
      data({
        messages: [
          message({ id: '900000000000000031', createdAt: new Date('2026-03-04T23:58:00.000Z') }),
          message({
            id: '900000000000000032',
            createdAt: new Date('2026-03-05T00:02:00.000Z'),
            groupedWithPrevious: true,
          }),
        ],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    // Four minutes apart, same author - but a date divider always forces a
    // full header, as in the client.
    expect([...html.matchAll(/divider-day/g)].length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain('message grouped');
  });

  it('opens every part with its date and a full message header', () => {
    const many = Array.from({ length: 120 }, (_value, index) =>
      message({
        id: `9000000000000${String(10000 + index)}`,
        content: `Message number ${String(index)} `.repeat(120),
        groupedWithPrevious: index > 0,
      }),
    );

    const parts = renderTranscript(data({ messages: many }), { maxBytes: 120 * 1024 });
    expect(parts.length).toBeGreaterThan(1);

    for (const part of parts) {
      const chat = part.content.toString('utf8');
      const conversation = chat.slice(chat.indexOf('<div class="chat">'));
      const firstDivider = conversation.indexOf('divider-day');
      const firstMessage = conversation.indexOf('<div class="message');

      // The date comes first, then a message that stands on its own.
      expect(firstDivider).toBeGreaterThan(-1);
      expect(firstDivider).toBeLessThan(firstMessage);
      expect(conversation.slice(firstMessage)).toMatch(/^<div class="message start/);
    }
  });

  it('keeps the quoted line but offers no jump across files', () => {
    const first = message({
      id: '900000000000000041',
      content: 'word '.repeat(14000),
    });
    const second = message({
      id: '900000000000000042',
      content: 'word '.repeat(14000),
      reference: reply({ messageId: '900000000000000041', excerpt: 'the first message' }),
    });

    const parts = renderTranscript(data({ messages: [first, second] }), {
      maxBytes: 100 * 1024,
    });
    expect(parts).toHaveLength(2);

    const partTwo = parts[1]!.content.toString('utf8');
    // The reply row survives with its quoted text...
    expect(partTwo).toContain('the first message');
    // ...but carries no link to an anchor this file does not hold.
    expect(partTwo).not.toContain('href="#m900000000000000041"');
    expect(partTwo).not.toContain('class="reply-jump"');
  });
});

describe('command invocations, threads and boosts', () => {
  const renderOne = (overrides: Partial<TranscriptMessage>): string =>
    renderTranscript(data({ messages: [message(overrides)] }), {
      maxBytes: BIG_BUDGET,
    })[0]!.content.toString('utf8');

  it('shows who used which command above the reply', () => {
    const html = renderOne({
      interaction: {
        commandName: 'stats',
        userName: 'Eissa',
        userAvatarUrl: 'https://cdn.discordapp.com/avatars/2/e.png',
        userColor: '#f0a52a',
      },
    });

    expect(html).toContain('message start has-reply');
    expect(html).toContain('style="color:#f0a52a">Eissa</span>');
    // The apps glyph sits inside the mention-coloured chip, before the name.
    expect(html).toContain('class="mention command-mention"');
    expect(html).toContain('</svg>stats</span>');
  });

  it('escapes a hostile command invocation', () => {
    const payload = '<script>alert(1)</script>';
    const html = renderOne({
      interaction: {
        commandName: payload,
        userName: payload,
        userAvatarUrl: 'javascript:x',
        userColor: 'red;}x',
      },
    });

    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('red;}x');
  });

  it('marks the thread hanging off a message', () => {
    const html = renderOne({
      thread: { name: 'side-discussion', messageCount: 12, lastMessage: null },
    });

    expect(html).toContain('class="thread-chip"');
    expect(html).toContain('side-discussion');
    expect(html).toContain('12 Messages ›');
  });

  it('previews the thread latest message like the client', () => {
    const html = renderOne({
      thread: {
        name: 'Test',
        messageCount: 5,
        lastMessage: {
          authorName: 'z',
          authorAvatarUrl: 'https://cdn.discordapp.com/avatars/9/z.png',
          authorColor: '#11806a',
          content: 'this is a thread message test',
          createdAt: BASE_DATE,
        },
      },
    });

    expect(html).toContain('class="thread-bottom"');
    expect(html).toContain('class="thread-avatar"');
    expect(html).toContain('style="color:#11806a"');
    expect(html).toContain('this is a thread message test');
  });

  it('escapes a hostile thread preview', () => {
    const html = renderOne({
      thread: {
        name: '<script>x</script>',
        messageCount: 1,
        lastMessage: {
          authorName: '<img onerror=1>',
          authorAvatarUrl: 'javascript:alert(1)',
          authorColor: 'red;}</style>',
          content: '<script>alert(1)</script>',
          createdAt: null,
        },
      },
    });

    expect(html).not.toContain('<script>x');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img onerror');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('red;}');
  });

  it('words a boost the way the client does', () => {
    const html = renderOne({ content: '', system: true, systemAction: 'boostedTier2' });

    expect(html).toContain('just boosted the server! The server has achieved Level 2!');
    expect(html).toContain('class="system-icon"');
  });
});

describe('embed anatomy', () => {
  const renderEmbedHtml = (overrides: Partial<TranscriptEmbed>): string =>
    renderTranscript(
      data({
        messages: [
          message({
            embeds: [mediaEmbed({ kind: 'rich', url: null, thumbnailUrl: null, ...overrides })],
          }),
        ],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

  it('renders the author icon and link', () => {
    const html = renderEmbedHtml({
      authorName: 'Release team',
      authorUrl: 'https://example.com/team',
      authorIconUrl: 'https://cdn.discordapp.com/icons/1/team.png',
    });

    expect(html).toContain('class="eauthor-icon"');
    expect(html).toContain('https://cdn.discordapp.com/icons/1/team.png');
    expect(html).toContain('<a href="https://example.com/team"');
  });

  it('renders the footer icon through the proxy the policy allows', () => {
    const html = renderEmbedHtml({
      footerText: 'Powered by example',
      footerIconUrl: 'https://evil.example.com/icon.png',
      footerIconProxyUrl: 'https://images-ext-1.discordapp.net/external/abc/icon.png',
    });

    expect(html).toContain('class="efooter-icon"');
    expect(html).toContain('images-ext-1.discordapp.net');
    expect(html).not.toContain('evil.example.com');
  });

  it('shows a video unfurl poster full width, not as a corner thumbnail', () => {
    const poster = 'https://images-ext-1.discordapp.net/external/abc/poster.jpg';
    const html = renderEmbedHtml({
      kind: 'video',
      title: 'A talk',
      url: 'https://example.com/watch',
      thumbnailProxyUrl: poster,
    });

    expect(html).toContain(`<img class="eimage" src="${poster}"`);
    expect(html).not.toContain('class="ethumb"');
  });
});

describe('audio and video attachments', () => {
  const attachment = (contentType: string, name: string) => ({
    id: '1',
    name,
    url: `https://cdn.discordapp.com/attachments/1/2/${name}`,
    size: 1024 * 1024,
    contentType,
    isImage: false,
  });

  it('plays a video inline and allows it through media-src', () => {
    const html = renderTranscript(
      data({ messages: [message({ attachments: [attachment('video/mp4', 'clip.mp4')] })] }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect(html).toContain('<video class="attachment-video" controls');
    expect(html).toContain('clip.mp4');
    expect(html).toMatch(/media-src[^;]*cdn\.discordapp\.com/);
  });

  it('plays a voice message inline', () => {
    const html = renderTranscript(
      data({ messages: [message({ attachments: [attachment('audio/ogg', 'voice-message.ogg')] })] }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect(html).toContain('<audio class="attachment-audio" controls');
  });

  it('degrades a media attachment on a rejected host to the file card', () => {
    const html = renderTranscript(
      data({
        messages: [
          message({
            attachments: [
              { ...attachment('video/mp4', 'clip.mp4'), url: 'https://evil.example.com/clip.mp4' },
            ],
          }),
        ],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect(html).not.toContain('<video');
    expect(html).toContain('class="attachment-file"');
    // The URL survives only as a plain link the reader can choose to follow -
    // never as a src the document fetches on open.
    expect(html).not.toMatch(/src="https:\/\/evil/);
  });
});

describe('favicon', () => {
  it('links a Discord-CDN favicon', () => {
    const html = renderTranscript(data(), {
      maxBytes: BIG_BUDGET,
      favicon: 'https://cdn.discordapp.com/icons/1/guild.png',
    })[0]!.content.toString('utf8');

    expect(html).toContain(
      '<link rel="icon" href="https://cdn.discordapp.com/icons/1/guild.png">',
    );
  });

  it('drops a favicon off the allowlist', () => {
    const html = renderTranscript(data(), {
      maxBytes: BIG_BUDGET,
      favicon: 'https://evil.example.com/icon.png',
    })[0]!.content.toString('utf8');

    expect(html).not.toContain('<link rel="icon"');
    expect(html).not.toContain('evil.example.com');
  });
});

describe('footer', () => {
  it('states how many messages were exported', () => {
    const html = renderTranscript(data(), { maxBytes: BIG_BUDGET })[0]!.content.toString('utf8');
    expect(html).toContain('Exported 1 message ·');
  });
});

describe('forwarded messages', () => {
  const forward = {
    content: 'Welcome to **Blocks** Discord Support',
    attachments: [],
    embeds: [],
    stickers: [],
    components: [],
    originChannelName: 'welcome',
    originTimestamp: new Date('2026-03-01T05:04:00.000Z'),
  };

  it('renders the forwarded material with its label and origin', () => {
    const html = renderTranscript(
      data({ messages: [message({ content: '', forwarded: forward })] }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect(html).toContain('class="forward"');
    expect(html).toContain('Forwarded');
    expect(html).toContain('<strong>Blocks</strong>');
    expect(html).toContain('#welcome · 2026-03-01 05:04:00 UTC');
    // A forward is not a reply: no dead "unknown message" row.
    expect(html).not.toContain('not included in this transcript');
  });

  it('escapes hostile forwarded content', () => {
    const html = renderTranscript(
      data({
        messages: [
          message({
            content: '',
            forwarded: {
              ...forward,
              content: '<script>alert(1)</script>',
              originChannelName: '"><img onerror=x>',
            },
          }),
        ],
      }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('onerror=');
  });
});

describe('spoilers', () => {
  it('reveals on click, with hover only as the no-script fallback', () => {
    const html = renderTranscript(
      data({ messages: [message({ content: 'the answer is ||secret||' })] }),
      { maxBytes: BIG_BUDGET },
    )[0]!.content.toString('utf8');

    expect(html).toContain('<span class="spoiler">secret</span>');
    // Pressable, as in the client: pointer cursor, revealed by the script.
    expect(html).toContain('cursor: pointer');
    expect(html).toContain('.spoiler.revealed');
    expect(html).toContain("classList.add('revealed')");
    // The hover reveal survives only for readers whose scripts are blocked.
    expect(html).toContain('body:not(.js) .spoiler:hover');
    expect(html.split('.spoiler:hover').length - 1).toBe(1);
  });
});
