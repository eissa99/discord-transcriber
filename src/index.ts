/**
 * discord-transcriber
 *
 * Pixel-accurate, self-contained HTML transcripts for Discord channels.
 *
 * The one-call path is {@link createTranscript}. The layers underneath are
 * exported too: {@link collectMessages} turns a channel into plain data, and
 * {@link renderTranscript} turns plain data into HTML files - so transcripts
 * can be rendered from stored data with no Discord connection at all.
 */

export { createTranscript, uploadBudgetBytes, type Transcript } from './create-transcript.js';
export {
  collectFromMessages,
  collectMessages,
  type CollectFromMessagesOptions,
  type CollectOptions,
  type CollectedMessages,
} from './collector.js';
export { renderTranscript, transcriptFileName } from './renderer.js';
export {
  EMPTY_MENTIONS,
  renderMarkdown,
  type MentionIndex,
  type ResolvedRole,
} from './markdown.js';
export type {
  CreateTranscriptOptions,
  MetadataIcon,
  RenderTranscriptOptions,
  TranscriptBrand,
  TranscriptMetadataEntry,
} from './options.js';
export type {
  TranscriptActionRow,
  TranscriptAttachment,
  TranscriptAuthor,
  TranscriptButton,
  TranscriptButtonStyle,
  TranscriptCommandInteraction,
  TranscriptComponent,
  TranscriptComponentEmoji,
  TranscriptContainer,
  TranscriptData,
  TranscriptEmbed,
  TranscriptEmbedField,
  TranscriptEmbedKind,
  TranscriptFile,
  TranscriptForward,
  TranscriptLayoutActionRow,
  TranscriptLayoutComponent,
  TranscriptMedia,
  TranscriptMediaGallery,
  TranscriptMessage,
  TranscriptPart,
  TranscriptReaction,
  TranscriptReference,
  TranscriptSection,
  TranscriptSectionAccessory,
  TranscriptSelect,
  TranscriptSeparator,
  TranscriptSticker,
  TranscriptStickerFormat,
  TranscriptSystemAction,
  TranscriptTextDisplay,
  TranscriptThreadLastMessage,
  TranscriptThreadSummary,
  TranscriptThumbnail,
} from './types.js';
