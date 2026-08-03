import { ButtonStyle, ComponentType } from 'discord.js';
import type { Message, TextChannel } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { collectFromMessages, collectMessages } from '../src/collector.js';
import type { TranscriptContainer } from '../src/types.js';

/**
 * The collector talks to discord.js objects, so these fakes reproduce only the
 * surface it reads. Everything it iterates is Map-shaped in discord.js, and a
 * plain Map satisfies each of those uses.
 */

const CHANNEL_ID = '400000000000000001';
const AUTHOR_ID = '300000000000000001';
/** Added to a ticket by staff, so mentioned but never a message author. */
const SILENT_ID = '222251985200611328';

interface MessageOptions {
  readonly id?: string;
  readonly content?: string;
  readonly authorId?: string;
  readonly authorName?: string;
  /** IDs Discord listed in the payload's `mentions`, i.e. pings it delivered. */
  readonly mentionedUsers?: readonly { id: string; name: string }[];
  /** Raw discord.js-shaped component objects. */
  readonly components?: readonly unknown[];
  /** Marks the message as sent with the IsComponentsV2 flag. */
  readonly componentsV2?: boolean;
}

function fakeMessage(options: MessageOptions = {}): Message<true> {
  const authorId = options.authorId ?? AUTHOR_ID;
  const createdAt = new Date('2026-07-31T00:26:18.000Z');

  const mentionedUsers = new Map(
    (options.mentionedUsers ?? []).map((user) => [
      user.id,
      { id: user.id, displayName: user.name },
    ]),
  );

  return {
    id: options.id ?? '900000000000000001',
    content: options.content ?? '',
    author: {
      id: authorId,
      username: options.authorName ?? '7so',
      displayName: options.authorName ?? '7sO',
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
    components: options.components ?? [],
    flags: { has: () => options.componentsV2 ?? false },
    reactions: { cache: new Map() },
    reference: null,
    system: false,
    pinned: false,
    mentions: {
      users: mentionedUsers,
      members: new Map(),
      roles: new Map(),
      channels: new Map(),
    },
  } as unknown as Message<true>;
}

interface ChannelOptions {
  readonly messages: readonly Message<true>[];
  /** Member lookups that succeed, by ID. */
  readonly members?: Readonly<Record<string, string>>;
  /** User lookups that succeed once the member lookup has failed. */
  readonly users?: Readonly<Record<string, string>>;
}

function fakeChannel(options: ChannelOptions) {
  const memberFetch = vi.fn((id: string) => {
    const name = options.members?.[id];
    return name === undefined
      ? Promise.reject(new Error('Unknown Member'))
      : Promise.resolve({ displayName: name });
  });

  const userFetch = vi.fn((id: string) => {
    const name = options.users?.[id];
    return name === undefined
      ? Promise.reject(new Error('Unknown User'))
      : Promise.resolve({ displayName: name });
  });

  // Newest-first, the order Discord returns.
  const page = new Map([...options.messages].reverse().map((message) => [message.id, message]));

  const channel = {
    id: CHANNEL_ID,
    name: 'ticket-1042',
    messages: { fetch: () => Promise.resolve(page) },
    guild: { members: { cache: new Map(), fetch: memberFetch } },
    client: { users: { cache: new Map(), fetch: userFetch } },
  } as unknown as TextChannel;

  return { channel, memberFetch, userFetch };
}

describe('mention names in a transcript', () => {
  it('resolves a mention Discord left out of the payload', async () => {
    // Every announcement this bot writes suppresses its pings, and Discord then
    // omits those users from `mentions` - which is why the ID reached the page.
    const { channel } = fakeChannel({
      messages: [
        fakeMessage({
          content: `<@${SILENT_ID}> was added by <@${AUTHOR_ID}>.`,
        }),
      ],
      members: { [SILENT_ID]: 'Nora' },
    });

    const collected = await collectMessages(channel, { limit: 100 });

    expect(collected.mentions.users[SILENT_ID]).toBe('Nora');
    // The actor was already known: they authored the message.
    expect(collected.mentions.users[AUTHOR_ID]).toBe('7sO');
  });

  it('prefers the server nickname over the global name', async () => {
    const { channel } = fakeChannel({
      messages: [fakeMessage({ content: `<@${SILENT_ID}>` })],
      members: { [SILENT_ID]: 'Nora (staff)' },
      users: { [SILENT_ID]: 'nora_global' },
    });

    const collected = await collectMessages(channel, { limit: 100 });

    expect(collected.mentions.users[SILENT_ID]).toBe('Nora (staff)');
  });

  it('falls back to the account when the member has left the server', async () => {
    const { channel, memberFetch } = fakeChannel({
      messages: [fakeMessage({ content: `<@${SILENT_ID}>` })],
      users: { [SILENT_ID]: 'nora_global' },
    });

    const collected = await collectMessages(channel, { limit: 100 });

    expect(memberFetch).toHaveBeenCalledWith(SILENT_ID);
    expect(collected.mentions.users[SILENT_ID]).toBe('nora_global');
  });

  it('leaves the ID unresolved when the account is gone entirely', async () => {
    const { channel } = fakeChannel({
      messages: [fakeMessage({ content: `<@${SILENT_ID}>` })],
    });

    const collected = await collectMessages(channel, { limit: 100 });

    // The renderer degrades this to `@<id>` rather than failing the close.
    expect(collected.mentions.users[SILENT_ID]).toBeUndefined();
  });

  it('does not look up a mention the payload already named', async () => {
    const { channel, memberFetch, userFetch } = fakeChannel({
      messages: [
        fakeMessage({
          content: `<@${SILENT_ID}> joined`,
          mentionedUsers: [{ id: SILENT_ID, name: 'Nora' }],
        }),
      ],
    });

    const collected = await collectMessages(channel, { limit: 100 });

    expect(collected.mentions.users[SILENT_ID]).toBe('Nora');
    expect(memberFetch).not.toHaveBeenCalled();
    expect(userFetch).not.toHaveBeenCalled();
  });

  it('looks each unresolved ID up once however often it is mentioned', async () => {
    const { channel, memberFetch } = fakeChannel({
      messages: [
        fakeMessage({ id: '1', content: `<@${SILENT_ID}> was added` }),
        fakeMessage({ id: '2', content: `<@${SILENT_ID}> was removed` }),
        fakeMessage({ id: '3', content: `hello <@${SILENT_ID}>` }),
      ],
      members: { [SILENT_ID]: 'Nora' },
    });

    await collectMessages(channel, { limit: 100 });

    expect(memberFetch).toHaveBeenCalledTimes(1);
  });
});

describe('Components V2 collection', () => {
  it('walks the layout tree instead of dropping it', async () => {
    const components = [
      {
        type: ComponentType.Container,
        hexAccentColor: '#9146ff',
        components: [
          { type: ComponentType.TextDisplay, content: `Welcome <@${SILENT_ID}>!` },
          {
            type: ComponentType.ActionRow,
            components: [
              {
                type: ComponentType.Button,
                label: 'Close',
                style: ButtonStyle.Danger,
                disabled: false,
                url: null,
                emoji: null,
              },
            ],
          },
        ],
      },
    ];

    const { channel } = fakeChannel({
      messages: [fakeMessage({ components, componentsV2: true })],
      members: { [SILENT_ID]: 'Nora' },
    });

    const collected = await collectMessages(channel, { limit: 100 });
    const message = collected.messages[0]!;

    expect(message.componentsV2).toBe(true);
    expect(message.components).toHaveLength(1);

    const container = message.components[0] as TranscriptContainer;
    expect(container.kind).toBe('container');
    expect(container.color).toBe('#9146ff');
    expect(container.components[0]).toEqual({
      kind: 'textDisplay',
      content: `Welcome <@${SILENT_ID}>!`,
    });
    expect(container.components[1]).toMatchObject({
      kind: 'actionRow',
      components: [{ kind: 'button', label: 'Close', style: 'danger' }],
    });

    // A mention made only inside a TextDisplay still resolves to a name.
    expect(collected.mentions.users[SILENT_ID]).toBe('Nora');
  });

  it('quotes the TextDisplay text when a reply points at a V2 message', async () => {
    const announced = fakeMessage({
      id: '900000000000000001',
      componentsV2: true,
      components: [{ type: ComponentType.TextDisplay, content: 'Ticket closed by staff.' }],
    });
    const reply = {
      ...fakeMessage({ id: '900000000000000002', content: 'thanks!' }),
      reference: { messageId: '900000000000000001' },
    } as unknown as Message<true>;

    const { channel } = fakeChannel({ messages: [announced, reply] });
    const collected = await collectMessages(channel, { limit: 100 });

    expect(collected.messages[1]!.reference?.excerpt).toBe('Ticket closed by staff.');
  });
});

describe('filtering and pre-fetched messages', () => {
  it('applies the filter before grouping and reply summaries', async () => {
    const kept = fakeMessage({ id: '1', content: 'a human speaks' });
    const dropped = {
      ...fakeMessage({ id: '2', content: 'bot noise' }),
      author: { ...(kept.author as object), id: '999', bot: true },
    } as unknown as Message<true>;
    const replyToDropped = {
      ...fakeMessage({ id: '3', content: 'replying to the bot' }),
      reference: { messageId: '2' },
    } as unknown as Message<true>;

    const { channel } = fakeChannel({ messages: [kept, dropped, replyToDropped] });
    const collected = await collectMessages(channel, {
      filter: (message) => !message.author.bot,
    });

    expect(collected.messages.map((message) => message.id)).toEqual(['1', '3']);
    // The reply's target was filtered out, so it reads as absent - never as a
    // resolved quote of a message the transcript does not hold.
    expect(collected.messages[1]!.reference?.resolved).toBe(false);
  });

  it('collects from messages the caller already holds, in any order', async () => {
    const older = fakeMessage({ id: '100', content: 'first' });
    const newer = {
      ...fakeMessage({ id: '200', content: 'second' }),
      createdAt: new Date('2026-07-31T01:00:00.000Z'),
      createdTimestamp: new Date('2026-07-31T01:00:00.000Z').getTime(),
    } as unknown as Message<true>;

    const { channel } = fakeChannel({ messages: [] });
    const collected = await collectFromMessages([newer, older], channel);

    expect(collected.truncated).toBe(false);
    expect(collected.messages.map((message) => message.content)).toEqual(['first', 'second']);
  });

  it('accepts the Collection shape fetch returns', async () => {
    const message = fakeMessage({ id: '1', content: 'hello' });
    const { channel } = fakeChannel({ messages: [] });

    const collected = await collectFromMessages(new Map([['1', message]]), channel);
    expect(collected.messages).toHaveLength(1);
  });
});

describe('interactions and threads', () => {
  it('collects the slash-command invocation record', async () => {
    const reply = {
      ...fakeMessage({ id: '1', content: 'Ticket closed.' }),
      interaction: {
        commandName: 'close',
        user: {
          username: 'eissa',
          displayName: 'Eissa',
          displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/2/e.png',
        },
      },
    } as unknown as Message<true>;

    const { channel } = fakeChannel({ messages: [reply] });
    const collected = await collectMessages(channel, {});

    expect(collected.messages[0]!.interaction).toEqual({
      commandName: 'close',
      userName: 'Eissa',
      userAvatarUrl: 'https://cdn.discordapp.com/avatars/2/e.png',
    });
  });

  it('collects the thread hanging off a message', async () => {
    const withThread = {
      ...fakeMessage({ id: '1', content: 'Let us discuss this aside.' }),
      thread: { name: 'side-discussion', messageCount: 12 },
    } as unknown as Message<true>;

    const { channel } = fakeChannel({ messages: [withThread] });
    const collected = await collectMessages(channel, {});

    expect(collected.messages[0]!.thread).toEqual({ name: 'side-discussion', messageCount: 12 });
  });
});

describe('forwarded messages', () => {
  it('reads the snapshot and drops the pseudo-reply', async () => {
    const forwarded = {
      ...fakeMessage({ id: '900000000000000009', content: '' }),
      reference: { messageId: '111111111111111111', channelId: '222222222222222222', type: 1 },
      messageSnapshots: new Map([
        [
          '111111111111111111',
          {
            content: 'Welcome to the support server!',
            embeds: [],
            attachments: new Map(),
            stickers: new Map(),
            components: [],
            createdAt: new Date('2026-07-25T05:04:00.000Z'),
          },
        ],
      ]),
    } as unknown as Message<true>;

    const { channel } = fakeChannel({ messages: [forwarded] });
    const collected = await collectMessages(channel, {});
    const collectedMessage = collected.messages[0]!;

    expect(collectedMessage.forwarded?.content).toBe('Welcome to the support server!');
    expect(collectedMessage.forwarded?.originTimestamp?.toISOString()).toBe(
      '2026-07-25T05:04:00.000Z',
    );
    // The forward's reference must not become a broken reply row.
    expect(collectedMessage.reference).toBeNull();
  });
});
