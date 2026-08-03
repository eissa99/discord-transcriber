import { ButtonStyle, ComponentType, MessageFlags, MessageType, SeparatorSpacingSize } from 'discord.js';
import type {
  Collection,
  GuildTextBasedChannel,
  Message,
  Snowflake,
} from 'discord.js';
import type { MentionIndex, ResolvedRole } from './markdown.js';
import type {
  TranscriptActionRow,
  TranscriptAttachment,
  TranscriptAuthor,
  TranscriptButtonStyle,
  TranscriptCommandInteraction,
  TranscriptComponent,
  TranscriptEmbed,
  TranscriptEmbedKind,
  TranscriptFile,
  TranscriptForward,
  TranscriptLayoutActionRow,
  TranscriptLayoutComponent,
  TranscriptMedia,
  TranscriptMessage,
  TranscriptReaction,
  TranscriptReference,
  TranscriptSection,
  TranscriptSectionAccessory,
  TranscriptSticker,
  TranscriptStickerFormat,
  TranscriptSystemAction,
  TranscriptTextDisplay,
  TranscriptThreadLastMessage,
  TranscriptThreadSummary,
} from './types.js';

/**
 * Reads a channel's history over the REST API.
 *
 * Pagination is mandatory here: the gateway cache holds only whatever happened
 * to arrive while this process was running, which for a channel opened before
 * the last restart is nothing. Messages are pulled newest-first in pages of
 * 100 and reversed once, so the transcript is chronological.
 */

export interface CollectOptions {
  /**
   * Maximum number of messages to collect, keeping the most recent. Default:
   * every message in the channel.
   */
  readonly limit?: number;
  /**
   * Keeps only the messages the predicate accepts - `(m) => !m.author.bot`,
   * say. Applied before grouping and reply summaries are computed, so the
   * rendered conversation stays coherent. The limit counts fetched messages,
   * not kept ones.
   */
  readonly filter?: (message: Message<true>) => boolean;
}

export interface CollectedMessages {
  readonly messages: readonly TranscriptMessage[];
  /** True when the channel held more messages than the limit. */
  readonly truncated: boolean;
  readonly mentions: MentionIndex;
}

/** Discord's maximum page size for message history. */
const FETCH_PAGE_SIZE = 100;

const REFERENCE_EXCERPT_LENGTH = 120;

/** Discord groups consecutive messages from one author within this window. */
const GROUPING_WINDOW_MS = 7 * 60 * 1000;

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

export async function collectMessages(
  channel: GuildTextBasedChannel,
  options: CollectOptions = {},
): Promise<CollectedMessages> {
  const maxMessages = Math.max(0, options.limit ?? Number.POSITIVE_INFINITY);
  const collected: Message<true>[] = [];
  let before: Snowflake | undefined;
  let truncated = false;

  while (collected.length < maxMessages) {
    const remaining = maxMessages - collected.length;
    const limit = Math.min(FETCH_PAGE_SIZE, remaining);

    const page: Collection<Snowflake, Message<true>> = await channel.messages.fetch(
      before === undefined ? { limit } : { limit, before },
    );

    if (page.size === 0) break;

    const ordered = [...page.values()];
    collected.push(...ordered);

    const last = ordered.at(-1);
    if (!last) break;
    before = last.id;

    if (page.size < limit) break;
    if (collected.length >= maxMessages) {
      // One more page exists only if the last fetch filled its limit.
      truncated = page.size === limit;
      break;
    }
  }

  // Newest-first from Discord; the transcript reads oldest-first.
  collected.reverse();

  const processed = await processMessages(collected, channel, options.filter);
  return { ...processed, truncated };
}

export interface CollectFromMessagesOptions {
  /** Keeps only the messages the predicate accepts. */
  readonly filter?: (message: Message<true>) => boolean;
}

/**
 * Converts messages the caller already holds - a cache, a partial export,
 * another fetch - without touching the REST API for history. Accepts an array
 * or the Collection `channel.messages.fetch` returns, in any order; the
 * transcript is sorted chronologically. The channel provides the guild
 * context mention resolution reads.
 */
export async function collectFromMessages(
  messages: readonly Message<true>[] | ReadonlyMap<string, Message<true>>,
  channel: GuildTextBasedChannel,
  options: CollectFromMessagesOptions = {},
): Promise<CollectedMessages> {
  const list = Array.isArray(messages)
    ? [...(messages as readonly Message<true>[])]
    : [...(messages as ReadonlyMap<string, Message<true>>).values()];
  list.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const processed = await processMessages(list, channel, options.filter);
  return { ...processed, truncated: false };
}

/**
 * The shared tail of collection: filter, reply summaries, grouping, mentions.
 *
 * The filter runs before summaries and grouping so a reply to a filtered-out
 * message reads as "not included in this transcript" and a run broken by the
 * filter regains its heading - filtering the finished TranscriptMessage list
 * afterwards would get both wrong.
 */
async function processMessages(
  ordered: readonly Message<true>[],
  channel: GuildTextBasedChannel,
  filter: ((message: Message<true>) => boolean) | undefined,
): Promise<Omit<CollectedMessages, 'truncated'>> {
  const kept = filter === undefined ? ordered : ordered.filter((message) => filter(message));

  const summaries = new Map<string, ReferenceSummary>();
  for (const message of kept) {
    summaries.set(message.id, {
      authorName: displayName(message),
      excerpt: truncate(messageText(message).replace(/\s+/g, ' ').trim(), REFERENCE_EXCERPT_LENGTH),
      color: readRoleColor(message),
      avatarUrl: message.author.displayAvatarURL({ size: 32, extension: 'png' }),
      bot: message.author.bot,
      hasMedia:
        message.attachments.size > 0 ||
        message.embeds.length > 0 ||
        message.stickers.size > 0 ||
        hasComponentMedia(rawComponents(message)),
    });
  }

  const threadPreviews = await fetchThreadPreviews(kept);

  const messages = kept.map((message, index) =>
    toTranscriptMessage(message, summaries, kept[index - 1], channel, threadPreviews),
  );

  return { messages, mentions: await buildMentionIndex(kept, channel) };
}

/**
 * Collects display names for everything mentioned anywhere in the conversation.
 *
 * discord.js parses the mention lists off each message payload, which covers
 * mentions that actually pinged someone at no API cost. It does not cover the
 * rest: Discord omits a user from `mentions` when the sender suppressed the
 * ping through `allowed_mentions` - which bots that announce "<@x> was added
 * by <@y>" routinely do. Those IDs are resolved individually afterwards so the
 * transcript shows a name rather than a bare number.
 */
async function buildMentionIndex(
  messages: readonly Message<true>[],
  channel: GuildTextBasedChannel,
): Promise<MentionIndex> {
  const users: Record<string, string> = {};
  const roles: Record<string, ResolvedRole> = {};
  const channels: Record<string, string> = {};

  for (const message of messages) {
    for (const [id, user] of message.mentions.users) {
      const member = message.mentions.members.get(id);
      users[id] = member?.displayName ?? user.displayName;
    }
    for (const [id, role] of message.mentions.roles) {
      roles[id] = { name: role.name, color: role.hexColor === '#000000' ? null : role.hexColor };
    }
    for (const [id, mentioned] of message.mentions.channels) {
      channels[id] =
        'name' in mentioned && typeof mentioned.name === 'string' ? mentioned.name : id;
    }

    // A reply references its author without mentioning them.
    users[message.author.id] ??= displayName(message);
  }

  await resolveSuppressedUserMentions(messages, channel, users);

  // The channel itself is frequently referenced from inside its own
  // conversation.
  channels[channel.id] ??= channel.name;

  return { users, roles, channels };
}

const USER_MENTION_PATTERN = /<@!?(\d{17,20})>/g;

/**
 * A conversation that names many people should not turn into a burst of
 * lookups, so the tail degrades to raw IDs rather than delaying generation.
 */
const MAX_MENTION_LOOKUPS = 50;

/**
 * Fills in names for mentions that never reached `message.mentions`, reading
 * the raw markup out of every field a mention can appear in.
 */
async function resolveSuppressedUserMentions(
  messages: readonly Message<true>[],
  channel: GuildTextBasedChannel,
  users: Record<string, string>,
): Promise<void> {
  const unresolved = new Set<string>();

  for (const message of messages) {
    for (const text of mentionBearingText(message)) {
      for (const match of text.matchAll(USER_MENTION_PATTERN)) {
        const id = match[1];
        if (id !== undefined && users[id] === undefined) unresolved.add(id);
      }
    }
  }

  const lookups = [...unresolved].slice(0, MAX_MENTION_LOOKUPS);
  const resolved = await Promise.all(lookups.map((id) => resolveUserName(channel, id)));

  lookups.forEach((id, index) => {
    const name = resolved[index];
    if (name !== null && name !== undefined) users[id] = name;
  });
}

/** Every place a `<@id>` can appear in a message the transcript renders. */
function mentionBearingText(message: Message<true>): string[] {
  const texts = [message.content];

  for (const embed of message.embeds) {
    if (embed.description !== null) texts.push(embed.description);
    for (const field of embed.fields) texts.push(field.value);
  }

  // A Components V2 message has no content, so every mention it makes is in a
  // TextDisplay - including bot announcements that suppress their pings and so
  // are exactly the ones Discord leaves out of `mentions`.
  texts.push(...textDisplayContents(rawComponents(message)));

  // A forward carries its words in the snapshot, not in `content`.
  const snapshot = firstSnapshot(message);
  if (snapshot?.content !== undefined) texts.push(snapshot.content);

  return texts;
}

/**
 * Resolves one user ID to the best name available.
 *
 * The server nickname is preferred, then the global display name. Fetching a
 * single member by ID is a plain REST read that works without the GuildMembers
 * intent; a member who has left falls back to the user record, and an account
 * that no longer exists degrades to null so the ID is rendered instead.
 */
async function resolveUserName(channel: GuildTextBasedChannel, id: string): Promise<string | null> {
  const cachedMember = channel.guild.members.cache.get(id);
  if (cachedMember) return cachedMember.displayName;

  const cachedUser = channel.client.users.cache.get(id);
  if (cachedUser) return cachedUser.displayName;

  try {
    const member = await channel.guild.members.fetch(id);
    return member.displayName;
  } catch {
    // Not a member of this guild any more; the account may still exist.
  }

  try {
    const user = await channel.client.users.fetch(id);
    return user.displayName;
  } catch {
    return null;
  }
}

interface ReferenceSummary {
  readonly authorName: string;
  readonly excerpt: string;
  readonly color: string | null;
  readonly avatarUrl: string | null;
  readonly bot: boolean;
  readonly hasMedia: boolean;
}

function displayName(message: Message<true>): string {
  return message.member?.displayName ?? message.author.displayName;
}

/**
 * Role colour is purely cosmetic and depends on the role cache, which can be
 * incomplete for a member who has since left. Any failure degrades to no colour.
 */
function readRoleColor(message: Message<true>): string | null {
  try {
    const hex = message.member?.displayHexColor;
    return hex !== undefined && hex !== '#000000' ? hex : null;
  } catch {
    return null;
  }
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];

function toTranscriptMessage(
  message: Message<true>,
  summaries: Map<string, ReferenceSummary>,
  previous: Message<true> | undefined,
  channel: GuildTextBasedChannel,
  threadPreviews: ReadonlyMap<string, RawThreadMessage | null>,
): TranscriptMessage {
  const forwarded = toForward(message, channel);
  // A forward's reference points at the original message - usually in another
  // channel entirely - so treating it as a reply row would only ever produce
  // "message not included in this transcript".
  const reference = forwarded === null ? toReference(message, summaries) : null;

  return {
    id: message.id,
    author: toAuthor(message),
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    content: message.content,
    attachments: [...message.attachments.values()].map(toAttachment),
    embeds: message.embeds.map(toEmbed),
    stickers: [...message.stickers.values()].map(toSticker),
    actionRows: toActionRows(message),
    components: toComponentTree(rawComponents(message), 0),
    componentsV2: message.flags?.has(MessageFlags.IsComponentsV2) ?? false,
    reference,
    forwarded,
    interaction: toInteraction(message),
    thread: toThread(message, threadPreviews.get(message.id) ?? null),
    reactions: toReactions(message),
    system: message.system,
    systemAction: toSystemAction(message.type),
    pinned: message.pinned,
    groupedWithPrevious: isGrouped(message, previous, reference !== null),
  };
}

/**
 * Names the system events the transcript can word.
 *
 * These arrive with empty `content` because Discord words them in the client,
 * so an unnamed one renders as a message with nothing in it. Pins in
 * particular are common in support and ticket channels.
 */
const SYSTEM_ACTIONS = new Map<MessageType, TranscriptSystemAction>([
  [MessageType.ChannelPinnedMessage, 'pinned'],
  [MessageType.UserJoin, 'joined'],
  [MessageType.GuildBoost, 'boosted'],
  [MessageType.GuildBoostTier1, 'boostedTier1'],
  [MessageType.GuildBoostTier2, 'boostedTier2'],
  [MessageType.GuildBoostTier3, 'boostedTier3'],
]);

/**
 * The narrow surface of the deprecated `message.interaction` record this
 * collector reads. `interactionMetadata`, its replacement, does not carry the
 * command name - which is the one thing the transcript needs - so the old
 * record is read structurally for as long as Discord fills it.
 */
interface RawInteraction {
  readonly commandName?: string;
  readonly user?: {
    readonly username?: string;
    readonly displayName?: string;
    readonly displayAvatarURL?: (options?: object) => string;
  };
}

function toInteraction(message: Message<true>): TranscriptCommandInteraction | null {
  const raw =
    (message as unknown as { interaction?: RawInteraction | null }).interaction ?? null;
  if (raw === null) return null;

  return {
    commandName: raw.commandName ?? 'command',
    userName: raw.user?.displayName ?? raw.user?.username ?? 'Unknown user',
    userAvatarUrl:
      typeof raw.user?.displayAvatarURL === 'function'
        ? raw.user.displayAvatarURL({ size: 32, extension: 'png' })
        : null,
  };
}

/**
 * The narrow structural surface of a thread's latest message the preview
 * reads.
 */
interface RawThreadMessage {
  readonly content?: string;
  readonly createdAt?: Date;
  readonly author?: {
    readonly displayName?: string;
    readonly username?: string;
    readonly displayAvatarURL?: (options?: object) => string;
  };
  readonly member?: {
    readonly displayName?: string;
    readonly displayHexColor?: string;
  } | null;
}

/**
 * A channel full of threads should not turn into a burst of lookups, so the
 * tail degrades to cards without a preview line rather than delaying
 * generation.
 */
const MAX_THREAD_LOOKUPS = 20;

/**
 * Fetches each thread's latest message, for the preview line the client shows
 * on the thread card. One REST read per thread, capped; any failure degrades
 * to a card without the preview.
 */
async function fetchThreadPreviews(
  messages: readonly Message<true>[],
): Promise<Map<string, RawThreadMessage | null>> {
  const previews = new Map<string, RawThreadMessage | null>();

  const withThreads = messages
    .filter((message) => (message as unknown as { thread?: unknown }).thread)
    .slice(0, MAX_THREAD_LOOKUPS);

  await Promise.all(
    withThreads.map(async (message) => {
      const thread = (
        message as unknown as {
          thread?: {
            messages?: { fetch?: (options: { limit: number }) => Promise<unknown> };
          } | null;
        }
      ).thread;

      try {
        const page = await thread?.messages?.fetch?.({ limit: 1 });
        const latest = collectionValues(page)[0] as RawThreadMessage | undefined;
        previews.set(message.id, latest ?? null);
      } catch {
        previews.set(message.id, null);
      }
    }),
  );

  return previews;
}

function toThread(
  message: Message<true>,
  preview: RawThreadMessage | null,
): TranscriptThreadSummary | null {
  const thread =
    (message as unknown as { thread?: { name?: string; messageCount?: number | null } | null })
      .thread ?? null;
  if (thread === null) return null;

  let lastMessage: TranscriptThreadLastMessage | null = null;
  if (preview !== null) {
    const hex = preview.member?.displayHexColor;
    lastMessage = {
      authorName:
        preview.member?.displayName ??
        preview.author?.displayName ??
        preview.author?.username ??
        'Unknown user',
      authorAvatarUrl:
        typeof preview.author?.displayAvatarURL === 'function'
          ? preview.author.displayAvatarURL({ size: 32, extension: 'png' })
          : null,
      authorColor: hex !== undefined && hex !== '#000000' ? hex : null,
      content: preview.content ?? '',
      createdAt: preview.createdAt instanceof Date ? preview.createdAt : null,
    };
  }

  return { name: thread.name ?? 'thread', messageCount: thread.messageCount ?? null, lastMessage };
}

function toSystemAction(type: MessageType): TranscriptSystemAction | null {
  return SYSTEM_ACTIONS.get(type) ?? null;
}

/** Mirrors Discord's own grouping: same author, not a reply, close in time. */
function isGrouped(
  message: Message<true>,
  previous: Message<true> | undefined,
  isReply: boolean,
): boolean {
  if (previous === undefined || isReply) return false;
  if (message.system || previous.system) return false;
  if (message.author.id !== previous.author.id) return false;
  return message.createdTimestamp - previous.createdTimestamp <= GROUPING_WINDOW_MS;
}

function toAuthor(message: Message<true>): TranscriptAuthor {
  return {
    id: message.author.id,
    displayName: displayName(message),
    username: message.author.username,
    avatarUrl: message.author.displayAvatarURL({ size: 64, extension: 'png' }),
    bot: message.author.bot,
    color: readRoleColor(message),
  };
}

function toReactions(message: Message<true>): TranscriptReaction[] {
  return [...message.reactions.cache.values()].map((reaction) => ({
    name: reaction.emoji.name ?? 'emoji',
    id: reaction.emoji.id,
    animated: reaction.emoji.animated ?? false,
    count: reaction.count,
  }));
}

function toAttachment(attachment: {
  id: string;
  name: string;
  url: string;
  size: number;
  contentType: string | null;
}): TranscriptAttachment {
  const contentType = attachment.contentType;
  const lowerName = attachment.name.toLowerCase();
  const isImage =
    contentType?.startsWith('image/') === true ||
    IMAGE_EXTENSIONS.some((extension) => lowerName.endsWith(extension));

  return {
    id: attachment.id,
    name: attachment.name,
    url: attachment.url,
    size: attachment.size,
    contentType,
    isImage,
  };
}

const EMBED_KINDS: readonly TranscriptEmbedKind[] = [
  'rich',
  'image',
  'video',
  'gifv',
  'article',
  'link',
];

function toEmbedKind(value: string | undefined): TranscriptEmbedKind {
  return EMBED_KINDS.find((kind) => kind === value) ?? 'rich';
}

function toEmbed(embed: Message<true>['embeds'][number]): TranscriptEmbed {
  return {
    kind: toEmbedKind(embed.data.type),
    title: embed.title,
    description: embed.description,
    url: embed.url,
    color: embed.color === null ? null : `#${embed.color.toString(16).padStart(6, '0')}`,
    authorName: embed.author?.name ?? null,
    authorUrl: embed.author?.url ?? null,
    authorIconUrl: embed.author?.iconURL ?? null,
    authorIconProxyUrl: embed.author?.proxyIconURL ?? null,
    footerText: embed.footer?.text ?? null,
    footerIconUrl: embed.footer?.iconURL ?? null,
    footerIconProxyUrl: embed.footer?.proxyIconURL ?? null,
    imageUrl: embed.image?.url ?? null,
    thumbnailUrl: embed.thumbnail?.url ?? null,
    imageProxyUrl: embed.image?.proxyURL ?? null,
    thumbnailProxyUrl: embed.thumbnail?.proxyURL ?? null,
    timestamp: embed.timestamp === null ? null : new Date(embed.timestamp),
    fields: embed.fields.map((field) => ({
      name: field.name,
      value: field.value,
      inline: field.inline ?? false,
    })),
  };
}

const BUTTON_STYLES: Readonly<Record<number, TranscriptButtonStyle>> = {
  [ButtonStyle.Primary]: 'primary',
  [ButtonStyle.Secondary]: 'secondary',
  [ButtonStyle.Success]: 'success',
  [ButtonStyle.Danger]: 'danger',
  [ButtonStyle.Link]: 'link',
  [ButtonStyle.Premium]: 'premium',
};

/**
 * The narrow structural surface of a discord.js component this collector
 * reads. Typed structurally rather than against the discord.js classes so one
 * walk works across every peer version that can deliver the payload, and so a
 * component type Discord adds later simply falls through the switch.
 */
interface RawMedia {
  readonly url?: string | null;
  readonly data?: { readonly proxy_url?: string };
}

interface RawComponent {
  readonly type: number;
  readonly components?: readonly RawComponent[];
  readonly content?: string;
  readonly hexAccentColor?: string | null;
  readonly items?: readonly {
    readonly media?: RawMedia;
    readonly description?: string | null;
  }[];
  readonly accessory?: RawComponent | null;
  readonly media?: RawMedia;
  readonly description?: string | null;
  readonly divider?: boolean;
  readonly spacing?: number;
  readonly file?: { readonly url?: string | null };
  readonly data?: { readonly name?: string; readonly size?: number };
  readonly label?: string | null;
  readonly style?: number;
  readonly disabled?: boolean;
  readonly url?: string | null;
  readonly emoji?: {
    readonly name?: string | null;
    readonly id?: string | null;
    readonly animated?: boolean | null;
  } | null;
  readonly placeholder?: string | null;
}

function rawComponents(message: Message<true>): readonly RawComponent[] {
  return (message.components ?? []) as unknown as readonly RawComponent[];
}

/**
 * Collects the message's top-level action rows.
 *
 * This is the shape a transcript has always carried, kept for anything that
 * reads it. The rows also appear in `components`, in their place in the
 * layout, which is what the renderer draws.
 */
function toActionRows(message: Message<true>): TranscriptActionRow[] {
  const rows: TranscriptActionRow[] = [];

  for (const row of rawComponents(message)) {
    if (row.type !== ComponentType.ActionRow) continue;

    const collected = toActionRow(row);
    if (collected !== null) rows.push({ components: collected.components });
  }

  return rows;
}

/**
 * Walks the whole component tree, in order.
 *
 * Reading only action rows was safe while every message carried its words in
 * `content`. A message sent with the Components V2 flag carries none: content,
 * embeds, stickers and polls are all refused on such a message, and every word
 * of it is in a TextDisplay inside this tree. Skipping what is not an action
 * row therefore renders the entire message blank rather than losing a control.
 *
 * Anything unrecognised is dropped rather than guessed at, which is how an
 * older transcript build treats a component type Discord adds later.
 */
function toComponentTree(
  components: readonly RawComponent[],
  depth: number,
): TranscriptLayoutComponent[] {
  const collected: TranscriptLayoutComponent[] = [];

  for (const component of components) {
    const node = toLayoutComponent(component, depth);
    if (node !== null) collected.push(node);
  }

  return collected;
}

/**
 * Discord nests these two deep at most - a container holds a section, and
 * neither may hold itself - so the cap only bounds a payload that does not
 * follow its own rules.
 */
const MAX_COMPONENT_DEPTH = 6;

function toLayoutComponent(
  component: RawComponent,
  depth: number,
): TranscriptLayoutComponent | null {
  if (depth >= MAX_COMPONENT_DEPTH) return null;

  switch (component.type) {
    case ComponentType.ActionRow:
      return toActionRow(component);
    case ComponentType.Container:
      return {
        kind: 'container',
        color: component.hexAccentColor ?? null,
        components: toComponentTree(component.components ?? [], depth + 1),
      };
    case ComponentType.Section:
      return toSection(component, depth);
    case ComponentType.TextDisplay:
      return { kind: 'textDisplay', content: component.content ?? '' };
    case ComponentType.MediaGallery:
      return {
        kind: 'mediaGallery',
        items: (component.items ?? []).map((item) => toMedia(item.media, item.description)),
      };
    case ComponentType.File:
      return toFile(component);
    case ComponentType.Separator:
      return {
        kind: 'separator',
        divider: component.divider ?? true,
        spacing: component.spacing === SeparatorSpacingSize.Large ? 'large' : 'small',
      };
    default:
      return null;
  }
}

function toActionRow(row: RawComponent): TranscriptLayoutActionRow | null {
  const components = (row.components ?? [])
    .map(toComponent)
    .filter((component): component is TranscriptComponent => component !== null);

  return components.length > 0 ? { kind: 'actionRow', components } : null;
}

function toSection(section: RawComponent, depth: number): TranscriptSection {
  const content = (section.components ?? [])
    .map((child) => toLayoutComponent(child, depth + 1))
    .filter(
      (child): child is TranscriptTextDisplay => child !== null && child.kind === 'textDisplay',
    );

  return { kind: 'section', content, accessory: toAccessory(section.accessory ?? null) };
}

/** A section's accessory is a button or a thumbnail, and nothing else. */
function toAccessory(accessory: RawComponent | null): TranscriptSectionAccessory | null {
  if (!accessory) return null;

  if (accessory.type === ComponentType.Thumbnail) {
    return { kind: 'thumbnail', media: toMedia(accessory.media, accessory.description) };
  }

  return toComponent(accessory);
}

/**
 * Reads both copies of a component's media.
 *
 * The proxy URL is on the raw payload rather than behind a getter, which is
 * the only place discord.js exposes it. Keeping it matters for the same reason
 * it does on an embed: a component may point at a third-party host, which the
 * transcript's image policy rejects, and the proxy is then the only copy that
 * can be displayed.
 */
function toMedia(
  media: RawMedia | undefined,
  description: string | null | undefined,
): TranscriptMedia {
  return {
    url: media?.url ?? null,
    proxyUrl: media?.data?.proxy_url ?? null,
    description: description ?? null,
  };
}

/**
 * The name and size of a File component come back on the payload only -
 * Discord fills them in on the response, and discord.js offers no getter for
 * either.
 */
function toFile(file: RawComponent): TranscriptFile {
  const url = file.file?.url ?? null;

  return {
    kind: 'file',
    name: file.data?.name ?? fileNameFromUrl(url) ?? 'attachment',
    url,
    size: file.data?.size ?? null,
  };
}

function fileNameFromUrl(url: string | null): string | null {
  if (typeof url !== 'string') return null;

  try {
    const name = new URL(url).pathname.split('/').pop();
    return name !== undefined && name !== '' ? decodeURIComponent(name) : null;
  } catch {
    return null;
  }
}

/** The text a Components V2 message says, in the order it says it. */
function textDisplayContents(components: readonly RawComponent[], depth = 0): string[] {
  if (depth >= MAX_COMPONENT_DEPTH) return [];

  const texts: string[] = [];

  for (const component of components) {
    if (component.type === ComponentType.TextDisplay) {
      if (component.content !== undefined) texts.push(component.content);
    } else if (
      component.type === ComponentType.Container ||
      component.type === ComponentType.Section
    ) {
      texts.push(...textDisplayContents(component.components ?? [], depth + 1));
    }
  }

  return texts;
}

/**
 * The text a reply quotes.
 *
 * A Components V2 message has an empty `content`, so quoting that alone leaves
 * every reply to such a message looking like a reply to nothing.
 */
function messageText(message: Message<true>): string {
  if (message.content.trim() !== '') return message.content;
  const fromComponents = textDisplayContents(rawComponents(message)).join(' ');
  if (fromComponents.trim() !== '') return fromComponents;
  return firstSnapshot(message)?.content ?? '';
}

const MEDIA_COMPONENTS: ReadonlySet<number> = new Set([
  ComponentType.MediaGallery,
  ComponentType.File,
  ComponentType.Thumbnail,
]);

/** Whether the tree shows anything a reply should be flagged as pointing at. */
function hasComponentMedia(components: readonly RawComponent[], depth = 0): boolean {
  if (depth >= MAX_COMPONENT_DEPTH) return false;

  return components.some((component) => {
    if (MEDIA_COMPONENTS.has(component.type)) return true;
    if (component.type === ComponentType.Section) {
      return component.accessory?.type === ComponentType.Thumbnail;
    }
    if (component.type === ComponentType.Container) {
      return hasComponentMedia(component.components ?? [], depth + 1);
    }
    return false;
  });
}

/** `MessageReferenceType.Forward` - matched numerically so older peer
 * versions that predate the enum member still compile. */
const FORWARD_REFERENCE_TYPE = 1;

/**
 * The narrow structural surface of a discord.js MessageSnapshot this
 * collector reads.
 */
interface RawSnapshot {
  readonly content?: string;
  readonly embeds?: readonly unknown[];
  readonly attachments?: unknown;
  readonly stickers?: unknown;
  readonly components?: readonly RawComponent[];
  readonly createdAt?: Date;
  readonly createdTimestamp?: number;
}

function firstSnapshot(message: Message<true>): RawSnapshot | null {
  const snaps = (message as unknown as { messageSnapshots?: unknown }).messageSnapshots;
  if (!snaps) return null;
  const first = (snaps as { first?: () => RawSnapshot | undefined }).first;
  if (typeof first === 'function') return first.call(snaps) ?? null;
  if (snaps instanceof Map) return (snaps.values().next().value as RawSnapshot | undefined) ?? null;
  return null;
}

function collectionValues(value: unknown): unknown[] {
  if (value instanceof Map) return [...value.values()];
  if (Array.isArray(value)) return [...value];
  if (typeof (value as { values?: unknown })?.values === 'function') {
    return [...(value as { values: () => Iterable<unknown> }).values()];
  }
  return [];
}

/**
 * Reads a forward's snapshot into plain data, reusing the same conversions the
 * message body gets. Returns null for anything that is not a forward; a
 * forward whose snapshot Discord did not deliver degrades to an empty one, so
 * the "Forwarded" marker still appears rather than a blank bubble.
 */
function toForward(
  message: Message<true>,
  channel: GuildTextBasedChannel,
): TranscriptForward | null {
  const referenceType = (message.reference as unknown as { type?: number } | null)?.type;
  const snapshot = firstSnapshot(message);
  if (referenceType !== FORWARD_REFERENCE_TYPE && snapshot === null) return null;

  const originChannelId = message.reference?.channelId;
  // Structural read: hand-built channel objects need not model the cache.
  const origin =
    originChannelId === undefined
      ? undefined
      : channel.guild.channels?.cache?.get(originChannelId);

  return {
    content: snapshot?.content ?? '',
    attachments: collectionValues(snapshot?.attachments).map((attachment) =>
      toAttachment(attachment as Parameters<typeof toAttachment>[0]),
    ),
    embeds: (snapshot?.embeds ?? []).map((embed) =>
      toEmbed(embed as Parameters<typeof toEmbed>[0]),
    ),
    stickers: collectionValues(snapshot?.stickers).map((sticker) =>
      toSticker(sticker as Parameters<typeof toSticker>[0]),
    ),
    components: toComponentTree(snapshot?.components ?? [], 0),
    originChannelName: origin !== undefined && 'name' in origin ? origin.name : null,
    originTimestamp:
      snapshot?.createdAt instanceof Date
        ? snapshot.createdAt
        : typeof snapshot?.createdTimestamp === 'number'
          ? new Date(snapshot.createdTimestamp)
          : null,
  };
}

function toComponent(component: RawComponent): TranscriptComponent | null {
  if (component.type === ComponentType.Button) {
    return {
      kind: 'button',
      label: component.label ?? null,
      style: BUTTON_STYLES[component.style ?? -1] ?? 'secondary',
      disabled: component.disabled ?? false,
      url: component.url ?? null,
      emoji:
        component.emoji === null || component.emoji === undefined
          ? null
          : {
              name: component.emoji.name ?? 'emoji',
              id: component.emoji.id ?? null,
              animated: component.emoji.animated ?? false,
            },
    };
  }

  if ('placeholder' in component) {
    return {
      kind: 'select',
      placeholder: component.placeholder ?? null,
      disabled: component.disabled ?? false,
    };
  }

  return null;
}

/** Discord's numeric sticker formats, in the order the API documents them. */
const STICKER_FORMATS: Readonly<Record<number, TranscriptStickerFormat>> = {
  1: 'png',
  2: 'apng',
  3: 'lottie',
  4: 'gif',
};

function toSticker(sticker: { id: string; name: string; format: number }): TranscriptSticker {
  return {
    id: sticker.id,
    name: sticker.name,
    format: STICKER_FORMATS[sticker.format] ?? 'png',
  };
}

function toReference(
  message: Message<true>,
  summaries: Map<string, ReferenceSummary>,
): TranscriptReference | null {
  const messageId = message.reference?.messageId;
  if (messageId === undefined) return null;

  const summary = summaries.get(messageId);
  return {
    messageId,
    authorName: summary?.authorName ?? null,
    excerpt: summary?.excerpt ?? null,
    resolved: summary !== undefined,
    authorColor: summary?.color ?? null,
    authorAvatarUrl: summary?.avatarUrl ?? null,
    authorBot: summary?.bot ?? false,
    hasMedia: summary?.hasMedia ?? false,
  };
}
