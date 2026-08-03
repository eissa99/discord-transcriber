/**
 * Transcript stylesheet.
 *
 * The conversation area reproduces Discord's dark theme closely - the same
 * palette, spacing, message grouping and typography - so a transcript reads
 * like the channel it came from. The surrounding document chrome takes the
 * integrator's accent, which keeps it obvious that the file is a record rather
 * than a screenshot of Discord.
 *
 * Everything is inline in the document. Nothing is fetched at open time except
 * images from Discord's CDN, which the Content-Security-Policy restricts.
 *
 * @param accent A validated `#rrggbb` colour for the chrome accent. The caller
 * validates it (`safeHexColor`) before it reaches this template.
 */
export function buildTranscriptStyles(accent: string): string {
  return `
:root {
  color-scheme: dark;
  --accent: ${accent};
  /* Sampled from the Discord client rather than guessed, so the conversation
     area reads as the channel it came from. */
  --chat-bg: #323339;
  --chat-hover: #3e3f45;
  --embed-bg: #393a41;
  /* The wash on a message you have just jumped to. Discord's own, and unrelated
     to the brand accent: it must not read as an embed's left rule. */
  --jump-flash: #383b57;
  /* Discord's blurple, for the APP tag. The tag is Discord's own marking being
     reproduced, so it takes Discord's colour - the accent belongs to the chrome
     around the conversation, not to a label inside it. */
  --app-tag: #5865f2;
  --surface: #2b2d31;
  --surface-deep: #1e1f22;
  --divider: #3f4147;
  --text: #dbdee1;
  --text-strong: #f2f3f5;
  --text-muted: #949ba4;
  --link: #00a8fc;
  --mention-bg: rgba(88, 101, 242, 0.3);
  --mention-text: #c9cdfb;
  --quote-border: #4e5058;
  --spoiler-bg: #202225;
  --font: "gg sans", "Noto Sans", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: "gg mono", Consolas, "Andale Mono WT", "Courier New", monospace;
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--chat-bg);
  color: var(--text);
  font-family: var(--font);
  font-size: 16px;
  line-height: 1.375;
  -webkit-font-smoothing: antialiased;
}

/* ---- Document chrome ---------------------------------------------------- */

.doc-header {
  display: flex;
  align-items: center;
  gap: 16px;
  background: var(--surface-deep);
  border-bottom: 1px solid var(--divider);
  padding: 18px 24px;
  position: sticky;
  top: 0;
  z-index: 10;
}
/* Inline SVG, so it needs an explicit size: an <svg> has no intrinsic one the
   way an image does, and would otherwise take the full width of the header. */
.doc-header .brand-mark { width: 44px; height: 44px; flex: none; }
.doc-heading { min-width: 0; }
.doc-header .brand {
  color: var(--accent);
  font-weight: 700;
  font-size: 13px;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.doc-header .channel { color: var(--text-strong); font-size: 20px; font-weight: 600; margin-top: 4px; }
.doc-header .channel .hash { color: var(--text-muted); margin-right: 2px; }
.doc-header .sub { color: var(--text-muted); font-size: 13px; margin-top: 4px; }

.panel {
  background: var(--surface);
  border: 1px solid var(--divider);
  border-radius: 8px;
  margin: 16px 24px;
  padding: 14px 18px;
}
.panel h2 {
  margin: 0 0 8px;
  font-size: 11px;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--text-muted);
}
/*
 * Label beside value rather than above it, which roughly halves the panel's
 * height, and as many pairs per row as the width allows. Labels share a fixed
 * column so they line up down the panel and the eye can run the list.
 *
 * A value that can run long takes the whole row, so it wraps into its own
 * space instead of forcing every cell beside it to be as tall.
 */
/*
 * Column count is capped rather than left to auto-fit. On a wide screen
 * auto-fit kept adding columns until each cell was mostly empty space between
 * a short value and the next label.
 */
.meta-grid { display: grid; grid-template-columns: 1fr; column-gap: 28px; }
.meta-cell {
  display: grid;
  grid-template-columns: 118px minmax(0, 1fr);
  /* Centred, not baseline-aligned: the label is a flex row containing an icon,
     so its baseline comes off that row and sits away from a value set at a
     different size - which is what stopped the pair reading as one line. */
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  min-width: 0;
}
.meta-cell.wide { grid-column: 1 / -1; }
.meta-grid .k {
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 1.2;
  color: var(--text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .04em;
  white-space: nowrap;
}
.meta-grid .k svg { flex: none; opacity: .7; }
.meta-grid .v { color: var(--text-strong); font-size: 14px; line-height: 1.2; word-break: break-word; }

@media (min-width: 640px) { .meta-grid { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1040px) { .meta-grid { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 560px) {
  .meta-cell { grid-template-columns: 1fr; gap: 2px; align-items: start; }
}

.notice {
  background: rgba(240, 165, 42, .12);
  border-left: 4px solid #f0a52a;
  border-radius: 4px;
  margin: 16px 24px;
  padding: 12px 16px;
  font-size: 14px;
  color: #f5d9a8;
}

.divider-day {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 24px 24px 8px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 600;
}
.divider-day::before, .divider-day::after {
  content: "";
  flex: 1;
  height: 1px;
  background: var(--divider);
}

/* ---- Conversation ------------------------------------------------------- */

.chat { padding: 8px 0 32px; }

.message {
  position: relative;
  padding: 2px 48px 2px 72px;
  min-height: 22px;
}
.message:hover { background: var(--chat-hover); }
.message.start { margin-top: 17px; }
.message.system { color: var(--text-muted); }

.message .avatar {
  position: absolute;
  left: 16px;
  top: 2px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--surface);
}
.message .avatar-fallback {
  position: absolute;
  left: 16px;
  top: 2px;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--surface);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 600;
}

.message .gutter-time {
  position: absolute;
  left: 0;
  width: 72px;
  padding-right: 8px;
  text-align: right;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.375;
  opacity: 0;
}
.message:hover .gutter-time { opacity: 1; }

.heading { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 2px; }
.heading .name { font-size: 16px; font-weight: 500; color: var(--text-strong); }
.heading .badge, .reply .badge {
  background: var(--app-tag);
  color: #fff;
  border-radius: 3px;
  padding: 0 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .02em;
  position: relative;
  top: -1px;
}
.heading .time { font-size: 12px; color: var(--text-muted); }
.edited { font-size: 10px; color: var(--text-muted); }

.content { color: var(--text); word-wrap: break-word; overflow-wrap: anywhere; }
.content p { margin: 0; }
.content p + p { margin-top: 0; }
.content a.link { color: var(--link); text-decoration: none; }
.content a.link:hover { text-decoration: underline; }
.content ul, .content ol { margin: 4px 0; padding-left: 24px; }
.content li { margin: 2px 0; }
.content blockquote {
  border-left: 4px solid var(--quote-border);
  border-radius: 4px;
  margin: 4px 0;
  padding: 0 8px 0 12px;
  color: var(--text);
}
.md-heading { font-weight: 700; color: var(--text-strong); margin: 8px 0 4px; }
.md-heading.h1 { font-size: 24px; }
.md-heading.h2 { font-size: 20px; }
.md-heading.h3 { font-size: 16px; }

code.inline {
  background: var(--surface-deep);
  border-radius: 3px;
  padding: 1px 4px;
  font-family: var(--mono);
  font-size: 85%;
  white-space: break-spaces;
}
pre.code-block {
  background: var(--surface-deep);
  border: 1px solid #2b2d31;
  border-radius: 4px;
  padding: 8px 10px;
  margin: 6px 0;
  overflow-x: auto;
  max-width: 100%;
}
pre.code-block code {
  font-family: var(--mono);
  font-size: 13px;
  color: #b5bac1;
  white-space: pre;
}

/*
 * A mention is pressable in Discord, so it is pressable here - the affordance
 * only, since there is nowhere in a transcript for it to lead. The hover uses
 * an inset shadow rather than a background, because a role mention carries its
 * own colour inline and a background rule would have to override it.
 */
.mention {
  background: var(--mention-bg);
  color: var(--mention-text);
  border-radius: 3px;
  padding: 0 2px;
  font-weight: 500;
  cursor: pointer;
}
.mention:hover { box-shadow: inset 0 0 0 999px rgba(255, 255, 255, .1); }

.timestamp-chip {
  background: rgba(151, 151, 159, .2);
  border-radius: 3px;
  padding: 0 2px;
}

.spoiler {
  background: var(--spoiler-bg);
  border-radius: 3px;
  padding: 0 2px;
  color: transparent;
}
.spoiler:hover { background: rgba(32, 34, 37, .5); color: var(--text); }

img.emoji {
  width: 1.375em;
  height: 1.375em;
  vertical-align: bottom;
  object-fit: contain;
}

/* ---- Replies ------------------------------------------------------------ */

/*
 * The reply row occupies the line above the heading, and its metrics are
 * Discord's: a 22px row with 4px beneath it. The avatar is positioned out of
 * flow so it cannot affect how the text wraps, so it does not move down on its
 * own - the offset below is that same 22px + 4px, past the 2px the message
 * already pads by.
 */
.reply {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  font-size: 14px;
  line-height: 18px;
  margin-bottom: 4px;
  color: var(--text-muted);
  position: relative;
}
.message.has-reply .avatar,
.message.has-reply .avatar-fallback { top: 28px; }

/*
 * The spine: up from beside the avatar, then a rounded turn into the quoted
 * text. Discord derives the horizontal reach from the gutter rather than a
 * fixed width: right:100% ends it at the content edge, and the 4px margin is
 * the gap before the small avatar. Copying that keeps the elbow aligned at any
 * gutter width instead of only at this one.
 */
.reply::before {
  content: "";
  position: absolute;
  top: 50%;
  right: 100%;
  bottom: 0;
  left: -36px;
  margin-top: -1px;
  margin-right: 4px;
  border-left: 2px solid var(--quote-border);
  border-top: 2px solid var(--quote-border);
  border-top-left-radius: 6px;
}
.reply .avatar-small { width: 16px; height: 16px; border-radius: 50%; flex: none; }
.reply .name { font-weight: 500; color: var(--text-strong); flex: none; }
.reply .badge { flex: none; }
.reply .excerpt { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reply .excerpt p { display: inline; margin: 0; }
.reply .attachment-hint { color: var(--text-muted); font-style: italic; }
.reply .reply-media-icon { color: var(--text-muted); flex: none; }

/*
 * Pressing a reply jumps to the message it answers. The link covers the row as
 * a transparent overlay, so links inside the quoted text stay reachable above
 * it - which is also why it cannot simply wrap the row.
 */
.reply-jump { position: absolute; inset: 0; z-index: 1; }
.reply:hover .name, .reply:hover .excerpt { color: var(--text-strong); }
.reply .excerpt a, .reply .name { position: relative; z-index: 2; }

/*
 * The arrival flash, so the message landed on is obvious in a long transcript.
 * The flash class is what the script sets after scrolling; :target covers the
 * fallback path, where the jump happened through the address bar because
 * scripts were blocked.
 */
.message.flash, .message:target { background: var(--jump-flash); }
.message { transition: background-color .5s ease; }
html { scroll-behavior: smooth; }

/* ---- System events ------------------------------------------------------ */

.message.system-event {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 17px;
  color: var(--text-muted);
  font-size: 15px;
}
.message.system-event .system-icon { color: var(--text-muted); flex: none; margin-left: 12px; }
.message.system-event .name { font-weight: 500; color: var(--text-strong); }
.message.system-event .time { font-size: 12px; color: var(--text-muted); margin-left: 8px; }
/* The phrase the event points at - "a message" on a pin. It reads as the one
   emphasised thing in the line, and underlines on hover as Discord's does. */
.system-subject { color: var(--text-strong); font-weight: 600; }
a.system-subject { text-decoration: none; cursor: pointer; }
a.system-subject:hover { text-decoration: underline; }

/* ---- Attachments and embeds --------------------------------------------- */

.attachments { margin-top: 6px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.attachment-image { max-width: min(550px, 100%); border-radius: 8px; display: block; }
.attachment-file {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--surface);
  border: 1px solid var(--divider);
  border-radius: 8px;
  padding: 10px 12px;
  max-width: 440px;
  font-size: 14px;
}
.attachment-file a { color: var(--link); text-decoration: none; word-break: break-all; }
.attachment-file .size { color: var(--text-muted); font-size: 12px; }
.attachment-note { color: var(--text-muted); font-size: 11px; margin-top: 2px; }

/* Inline players, at the sizes the client gives them. */
.attachment-video { max-width: min(550px, 100%); border-radius: 8px; display: block; background: var(--surface-deep); }
.attachment-audio { width: min(400px, 100%); display: block; }

/* The chip Discord puts under a message a thread hangs off. */
.thread-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--surface);
  border: 1px solid var(--divider);
  border-radius: 8px;
  padding: 8px 12px;
  margin-top: 6px;
  font-size: 14px;
  color: var(--text-muted);
}
.thread-chip svg { flex: none; }
.thread-chip .thread-name { color: var(--text-strong); font-weight: 600; }

/*
 * A posted image or GIF. Discord shows these at their own size with no card, so
 * the transcript does too - a thumbnail in a bordered box reads as an unfurled
 * link rather than as the picture someone sent.
 */
.media { margin-top: 6px; }
.media-embed { max-width: min(400px, 100%); border-radius: 8px; display: block; }

.stickers { margin-top: 6px; }
.sticker { width: 160px; height: 160px; object-fit: contain; }
.sticker-fallback {
  display: inline-block;
  background: var(--surface);
  border: 1px solid var(--divider);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  color: var(--text-muted);
}

.embed {
  display: grid;
  grid-template-columns: auto;
  background: var(--embed-bg);
  border-left: 4px solid var(--accent);
  border-radius: 4px;
  padding: 8px 16px 16px 12px;
  margin-top: 6px;
  max-width: 520px;
  font-size: 14px;
}
.embed .eauthor { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: var(--text-strong); margin-top: 8px; }
.embed .eauthor-icon { width: 24px; height: 24px; border-radius: 50%; flex: none; }
.embed .eauthor a { color: var(--text-strong); text-decoration: none; }
.embed .eauthor a:hover { text-decoration: underline; }
.embed .etitle { font-size: 16px; font-weight: 600; color: var(--text-strong); margin-top: 8px; }
.embed .etitle a { color: var(--link); text-decoration: none; }
.embed .edesc { margin-top: 8px; color: var(--text); }
/* Discord's twelve-column field grid: a full-width field spans all twelve, and
   inline fields take an equal share of the row they sit in. */
.embed .efields { display: grid; grid-template-columns: repeat(12, 1fr); gap: 8px; margin-top: 8px; }
.embed .efield .k { font-weight: 600; color: var(--text-strong); font-size: 14px; }
.embed .efield .v { color: var(--text); font-size: 14px; margin-top: 2px; }
.embed .ethumb { max-width: 80px; border-radius: 4px; margin-top: 8px; }
.embed .eimage { max-width: 100%; border-radius: 4px; margin-top: 12px; }
.embed .efooter { display: flex; align-items: center; gap: 8px; color: var(--text-muted); font-size: 12px; margin-top: 8px; }
.embed .efooter-icon { width: 20px; height: 20px; border-radius: 50%; flex: none; }

/* ---- Message components -------------------------------------------------- */

/*
 * The controls a message carried, in Discord's own colours and with its hover
 * shades. They press like Discord's do; only a link button still goes
 * anywhere, since the interaction behind the rest no longer exists. A disabled
 * control keeps the cursor that says so, because which ones were greyed out is
 * part of the record.
 */
.action-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }

.dbutton {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 3px;
  padding: 2px 16px;
  min-height: 32px;
  font-size: 14px;
  font-weight: 500;
  color: #fff;
  cursor: pointer;
  user-select: none;
  transition: background-color .17s ease;
}
.dbutton-primary { background: #5865f2; }
.dbutton-secondary { background: #4e5058; }
.dbutton-success { background: #248046; }
.dbutton-danger { background: #da373c; }
.dbutton-link, .dbutton-premium { background: #4e5058; }

.dbutton-primary:hover { background: #4752c4; }
.dbutton-secondary:hover, .dbutton-link:hover, .dbutton-premium:hover { background: #6d6f78; }
.dbutton-success:hover { background: #1a6334; }
.dbutton-danger:hover { background: #a12d2f; }

a.dbutton { text-decoration: none; }
.dbutton.disabled { opacity: .5; cursor: not-allowed; }
/* A disabled control did not respond then either. */
.dbutton-primary.disabled:hover { background: #5865f2; }
.dbutton-secondary.disabled:hover, .dbutton-link.disabled:hover { background: #4e5058; }
.dbutton-success.disabled:hover { background: #248046; }
.dbutton-danger.disabled:hover { background: #da373c; }
.dbutton .bemoji { width: 18px; height: 18px; object-fit: contain; }

.dselect {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: var(--surface-deep);
  border: 1px solid var(--divider);
  border-radius: 4px;
  padding: 8px 12px;
  min-width: 240px;
  max-width: 100%;
  font-size: 14px;
  color: var(--text-muted);
  cursor: pointer;
}
.dselect:hover { border-color: var(--text-muted); }
.dselect.disabled { opacity: .5; cursor: not-allowed; }
.dselect.disabled:hover { border-color: var(--divider); }

/*
 * Components V2 layout. A container is the client's replacement for an embed
 * and is drawn like one: the same block, the same leading rule. It keeps its
 * own class because the two are separate things that only happen to look
 * alike, and an embed's rule falls back to the accent where a container with
 * no accent colour shows none.
 */
.dcontainer {
  background: var(--embed-bg);
  border: 1px solid var(--divider);
  border-inline-start: 4px solid var(--divider);
  border-radius: 4px;
  padding: 8px 12px 12px;
  margin-top: 6px;
  max-width: 520px;
  font-size: 14px;
}
/* One rhythm inside the block, whatever the components are. Written against
   :first-child so these outrank the margin each component carries for standing
   on its own at the top level of a message. */
.dcontainer > :first-child { margin-top: 0; }
.dcontainer > :not(:first-child) { margin-top: 8px; }

/* A section is text with its one accessory beside it, which is the only place
   a thumbnail is valid. The accessory keeps its size while the text takes the
   rest of the row. */
.dsection { display: flex; align-items: flex-start; gap: 16px; margin-top: 6px; }
.dsection-text { flex: 1; min-width: 0; }
.dsection-accessory { flex: none; margin-inline-start: auto; }
.dsection-accessory .dthumb { max-width: 88px; border-radius: 8px; display: block; }

/* Discord tiles a gallery rather than stacking it, and lets the tiles reflow
   instead of fixing a column count that a narrow screen cannot hold. */
.dgallery {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 4px;
  margin-top: 6px;
  max-width: 520px;
}
.dgallery img { width: 100%; border-radius: 4px; display: block; object-fit: cover; }

/* Padding, and a rule only when the separator asked for one. */
hr.dseparator { border: 0; border-top: 1px solid transparent; margin: 8px 0; }
hr.dseparator.divided { border-top-color: var(--divider); }
hr.dseparator.dseparator-large { margin: 16px 0; }

.reactions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.reaction {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(255, 255, 255, .05);
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 2px 6px;
  font-size: 13px;
  color: var(--text-muted);
}
.reaction img { width: 16px; height: 16px; }

/* ---- Footer ------------------------------------------------------------- */

.doc-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  border-top: 1px solid var(--divider);
  color: var(--text-muted);
  font-size: 12px;
  padding: 20px 24px 40px;
  text-align: center;
}
/* The same mark as the header, at the size a footer wants. */
.doc-footer .brand-mark { width: 16px; height: 16px; flex: none; }

/* ---- Narrow screens ----------------------------------------------------- */

@media (max-width: 640px) {
  .message { padding: 2px 12px 2px 56px; }
  .message .avatar, .message .avatar-fallback { left: 8px; width: 32px; height: 32px; }
  .message .gutter-time { width: 56px; }
  /* Half of the narrow avatar plus its left offset, so the spine still rises
     from the avatar's centre line. */
  .reply::before { left: -32px; }
  .panel, .notice, .divider-day { margin-left: 12px; margin-right: 12px; }
}

/* ---- Printing / PDF ----------------------------------------------------- */

@media print {
  :root { color-scheme: light; }
  body { background: #fff; color: #111; font-size: 12px; }
  .doc-header { position: static; background: #fff; border-bottom: 2px solid var(--accent); }
  .doc-header .channel, .heading .name, .meta-grid .v { color: #111; }
  .panel, .embed, .attachment-file, .dcontainer { background: #fafafa; border-color: #ddd; }
  hr.dseparator.divided { border-top-color: #ddd; }
  .message:hover { background: transparent; }
  .message .gutter-time { opacity: 1; color: #666; }
  .content, .embed .edesc, .embed .efield .v { color: #111; }
  .spoiler { background: transparent; color: #111; }
  .mention { background: #e8eaff; color: #2b3bbf; }
  code.inline, pre.code-block { background: #f2f2f2; color: #111; border-color: #ddd; }
  pre.code-block code { color: #111; }
}
`.trim();
}
