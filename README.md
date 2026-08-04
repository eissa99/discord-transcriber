# discord-transcriber

Turn any Discord channel into a beautiful HTML transcript that looks exactly
like Discord — with one function call.

**[اقرأ هذا الملف بالعربية →](https://github.com/eissa99/discord-transcriber/blob/main/README.ar.md)**

> [!NOTE]
> `discord-transcriber` is also published as
> [`discord-html-transcript`](https://www.npmjs.com/package/discord-html-transcript).
> Same package, same author ([`ieissa` on npm](https://www.npmjs.com/~ieissa),
> [`eissa99` on GitHub](https://github.com/eissa99)), same code, same versions —
> kept in lockstep by an automated sync. Install whichever name you prefer;
> neither is a fork of the other.

```js
import { createTranscript } from 'discord-transcriber';

const transcript = await createTranscript(channel);

// One file per message: Discord's upload limit applies to the whole request.
for (const file of transcript.files) {
  await logChannel.send({ files: [file] });
}
```

All examples in this document are plain JavaScript. Using CommonJS? Same one
line:

```js
const { createTranscript } = require('discord-transcriber');
```

TypeScript users get complete type definitions automatically.

## What it renders

Everything, the way Discord shows it:

- Messages with complete Discord markdown — headers, subtext, nested lists,
  quotes, code, spoilers (click to reveal) — plus custom emoji and mentions
  resolved to real names
- Replies with working jump links, and message grouping exactly like the
  client
- Forwarded messages, with a pressable origin row that jumps to the original
  in-file or opens it on Discord
- Attachments — images inline, audio and video with players, other files as
  download cards
- Rich embeds, buttons and select menus
- Components V2 layouts: containers, sections, text displays, media
  galleries, files, separators
- Slash-command rows ("Eissa used /close"), reactions, stickers
- Thread cards with the thread's name, message count, and a preview of its
  latest message
- System events (pins, joins, boosts), edited and pinned markers, day
  dividers

All in Discord's own colours, spacing and typography.

## Why this package

- **Looks exactly like Discord.** The styling is sampled from the Discord
  client itself, down to the smallest details.
- **Safe by design.** Every piece of message content is escaped before it
  reaches the HTML, and each file carries a strict Content-Security-Policy:
  no script can run except the file's own, and images and media load only
  from Discord's CDN. Hostile message content cannot execute or call out.
- **One self-contained file.** No hosting, no external service, no CDN
  scripts. The file opens offline and prints cleanly.
- **Splits big transcripts automatically.** A transcript that would exceed
  the server's upload limit becomes several complete files, each sized to the
  server's boost tier.
- **Light and typed.** discord.js is the only dependency (peer). Ships ESM
  and CommonJS with full TypeScript definitions.

## Install

```sh
npm install discord-transcriber
```

Requires Node.js 20+ and discord.js v14.19+ (peer dependency) — the first
release with Components V2, which transcripts render. On an older discord.js,
`npm install discord.js@latest` brings you up.

> **⚠️ Message Content intent — required.** Without the privileged **Message
> Content** intent, Discord hides `content`, `embeds`, `attachments` and
> `components` from message history, so every message not written by your bot
> arrives empty — and the transcript shows blank bubbles with no error
> anywhere. Enable the intent on the **Bot** page of the
> [Developer Portal](https://discord.com/developers/applications) *and*
> declare it in your client:
>
> ```js
> new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent] });
> ```

## Usage

### Basic usage

```js
import { createTranscript } from 'discord-transcriber';

const transcript = await createTranscript(channel, {
  limit: 2000,                  // newest 2000 messages; default: all
  filename: 'ticket-1042',      // default: transcript-<channel name>
});

transcript.files;        // AttachmentBuilder[] — ready for channel.send({ files })
transcript.parts;        // { filename, content: Buffer, partNumber, ... }[]
transcript.messageCount; // how many messages were collected
transcript.truncated;    // true when the channel held more than `limit`
transcript.byteSize;     // total size of all parts
```

Works with any text channel in a server: text and announcement channels,
threads, and voice/stage chats.

Send one file per message — Discord's upload limit applies to the whole
request:

```js
const [first, ...rest] = transcript.files;
await logChannel.send({ content: 'Transcript', files: [first] });
for (const file of rest) await logChannel.send({ files: [file] });
```

Or save the files to disk:

```js
import { writeFile } from 'node:fs/promises';
for (const part of transcript.parts) {
  await writeFile(part.filename, part.content);
}
```

### Your branding

The conversation always keeps Discord's look. The frame around it — the
header, the accent colour, the footer — is yours:

```js
await createTranscript(channel, {
  brand: {
    name: 'CastCord Support',          // bold line above the channel name
    accentColor: '#9146ff',            // frame colour; default Discord blurple
    footerText: 'Generated by CastCord Helper',
    logoSvg: '<svg class="brand-mark" ...>...</svg>', // your logo, header + footer
  },
});
```

> **Security note:** `logoSvg` is embedded as-is so the file stays
> self-contained. Pass only markup you wrote yourself — never user input.

### The details panel

Record facts that are not part of the conversation itself — who opened a
ticket, why it was closed, what a form answered:

```js
await createTranscript(channel, {
  metadata: [
    { label: 'Category',  value: 'Technical Support', icon: 'tag' },
    { label: 'Opened by', value: '7sO (7so)',         icon: 'person' },
    { label: 'Closed by', value: 'Eissa (eissa)',     icon: 'shield' },
    { label: 'Close reason', value: 'Resolved.', icon: 'note', wide: true },
  ],
  metadataTitle: 'Details', // panel heading — write it in any language
  notices: ['Exported for the moderation review.'],
});
```

Icons: `tag` · `text` · `person` · `shield` · `people` · `clock` · `lock` ·
`note` · `chat`. Add `wide: true` to give a long value its own full row.

### All options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `limit` | `number` | all messages | Keeps the newest messages; a notice in the file reports the cut. |
| `filter` | `(m) => boolean` | keep all | e.g. `(m) => !m.author.bot`. Applied before grouping and reply previews, so the conversation stays coherent. |
| `maxFileBytes` | `number \| 'auto'` | `'auto'` | Max size per file. `'auto'` reads the server's boost tier. |
| `filename` | `string` | `transcript-<channel>` | Base file name; split parts get `-part2of3` suffixes. |
| `title` | `string` | `#channel · guild` | The browser-tab title. |
| `favicon` | `'guild' \| 'none' \| url` | `'guild'` | Browser-tab icon. A custom URL must be on Discord's CDN. |
| `brand` | object | neutral | Header name, logo, accent colour, footer — see above. |
| `metadata` | array | none | The details panel — see above. |
| `metadataTitle` | `string` | `Details` | The panel's heading. |
| `notices` | `string[]` | none | Extra notice banners above the conversation. |

### Advanced: collect now, render later

The package is two independent layers. `collectMessages` turns a channel
into plain data; `renderTranscript` turns that data into HTML files with no
Discord connection at all — so you can store the data anywhere and render it
whenever you like:

```js
import {
  collectMessages,     // channel -> plain data (messages, mentions, truncated)
  collectFromMessages, // messages you already hold -> the same plain data
  renderTranscript,    // plain data -> HTML files (no Discord needed)
} from 'discord-transcriber';

const collected = await collectMessages(channel, { limit: 500 });

// ...store `collected` anywhere, then later:
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

The collector also resolves mentions that Discord leaves out of the message
payload (pings suppressed through `allowed_mentions` — common in bot
announcements), so `<@id>` renders as a name, not a number.

## Notes and limitations

- **The Message Content intent is required** (see Install above). The
  package cannot detect its absence — Discord simply returns empty messages.
- **Timestamps are UTC**, worded as Discord worded them when the transcript
  was made (`4:30 AM`, `Yesterday at…`); the exact instant is on every
  tooltip.
- **Media loads from Discord's CDN.** Attachment links expire after a while,
  so images and players in old transcripts may stop loading. The text of the
  conversation is unaffected — it lives inside the file.
- **DM channels are not supported** — the collector reads server context
  (nicknames, role colours, boost tier).
- The file contains exactly one script, which only makes reply-jumps scroll
  smoothly. With JavaScript disabled, everything still works.

## Responsible use

A transcript contains your members' messages. Once your bot stores or shares
one, that data is your responsibility under Discord's
[Developer Terms of Service](https://discord.com/developers/docs/policies-and-agreements/developer-terms-of-service)
and [Developer Policy](https://discord.com/developers/docs/policies-and-agreements/developer-policy):

- Mention transcripts in your bot's privacy policy, so members know their
  messages may be archived.
- Share a transcript only with people who could already read the channel —
  a ticket transcript belongs to the staff and the ticket's participants.
- Delete stored transcripts when a member or server asks you to.

## Demo

To see a full sample transcript, clone
[the repository](https://github.com/eissa99/discord-transcriber) and run:

```sh
npm install
npm run build
npm run demo    # writes examples/demo.html — open it in your browser
```

## License

[MIT](https://github.com/eissa99/discord-transcriber/blob/main/LICENSE)

## ⭐ Found it useful?

A star on [GitHub](https://github.com/eissa99/discord-transcriber) helps a lot — and if you'd like to support my work, I'm on [ko-fi](https://ko-fi.com/ieissa).

Made with ❤️ by [Eissa](https://github.com/eissa99)

---

*discord-transcriber is an independent open-source project, not affiliated with or endorsed by Discord Inc.*
