/**
 * HTML safety primitives for transcript rendering.
 *
 * A transcript reproduces arbitrary message text inside an HTML document that
 * readers open locally. Every single value that originates from Discord goes
 * through one of these functions; there is no code path in the renderer that
 * concatenates raw content into markup.
 */

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
  '=': '&#61;',
};

const HTML_ESCAPE_PATTERN = /[&<>"'`=]/g;

/** Escapes text for use in element content or a quoted attribute value. */
export function escapeHtml(value: string): string {
  return value.replace(HTML_ESCAPE_PATTERN, (character) => HTML_ESCAPES[character] ?? character);
}

/** Escapes and converts newlines to `<br>` for display inside a block. */
export function escapeHtmlMultiline(value: string): string {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, '<br>');
}

/**
 * Hosts Discord serves user content from. Images in a transcript are limited to
 * these so a crafted attachment name or proxy URL cannot make the document
 * fetch from an arbitrary third party when someone opens it.
 */
const ALLOWED_MEDIA_HOSTS = new Set([
  'cdn.discordapp.com',
  'media.discordapp.net',
  'images-ext-1.discordapp.net',
  'images-ext-2.discordapp.net',
]);

/**
 * Validates a URL intended for an `<img src>`. Returns null for anything that
 * is not https on a known Discord CDN host, which also rules out `javascript:`,
 * `data:` and protocol-relative tricks.
 */
export function safeMediaUrl(value: string | null | undefined): string | null {
  const url = parseUrl(value);
  if (!url) return null;
  if (url.protocol !== 'https:') return null;
  if (!ALLOWED_MEDIA_HOSTS.has(url.hostname)) return null;
  return url.toString();
}

/**
 * Validates a URL intended for an `<a href>`. Only http and https are allowed,
 * so no `javascript:`, `vbscript:`, `file:` or `data:` link can be produced.
 */
export function safeLinkUrl(value: string | null | undefined): string | null {
  const url = parseUrl(value);
  if (!url) return null;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return url.toString();
}

function parseUrl(value: string | null | undefined): URL | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Renders a `#rrggbb` colour, or null when the input is not a valid colour. */
export function safeHexColor(value: string | number | null | undefined): string | null {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffff) return null;
    return `#${value.toString(16).padStart(6, '0')}`;
  }
  if (typeof value !== 'string') return null;
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : null;
}

/** Produces a filesystem-safe file name. */
export function safeFileName(value: string, fallback: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned.length > 0 ? cleaned.slice(0, 120) : fallback;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size';
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
