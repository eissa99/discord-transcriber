# Changelog

## 0.1.1

- The package moved into its own repository:
  [github.com/eissa99/discord-transcriber](https://github.com/eissa99/discord-transcriber).
  `repository`, `bugs` and `homepage` now point there.
- The "read in Arabic" link works from the npm page (absolute GitHub URL -
  npm renders only README.md and cannot serve sibling files).

## 0.1.0

Initial release.

- `createTranscript(channel, options)` — collect a guild text-based channel
  and render it to one or more self-contained HTML files, returned both as
  `AttachmentBuilder`s and as raw parts.
- Pixel-accurate reproduction of the Discord client: message grouping,
  replies with jump links, resolved mentions, full message markdown, custom
  emoji, attachments, embeds with Discord's field grid, buttons and selects,
  reactions, stickers, system events, edited/pinned markers, day dividers.
- Full Components V2 support: containers, sections, text displays, media
  galleries, file cards, separators - including mention resolution and reply
  excerpts sourced from TextDisplay content, and no double-listing of a V2
  message's uploads.
- Split-aware rendering: every part opens with its date and a full message
  header, grouping never crosses midnight or a file boundary, and a reply to
  a message in a different part keeps its quoted line without a dead link.
- Security model: tokenising markdown renderer that escapes every text leaf
  on emit, single-hash Content-Security-Policy, images restricted to Discord
  CDN hosts, URL and colour validation everywhere.
- Automatic splitting at message boundaries when a file would exceed the
  guild's upload budget (`maxFileBytes: 'auto'` derives it from boost tier).
- Chrome branding (`brand`), details panel (`metadata`), custom notices and
  titles — all optional, all escaped.
- Slash-command invocation rows ("Alice used /close"), thread markers on the
  parent message, and boost system messages.
- Inline `<video>`/`<audio>` players for media attachments, admitted by a
  `media-src` allowlist of the same four Discord CDN hosts.
- Full embed anatomy: author icon and link, footer icon, and video unfurls
  showing their poster full width.
- `filter` option (collection-time message predicate), `favicon` option
  (guild icon by default, Discord-CDN URLs only), and an "Exported N
  messages" line in the footer.
- Lower-level layers exported: `collectMessages`, `collectFromMessages`,
  `renderTranscript`, `uploadBudgetBytes`, `renderMarkdown`.
- Dual ESM/CJS build with TypeScript declarations for both.
