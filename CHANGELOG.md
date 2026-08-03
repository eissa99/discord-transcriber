# Changelog

## 1.0.1

- docs: real names in all examples

## 1.0.0

Initial release.

- `createTranscript(channel, options)` — collect a server text channel and
  render it to one or more self-contained HTML files, returned both as
  `AttachmentBuilder`s and as raw parts.
- Pixel-accurate reproduction of the Discord client: message grouping,
  replies with jump links, resolved mentions, full message markdown, custom
  emoji, attachments, embeds with Discord's field grid (author icon and
  link, footer icon, video posters), buttons and selects, reactions,
  stickers, edited/pinned markers, day dividers.
- Full Components V2 support: containers, sections, text displays, media
  galleries, file cards, separators — including mention resolution and
  reply previews sourced from TextDisplay content.
- Slash-command invocation rows ("Eissa used /close"), thread markers, and
  boost/pin/join system messages.
- Inline audio and video players, admitted by a `media-src` allowlist of
  Discord CDN hosts only.
- Security model: a tokenising markdown renderer that escapes every text
  leaf on emit, a single-hash Content-Security-Policy, images and media
  restricted to Discord CDN hosts, URL and colour validation everywhere.
- Automatic splitting at message boundaries when a file would exceed the
  server's upload budget (`maxFileBytes: 'auto'` reads the boost tier);
  every part opens with its date and a full message header.
- Chrome branding (`brand`), details panel (`metadata`), custom notices,
  titles, guild-icon favicon, and a collection-time `filter` — all optional.
- Lower-level layers exported: `collectMessages`, `collectFromMessages`,
  `renderTranscript`, `uploadBudgetBytes`, `renderMarkdown`.
- Dual ESM/CJS build with TypeScript declarations for both.
