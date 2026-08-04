/**
 * Public options.
 *
 * Everything here is optional: `createTranscript(channel)` with no options
 * produces a neutral, unbranded document. Branding, metadata and notices are
 * integrator-supplied — they are for the person deploying the bot, never for
 * message authors, and `logoSvg` in particular is trusted markup (see below).
 */

import type { Message } from 'discord.js';

/** Glyphs available for the entries of the details panel. */
export type MetadataIcon =
  | 'tag'
  | 'text'
  | 'person'
  | 'shield'
  | 'people'
  | 'clock'
  | 'lock'
  | 'note'
  | 'chat';

/**
 * The document chrome around the conversation: the header, the accent colour
 * and the footer line. The conversation area itself always keeps Discord's own
 * palette, so a transcript reads like the channel it came from no matter how
 * the chrome is branded.
 */
export interface TranscriptBrand {
  /**
   * Small uppercase line above the channel name in the header — a product or
   * server name. Omitted entirely when not set.
   */
  readonly name?: string;
  /**
   * Inline SVG rendered in the header and footer. It must carry
   * `class="brand-mark"`, which the stylesheet sizes per context.
   *
   * SECURITY: this string is embedded verbatim, because an image URL would
   * break both the document's img-src policy and its promise to read offline.
   * Pass only markup you wrote yourself; never route user input through it.
   */
  readonly logoSvg?: string;
  /** Accent colour of the chrome as `#rrggbb`. Default: Discord blurple. */
  readonly accentColor?: string;
  /** Footer line. Default: names this library. */
  readonly footerText?: string;
}

/** One row of the details panel above the conversation. */
export interface TranscriptMetadataEntry {
  readonly label: string;
  readonly value: string;
  readonly icon?: MetadataIcon;
  /** Give the value the full row — for free text that can run long. */
  readonly wide?: boolean;
}

/** Options for the pure rendering layer. */
export interface RenderTranscriptOptions {
  /**
   * Maximum size of one rendered file, in bytes. A transcript that would
   * exceed it is split into several complete standalone HTML files. Default:
   * unlimited, one file.
   */
  readonly maxFileBytes?: number;
  /** Base file name without extension. Default: `transcript`. */
  readonly filename?: string;
  /** Document `<title>`. Default: `#channel · guild`. */
  readonly title?: string;
  /**
   * Browser-tab icon URL. Must be on Discord's CDN - the same image policy as
   * everything else - or it is dropped. Default: none.
   */
  readonly favicon?: string;
  readonly brand?: TranscriptBrand;
  /** Rendered as a details panel above the conversation when non-empty. */
  readonly metadata?: readonly TranscriptMetadataEntry[];
  /** Heading of the details panel. Default: `Details`. */
  readonly metadataTitle?: string;
  /** Extra notice lines shown above the conversation. */
  readonly notices?: readonly string[];
}

/** Options for {@link createTranscript}. */
export interface CreateTranscriptOptions {
  /**
   * Maximum number of messages to collect, keeping the most recent. Default:
   * every message in the channel.
   */
  readonly limit?: number;
  /**
   * Keeps only the messages the predicate accepts - `(m) => !m.author.bot`,
   * say. Applied before grouping and reply summaries are computed, so the
   * rendered conversation stays coherent.
   */
  readonly filter?: (message: Message<true>) => boolean;
  /**
   * Browser-tab icon: `'guild'` uses the guild's icon (the default),
   * `'none'` emits no favicon, and any other string is a URL - which must be
   * on Discord's CDN or it is dropped.
   */
  readonly favicon?: 'guild' | 'none' | (string & {});
  /**
   * Maximum size of one generated file, in bytes. `'auto'` derives it from the
   * guild's boost tier, with headroom for the rest of the upload request, so
   * the files can always be sent to a channel of that guild. Default: `'auto'`.
   */
  readonly maxFileBytes?: number | 'auto';
  /** Base file name without extension. Default: `transcript-<channel name>`. */
  readonly filename?: string;
  /** Document `<title>`. Default: `#channel · guild`. */
  readonly title?: string;
  readonly brand?: TranscriptBrand;
  /** Rendered as a details panel above the conversation when non-empty. */
  readonly metadata?: readonly TranscriptMetadataEntry[];
  /** Heading of the details panel. Default: `Details`. */
  readonly metadataTitle?: string;
  /** Extra notice lines shown above the conversation. */
  readonly notices?: readonly string[];
}
