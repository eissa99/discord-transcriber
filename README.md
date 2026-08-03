# discord-transcriber

Pixel-accurate, self-contained HTML transcripts for Discord channels.

**[اقرأ هذا الملف بالعربية →](https://github.com/eissa99/discord-transcriber/blob/main/README.ar.md)**

One call turns a channel into standalone HTML files that reproduce the
conversation **as it appeared in Discord** — not an approximation of it:
message grouping, replies with their jump links, resolved mentions, full
message markdown, custom emoji, attachments, rich embeds with Discord's
twelve-column field grid, buttons and select menus, **Components V2 layouts**
(containers, sections, text displays, media galleries, files, separators),
slash-command invocation rows ("Alice used /close"), inline audio and video
players, thread markers, reactions, stickers, system events (pins, joins,
boosts), edited/pinned markers and day dividers, all in Discord's own
palette, spacing and typography.

```js
import { createTranscript } from 'discord-transcriber';

const transcript = await createTranscript(channel);
// One file per message: Discord's upload limit applies to the whole request,
// and each part is sized against that limit.
for (const file of transcript.files) {
  await logChannel.send({ files: [file] });
}
```

Plain JavaScript everywhere — every example in this document is JS. Using
CommonJS? Same one line:

```js
const { createTranscript } = require('discord-transcriber');
```

TypeScript users get complete type definitions out of the box, for both
`import` and `require`.

## Why this one

- **Faithful rendering.** The conversation area is styled from values sampled
  from the Discord client, down to the reply spine's elbow radius, the
  seven-minute message-grouping window and the APP badge. A transcript reads
  like the channel it came from.
- **Secure by construction, not by care.** Message content is
  attacker-controlled, so the renderer never pattern-matches escaped text: raw
  text is tokenised first and every text leaf is escaped as it is emitted. On
  top of that the document declares a Content-Security-Policy that forbids all
  scripts except its own (admitted by SHA-256 hash, not `unsafe-inline`),
  restricts images to Discord's CDN hosts, and blocks forms, frames and fonts.
  Even a rendering mistake cannot execute content or beacon out.
- **Self-contained files, no service.** Styling is inline, icons are inline
  SVG, and nothing is fetched at open time except images from Discord's CDN.
  There is no hosting, no viewer, no link that can die. The file reads
  offline and prints cleanly (there is a print stylesheet).
- **Splits instead of failing.** A transcript that would exceed the guild's
  upload limit is split into several complete standalone HTML files at message
  boundaries — by default sized automatically from the guild's boost tier.
- **Typed and testable layers.** `collectMessages` turns a channel into plain
  data; `renderTranscript` turns plain data into files. Store the data, render
  later, no Discord connection needed. Ships ESM + CJS with full TypeScript
  declarations.

## Install

```sh
npm install discord-transcriber
```

Requires Node.js 20+ and discord.js v14.19+ (peer dependency).

> **⚠️ Message Content intent — required.** Discord redacts `content`,
> `embeds`, `attachments` and `components` from message history for any app
> without the privileged **Message Content** intent. Without it, every message
> not authored by your bot arrives empty and the transcript renders blank
> bubbles — with no error anywhere. Enable the intent on the **Bot** page of
> the [Developer Portal](https://discord.com/developers/applications) *and*
> declare it in your client:
>
> ```js
> new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent] });
> ```

## Usage

### The one-call path

```js
import { createTranscript } from 'discord-transcriber';

const transcript = await createTranscript(channel, {
  limit: 2000,                  // newest 2000 messages; default: all
  filename: 'ticket-1042',      // default: transcript-<channel name>
});

transcript.files;        // AttachmentBuilder[] — ready for channel.send({ files })
transcript.parts;        // { filename, content: Buffer, partNumber, ... }[]
transcript.messageCount; // messages collected
transcript.truncated;    // true when the channel held more than `limit`
transcript.byteSize;     // total size of all parts
```

Works with any guild text-based channel: text channels, announcement
channels, threads, and voice/stage text chats.

Send one file per message — Discord's upload limit applies to the whole
request:

```js
const [first, ...rest] = transcript.files;
await logChannel.send({ content: 'Transcript', files: [first] });
for (const file of rest) await logChannel.send({ files: [file] });
```

Or write the files to disk:

```js
import { writeFile } from 'node:fs/promises';
for (const part of transcript.parts) {
  await writeFile(part.filename, part.content);
}
```

### Branding the chrome

The conversation always keeps Discord's look. The document chrome around it —
header, accent colour, footer — is yours:

```js
await createTranscript(channel, {
  brand: {
    name: 'CastCord Support',          // uppercase line above the channel name
    accentColor: '#9146ff',            // chrome accent; default Discord blurple
    footerText: 'Generated by CastCord Helper',
    logoSvg: '<svg class="brand-mark" ...>...</svg>', // inline SVG, header + footer
  },
});
```

> **Security note:** `logoSvg` is embedded verbatim so the file stays
> self-contained. Pass only markup you wrote yourself — never user input.

### The details panel

Record the facts that live nowhere else in the document — who opened a
ticket, why it closed, what a form answered:

```js
await createTranscript(channel, {
  metadata: [
    { label: 'Category',  value: 'Technical Support', icon: 'tag' },
    { label: 'Opened by', value: 'Alex (alex)',       icon: 'person' },
    { label: 'Closed by', value: 'Sam (sam)',         icon: 'shield' },
    { label: 'Close reason', value: 'Resolved.', icon: 'note', wide: true },
  ],
  metadataTitle: 'Details', // panel heading — localise it if you like
  notices: ['Exported for the moderation review.'],
});
```

Icons: `tag` · `text` · `person` · `shield` · `people` · `clock` · `lock` ·
`note` · `chat`. `wide: true` gives a long value the full row.

### All options

| Option | Type | Default | |
| --- | --- | --- | --- |
| `limit` | `number` | all messages | Newest messages kept; a notice reports truncation. |
| `filter` | `(m: Message) => boolean` | keep all | e.g. `(m) => !m.author.bot`. Applied before grouping and reply summaries, so the conversation stays coherent. |
| `maxFileBytes` | `number \| 'auto'` | `'auto'` | Max size per file. `'auto'` derives it from the guild's boost tier with headroom for the rest of the request. |
| `filename` | `string` | `transcript-<channel>` | Base name, sanitised; parts get `-part2of3` suffixes. |
| `title` | `string` | `#channel · guild` | The document `<title>`. |
| `favicon` | `'guild' \| 'none' \| url` | `'guild'` | Browser-tab icon. A custom URL must be on Discord's CDN or it is dropped. |
| `brand` | `TranscriptBrand` | neutral | Header name, logo, accent, footer. |
| `metadata` | `TranscriptMetadataEntry[]` | none | Details panel above the conversation. |
| `metadataTitle` | `string` | `Details` | Panel heading. |
| `notices` | `string[]` | none | Extra notice banners. |

### The layers underneath

```js
import {
  collectMessages,     // channel -> plain data (messages, mentions, truncated)
  collectFromMessages, // messages you already hold -> the same plain data
  renderTranscript,    // plain data -> TranscriptPart[] (no Discord needed)
  uploadBudgetBytes,   // guild -> what maxFileBytes: 'auto' resolves to
} from 'discord-transcriber';

const collected = await collectMessages(channel, { limit: 500 });
// ...store `collected` wherever you like, render whenever you like:
const parts = renderTranscript(
  {
    guildName: channel.guild.name,
    channelName: channel.name,
    messages: collected.messages,
    mentions: collected.mentions,
    truncated: collected.truncated,
    generatedAt: new Date(),
  },
  { maxBytes: 8 * 1024 * 1024 },
);
```

The collector also resolves mentions Discord leaves out of the payload (pings
suppressed through `allowed_mentions` — which bot announcements routinely do),
so `<@id>` renders as a name, not a number, capped at 50 extra lookups.

## Notes and limitations

- **The Message Content intent is required** (see Install above). The package
  cannot detect its absence — Discord simply returns empty messages.
- **Timestamps are UTC** and worded as Discord worded them at generation time
  (`4:30 AM`, `Yesterday at…`); the full instant is on every tooltip. A record
  should not reword itself as it ages.
- **Media is hot-linked from Discord's CDN.** Attachment URLs carry expiring
  signatures, so images and players in old transcripts may stop loading once
  Discord rotates them. The text of the conversation is unaffected — it is in
  the file. (Inlining media as data URIs is deliberately not done; it would
  balloon files past upload limits and weaken the CSP.)
- **DM channels are not supported** — the collector reads guild context
  (nicknames, role colours, boost tier).
- The one script in the document only makes reply-jumps scroll smoothly;
  with scripts blocked entirely, the jumps still work as plain anchors.

## Demo

```sh
npm run build && npm run demo   # writes examples/demo.html — open it in a browser
```

## License

[MIT](./LICENSE)
