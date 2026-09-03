import { AttachmentBuilder, type GuildTextBasedChannel, type Message } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { createTranscript } from '../src/create-transcript.js';

/**
 * The high-level path against a faked channel: only the surface createTranscript
 * and the collector actually read is reproduced. Everything discord.js exposes
 * as a Collection is Map-shaped, and a plain Map satisfies each of those uses.
 */

function fakeMessage(id: string, content: string): Message<true> {
  const createdAt = new Date('2026-07-31T00:26:18.000Z');

  return {
    id,
    content,
    author: {
      id: '300000000000000001',
      username: '7so',
      displayName: '7sO',
      bot: false,
      displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/1/a.png',
    },
    member: null,
    createdAt,
    createdTimestamp: createdAt.getTime(),
    editedAt: null,
    attachments: new Map(),
    embeds: [],
    stickers: new Map(),
    components: [],
    reactions: { cache: new Map() },
    reference: null,
    system: false,
    pinned: false,
    mentions: {
      users: new Map(),
      members: new Map(),
      roles: new Map(),
      channels: new Map(),
    },
  } as unknown as Message<true>;
}

function fakeChannel(messages: readonly Message<true>[]): GuildTextBasedChannel {
  // Newest-first, the order Discord returns.
  const page = new Map([...messages].reverse().map((message) => [message.id, message]));

  return {
    id: '400000000000000001',
    name: 'general',
    messages: { fetch: () => Promise.resolve(page) },
    guild: {
      name: 'Awesome Guild',
      premiumTier: 0,
      iconURL: () => 'https://cdn.discordapp.com/icons/1/guild.png',
      members: {
        cache: new Map(),
        fetch: () => Promise.reject(new Error('Unknown Member')),
      },
    },
    client: {
      users: {
        cache: new Map(),
        fetch: () => Promise.reject(new Error('Unknown User')),
      },
    },
  } as unknown as GuildTextBasedChannel;
}

describe('createTranscript', () => {
  it('collects the channel and returns ready-to-send attachments', async () => {
    const transcript = await createTranscript(
      fakeChannel([fakeMessage('1', 'Hello!'), fakeMessage('2', 'Anyone here?')]),
    );

    expect(transcript.messageCount).toBe(2);
    expect(transcript.truncated).toBe(false);
    expect(transcript.parts).toHaveLength(1);
    expect(transcript.files).toHaveLength(1);
    expect(transcript.files[0]).toBeInstanceOf(AttachmentBuilder);
    expect(transcript.parts[0]!.filename).toBe('transcript-general.html');
    expect(transcript.byteSize).toBe(transcript.parts[0]!.content.byteLength);

    const html = transcript.parts[0]!.content.toString('utf8');
    expect(html).toContain('Hello!');
    expect(html).toContain('Anyone here?');
    expect(html).toContain('Awesome Guild');
  });

  it('derives the file name from the channel and sanitises it', async () => {
    const channel = fakeChannel([fakeMessage('1', 'hi')]);
    (channel as { name: string }).name = 'weird channel/../name';

    const transcript = await createTranscript(channel);
    expect(transcript.parts[0]!.filename).toBe('transcript-weird_channel_.._name.html');
  });

  it('honours an explicit filename and title', async () => {
    const transcript = await createTranscript(fakeChannel([fakeMessage('1', 'hi')]), {
      filename: 'ticket-1042',
      title: 'Ticket #1042',
    });

    expect(transcript.parts[0]!.filename).toBe('ticket-1042.html');
    expect(transcript.parts[0]!.content.toString('utf8')).toContain('<title>Ticket #1042</title>');
  });

  it('uses the guild icon as the favicon by default, and drops it on demand', async () => {
    const withIcon = await createTranscript(fakeChannel([fakeMessage('1', 'hi')]));
    expect(withIcon.parts[0]!.content.toString('utf8')).toContain(
      '<link rel="icon" href="https://cdn.discordapp.com/icons/1/guild.png">',
    );

    const without = await createTranscript(fakeChannel([fakeMessage('1', 'hi')]), {
      favicon: 'none',
    });
    expect(without.parts[0]!.content.toString('utf8')).not.toContain('<link rel="icon"');
  });

  it('keeps only the messages the filter accepts', async () => {
    const transcript = await createTranscript(
      fakeChannel([
        fakeMessage('1', 'keep me'),
        fakeMessage('2', 'drop me'),
        fakeMessage('3', 'keep too'),
      ]),
      { filter: (message) => !message.content.startsWith('drop') },
    );

    expect(transcript.messageCount).toBe(2);
    const html = transcript.parts[0]!.content.toString('utf8');
    expect(html).toContain('keep me');
    expect(html).toContain('keep too');
    expect(html).not.toContain('drop me');
  });

  it('respects the message limit and reports truncation', async () => {
    // A full page at the limit means one more page may exist.
    const many = Array.from({ length: 100 }, (_value, index) =>
      fakeMessage(String(index + 1), `Message ${String(index + 1)}`),
    );

    const transcript = await createTranscript(fakeChannel(many), {
      limit: 100,
    });

    expect(transcript.messageCount).toBe(100);
    expect(transcript.truncated).toBe(true);
    expect(transcript.parts[0]!.content.toString('utf8')).toContain(
      'more messages than the transcript limit',
    );
  });
});
