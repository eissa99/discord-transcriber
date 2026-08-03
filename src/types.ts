import type { MentionIndex } from './markdown.js';

/**
 * Discord-free description of everything a transcript renders.
 *
 * The collector converts discord.js objects into these plain values; the
 * renderer only ever sees this shape. That separation is what allows the
 * escaping behaviour to be tested exhaustively without a gateway connection —
 * and what lets you feed the renderer data you assembled yourself.
 */

export interface TranscriptAuthor {
  readonly id: string;
  /** Server nickname if set, otherwise the global display name. */
  readonly displayName: string;
  readonly username: string;
  readonly avatarUrl: string | null;
  readonly bot: boolean;
  /** Highest role colour as `#rrggbb`, or null when uncoloured. */
  readonly color: string | null;
}

export interface TranscriptAttachment {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly size: number;
  readonly contentType: string | null;
  readonly isImage: boolean;
}

export interface TranscriptEmbedField {
  readonly name: string;
  readonly value: string;
  readonly inline: boolean;
}

/**
 * Discord's own classification of an embed.
 *
 * `rich` is the only kind an application can send. The rest are unfurls Discord
 * generates for a link in the message body, and the media ones are rendered as
 * bare media rather than as a bordered card, exactly as the client does.
 */
export type TranscriptEmbedKind = 'rich' | 'image' | 'video' | 'gifv' | 'article' | 'link';

export interface TranscriptEmbed {
  readonly kind: TranscriptEmbedKind;
  readonly title: string | null;
  readonly description: string | null;
  readonly url: string | null;
  readonly color: string | null;
  readonly authorName: string | null;
  /** The author line's link target, when the embed set one. */
  readonly authorUrl: string | null;
  readonly authorIconUrl: string | null;
  readonly authorIconProxyUrl: string | null;
  readonly footerText: string | null;
  readonly footerIconUrl: string | null;
  readonly footerIconProxyUrl: string | null;
  readonly imageUrl: string | null;
  readonly thumbnailUrl: string | null;
  /**
   * Discord's own copy of the media, always on a Discord CDN host. An unfurl of
   * a third-party link (a Tenor GIF, say) carries the origin URL in `imageUrl`
   * and `thumbnailUrl`, which the transcript's image policy rejects; only the
   * proxy is displayable, so both are kept and the renderer prefers this one.
   */
  readonly imageProxyUrl: string | null;
  readonly thumbnailProxyUrl: string | null;
  readonly timestamp: Date | null;
  readonly fields: readonly TranscriptEmbedField[];
}

export type TranscriptButtonStyle =
  | 'primary'
  | 'secondary'
  | 'success'
  | 'danger'
  | 'link'
  | 'premium';

export interface TranscriptComponentEmoji {
  readonly name: string;
  /** Custom emoji ID, or null for a unicode emoji. */
  readonly id: string | null;
  readonly animated: boolean;
}

export interface TranscriptButton {
  readonly kind: 'button';
  readonly label: string | null;
  readonly style: TranscriptButtonStyle;
  readonly disabled: boolean;
  /** Set only on link buttons. */
  readonly url: string | null;
  readonly emoji: TranscriptComponentEmoji | null;
}

/**
 * A menu is reproduced as the closed control the reader would have seen. Its
 * options are not part of the conversation - they were resolved when someone
 * opened it - so only the placeholder is kept.
 */
export interface TranscriptSelect {
  readonly kind: 'select';
  readonly placeholder: string | null;
  readonly disabled: boolean;
}

export type TranscriptComponent = TranscriptButton | TranscriptSelect;

/**
 * The controls attached to a message.
 *
 * These are message content, not chrome: a bot's opening message often carries
 * the buttons the conversation was steered with, and a transcript that drops
 * them loses what the people in that channel were actually offered.
 */
export interface TranscriptActionRow {
  readonly components: readonly TranscriptComponent[];
}

/**
 * The Components V2 layout tree.
 *
 * A message sent with the IsComponentsV2 flag carries no `content`, no embeds
 * and no stickers - every word of it is a TextDisplay somewhere in this tree,
 * so the tree is the whole of such a message rather than an ornament under it.
 */

/** Both copies of a component's media, as on an embed: origin and CDN proxy. */
export interface TranscriptMedia {
  readonly url: string | null;
  readonly proxyUrl: string | null;
  readonly description: string | null;
}

export interface TranscriptTextDisplay {
  readonly kind: 'textDisplay';
  readonly content: string;
}

export interface TranscriptThumbnail {
  readonly kind: 'thumbnail';
  readonly media: TranscriptMedia;
}

/** A section's accessory is a button or a thumbnail, and nothing else. */
export type TranscriptSectionAccessory = TranscriptThumbnail | TranscriptComponent;

export interface TranscriptSection {
  readonly kind: 'section';
  readonly content: readonly TranscriptTextDisplay[];
  readonly accessory: TranscriptSectionAccessory | null;
}

export interface TranscriptContainer {
  readonly kind: 'container';
  /** Accent colour as `#rrggbb`, or null when the container set none. */
  readonly color: string | null;
  readonly components: readonly TranscriptLayoutComponent[];
}

export interface TranscriptMediaGallery {
  readonly kind: 'mediaGallery';
  readonly items: readonly TranscriptMedia[];
}

export interface TranscriptFile {
  readonly kind: 'file';
  readonly name: string;
  readonly url: string | null;
  readonly size: number | null;
}

export interface TranscriptSeparator {
  readonly kind: 'separator';
  readonly divider: boolean;
  readonly spacing: 'small' | 'large';
}

export interface TranscriptLayoutActionRow {
  readonly kind: 'actionRow';
  readonly components: readonly TranscriptComponent[];
}

export type TranscriptLayoutComponent =
  | TranscriptLayoutActionRow
  | TranscriptContainer
  | TranscriptSection
  | TranscriptTextDisplay
  | TranscriptMediaGallery
  | TranscriptFile
  | TranscriptSeparator;

/**
 * Discord's sticker format. `lottie` is a vector animation rather than an
 * image, so it has no CDN rendering the transcript can embed.
 */
export type TranscriptStickerFormat = 'png' | 'apng' | 'lottie' | 'gif';

export interface TranscriptSticker {
  readonly id: string;
  readonly name: string;
  readonly format: TranscriptStickerFormat;
}

export interface TranscriptReference {
  readonly messageId: string;
  readonly authorName: string | null;
  readonly excerpt: string | null;
  /** False when the referenced message is outside the collected range. */
  readonly resolved: boolean;
  readonly authorColor: string | null;
  readonly authorAvatarUrl: string | null;
  readonly authorBot: boolean;
  /**
   * True when the referenced message carried an attachment, embed or sticker.
   * Discord labels a reply to a message that is only media rather than leaving
   * the row blank, which is what an empty excerpt would otherwise produce.
   */
  readonly hasMedia: boolean;
}

export interface TranscriptReaction {
  /** Unicode emoji, or the custom emoji's name. */
  readonly name: string;
  /** Custom emoji ID, or null for a unicode emoji. */
  readonly id: string | null;
  readonly animated: boolean;
  readonly count: number;
}

/**
 * System events whose wording Discord generates in the client rather than
 * sending as message content. Without naming them a pinned-message event
 * reaches the transcript as a message with nothing in it.
 */
export type TranscriptSystemAction =
  | 'pinned'
  | 'joined'
  | 'boosted'
  | 'boostedTier1'
  | 'boostedTier2'
  | 'boostedTier3';

/**
 * The invocation Discord shows above an application's reply to a slash
 * command: "Eissa used /close". Read from the message's interaction record,
 * so the transcript keeps who asked for what a bot then did.
 */
export interface TranscriptCommandInteraction {
  readonly commandName: string;
  readonly userName: string;
  readonly userAvatarUrl: string | null;
}

/** The latest message in a thread, previewed on the thread card. */
export interface TranscriptThreadLastMessage {
  readonly authorName: string;
  readonly authorAvatarUrl: string | null;
  readonly authorColor: string | null;
  readonly content: string;
  readonly createdAt: Date | null;
}

/** The thread hanging off a message, as the client marks it on the parent. */
export interface TranscriptThreadSummary {
  readonly name: string;
  readonly messageCount: number | null;
  /** The thread's latest message, previewed as the client previews it. */
  readonly lastMessage: TranscriptThreadLastMessage | null;
}

/**
 * A forwarded message's snapshot.
 *
 * Discord sends a forward with empty `content`: the forwarded material lives
 * in a message snapshot, and the message reference points at the original -
 * which is usually in another channel entirely. Treating it like a reply
 * renders a bare "unknown message" row and an empty bubble, so a forward is
 * carried as its own thing.
 */
export interface TranscriptForward {
  readonly content: string;
  readonly attachments: readonly TranscriptAttachment[];
  readonly embeds: readonly TranscriptEmbed[];
  readonly stickers: readonly TranscriptSticker[];
  readonly components: readonly TranscriptLayoutComponent[];
  /** Name of the channel the message was forwarded from, when resolvable. */
  readonly originChannelName: string | null;
  /** When the original message was sent, when the snapshot carries it. */
  readonly originTimestamp: Date | null;
}

export interface TranscriptMessage {
  readonly id: string;
  readonly author: TranscriptAuthor;
  readonly createdAt: Date;
  readonly editedAt: Date | null;
  readonly content: string;
  readonly attachments: readonly TranscriptAttachment[];
  readonly embeds: readonly TranscriptEmbed[];
  readonly stickers: readonly TranscriptSticker[];
  /**
   * The message's top-level action rows - the shape a transcript has always
   * carried, kept for anything that reads it. The rows also appear in
   * `components`, in their place in the layout, which is what the renderer
   * draws.
   */
  readonly actionRows: readonly TranscriptActionRow[];
  /** The full Components V2 layout tree, in order. */
  readonly components: readonly TranscriptLayoutComponent[];
  /** True when the message was sent with the IsComponentsV2 flag. */
  readonly componentsV2: boolean;
  readonly reference: TranscriptReference | null;
  /** Set when the message forwards another message. */
  readonly forwarded: TranscriptForward | null;
  /** Set when the message is an application's reply to a slash command. */
  readonly interaction: TranscriptCommandInteraction | null;
  /** Set when a thread hangs off this message. */
  readonly thread: TranscriptThreadSummary | null;
  readonly reactions: readonly TranscriptReaction[];
  readonly system: boolean;
  /** Set when `system` is true and the event is one the transcript can word. */
  readonly systemAction: TranscriptSystemAction | null;
  readonly pinned: boolean;
  /**
   * True when this message continues the previous author's run, as Discord
   * decides it: same author, not a reply, and within a few minutes. Rendered
   * without a repeated avatar and name.
   */
  readonly groupedWithPrevious: boolean;
}

/** Everything the renderer needs to produce a transcript document. */
export interface TranscriptData {
  readonly guildName: string;
  readonly channelName: string;
  readonly messages: readonly TranscriptMessage[];
  /** True when the channel held more messages than the collection limit. */
  readonly truncated: boolean;
  readonly generatedAt: Date;
  /**
   * Display names for every user, role and channel mentioned anywhere in the
   * conversation, resolved once during collection so the renderer performs no
   * lookups and an unresolved mention degrades to its ID rather than raw markup.
   */
  readonly mentions: MentionIndex;
}

export interface TranscriptPart {
  readonly filename: string;
  readonly content: Buffer;
  readonly partNumber: number;
  readonly totalParts: number;
  readonly messageCount: number;
}
