import {
  AttachmentBuilder,
  GuildPremiumTier,
  type Guild,
  type GuildTextBasedChannel,
} from 'discord.js';
import { collectMessages } from './collector.js';
import { safeFileName } from './html.js';
import type { CreateTranscriptOptions } from './options.js';
import { renderTranscript } from './renderer.js';
import type { TranscriptData, TranscriptPart } from './types.js';

/**
 * The one-call layer: fetch a channel's history and render it to files.
 *
 * Transcripts are always files. There is no hosting, no viewer and no link -
 * an oversized transcript is split into several standalone HTML files rather
 * than being uploaded anywhere else.
 */

/**
 * Discord's per-message upload limit, by boost tier. A safety factor is applied
 * because a multipart request carries embeds and JSON payload too.
 */
const UPLOAD_LIMIT_BY_TIER: Readonly<Record<GuildPremiumTier, number>> = {
  [GuildPremiumTier.None]: 10 * 1024 * 1024,
  [GuildPremiumTier.Tier1]: 10 * 1024 * 1024,
  [GuildPremiumTier.Tier2]: 50 * 1024 * 1024,
  [GuildPremiumTier.Tier3]: 100 * 1024 * 1024,
};

const UPLOAD_SAFETY_FACTOR = 0.9;

/**
 * The largest file that can safely be uploaded to a channel of this guild,
 * with headroom for the rest of the request. This is what `maxFileBytes:
 * 'auto'` resolves to.
 */
export function uploadBudgetBytes(guild: Guild): number {
  const limit = UPLOAD_LIMIT_BY_TIER[guild.premiumTier];
  return Math.floor(limit * UPLOAD_SAFETY_FACTOR);
}

export interface Transcript {
  /** One attachment per part, ready to pass to `channel.send({ files })`. */
  readonly files: AttachmentBuilder[];
  /** The raw parts, for saving to disk or storing elsewhere. */
  readonly parts: readonly TranscriptPart[];
  readonly messageCount: number;
  /** Total size of every part, in bytes. */
  readonly byteSize: number;
  /** True when the channel held more messages than `limit`. */
  readonly truncated: boolean;
  readonly generatedAt: Date;
}

/**
 * Collects a channel's full history and renders it as one or more standalone
 * HTML files that reproduce the conversation as it appeared in Discord.
 *
 * Rejects with the underlying discord.js error when the history cannot be
 * read; nothing is partially delivered.
 */
export async function createTranscript(
  channel: GuildTextBasedChannel,
  options: CreateTranscriptOptions = {},
): Promise<Transcript> {
  const generatedAt = new Date();

  const collected = await collectMessages(channel, {
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.filter === undefined ? {} : { filter: options.filter }),
  });

  const data: TranscriptData = {
    guildName: channel.guild.name,
    channelName: channel.name,
    messages: collected.messages,
    truncated: collected.truncated,
    generatedAt,
    mentions: collected.mentions,
  };

  const maxFileBytes =
    typeof options.maxFileBytes === 'number'
      ? options.maxFileBytes
      : uploadBudgetBytes(channel.guild);
  const filename = options.filename ?? safeFileName(`transcript-${channel.name}`, 'transcript');
  const favicon = resolveFavicon(options.favicon, channel);

  const parts = renderTranscript(data, {
    ...options,
    maxFileBytes,
    filename,
    ...(favicon === null ? {} : { favicon }),
  });
  const byteSize = parts.reduce((sum, part) => sum + part.content.byteLength, 0);

  return {
    files: parts.map(toAttachment),
    parts,
    messageCount: collected.messages.length,
    byteSize,
    truncated: collected.truncated,
    generatedAt,
  };
}

/**
 * `'guild'` (the default) resolves to the guild's icon; a guild without one
 * gets no favicon, exactly like `'none'`. A custom URL passes through to the
 * renderer, whose image policy is the actual gatekeeper.
 */
function resolveFavicon(
  option: CreateTranscriptOptions['favicon'],
  channel: GuildTextBasedChannel,
): string | null {
  if (option === 'none') return null;
  if (option !== undefined && option !== 'guild') return option;
  // Structural read: hand-built channel objects need not model the method.
  return typeof channel.guild.iconURL === 'function'
    ? channel.guild.iconURL({ extension: 'png', size: 64 })
    : null;
}

function toAttachment(part: TranscriptPart): AttachmentBuilder {
  return new AttachmentBuilder(part.content, {
    name: part.filename,
    description:
      part.totalParts > 1
        ? `Channel transcript (part ${String(part.partNumber)} of ${String(part.totalParts)})`
        : 'Channel transcript',
  });
}
