import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  escapeHtmlMultiline,
  formatBytes,
  safeFileName,
  safeHexColor,
  safeLinkUrl,
  safeMediaUrl,
} from '../src/html.js';

describe('HTML escaping', () => {
  it('escapes every character that can break out of markup', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml(`"quoted"`)).toBe('&quot;quoted&quot;');
    expect(escapeHtml("it's")).toBe('it&#39;s');
    expect(escapeHtml('`tick`')).toBe('&#96;tick&#96;');
    expect(escapeHtml('a=b')).toBe('a&#61;b');
  });

  const injections = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '"><script>alert(1)</script>',
    "' onmouseover='alert(1)",
    '<iframe src="javascript:alert(1)"></iframe>',
    '</style><script>alert(1)</script>',
    '<svg/onload=alert(1)>',
    '<a href="javascript:alert(1)">x</a>',
    '<!--<script>alert(1)</script>-->',
    '<body onload=alert(1)>',
    'x=1 onclick=alert(1)',
  ];

  it.each(injections)('neutralises %s', (payload) => {
    const escaped = escapeHtml(payload);
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
    expect(escaped).not.toContain('"');
    expect(escaped).not.toContain("'");
    expect(escaped).not.toContain('=');
  });

  it('escapes before turning newlines into line breaks', () => {
    const result = escapeHtmlMultiline('<b>one</b>\ntwo\r\nthree\rfour');
    expect(result).toBe('&lt;b&gt;one&lt;/b&gt;<br>two<br>three<br>four');
    // The only tag in the output is the one we generated.
    expect(result.match(/<(?!br>)/g)).toBeNull();
  });

  it('never double-unescapes an already escaped entity', () => {
    expect(escapeHtml('&lt;script&gt;')).toBe('&amp;lt;script&amp;gt;');
  });

  it('leaves ordinary text and unicode alone', () => {
    expect(escapeHtml('Hello, world! مرحبا 👋')).toBe('Hello, world! مرحبا 👋');
  });
});

describe('media URL validation', () => {
  it('accepts Discord CDN images over https', () => {
    expect(safeMediaUrl('https://cdn.discordapp.com/avatars/1/a.png')).toBe(
      'https://cdn.discordapp.com/avatars/1/a.png',
    );
    expect(safeMediaUrl('https://media.discordapp.net/attachments/1/2/x.png')).not.toBeNull();
  });

  const rejectedMedia = [
    'http://cdn.discordapp.com/a.png',
    'https://evil.example.com/a.png',
    'https://cdn.discordapp.com.evil.example/a.png',
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '//cdn.discordapp.com/a.png',
    '',
    '   ',
    'not a url',
  ];

  it.each(rejectedMedia)('rejects %s', (value) => {
    expect(safeMediaUrl(value)).toBeNull();
  });

  it('rejects null and undefined', () => {
    expect(safeMediaUrl(null)).toBeNull();
    expect(safeMediaUrl(undefined)).toBeNull();
  });
});

describe('link URL validation', () => {
  it('accepts http and https only', () => {
    expect(safeLinkUrl('https://example.com/x')).toBe('https://example.com/x');
    expect(safeLinkUrl('http://example.com/x')).toBe('http://example.com/x');
  });

  const rejectedLinks = [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'about:blank',
    'chrome://settings',
  ];

  it.each(rejectedLinks)('rejects %s', (value) => {
    expect(safeLinkUrl(value)).toBeNull();
  });
});

describe('colour validation', () => {
  it('accepts numeric and hex colours', () => {
    expect(safeHexColor(0x5b6ef5)).toBe('#5b6ef5');
    expect(safeHexColor(0)).toBe('#000000');
    expect(safeHexColor('#AABBCC')).toBe('#aabbcc');
  });

  it('rejects anything that could escape a style attribute', () => {
    expect(safeHexColor('red; background: url(javascript:alert(1))')).toBeNull();
    expect(safeHexColor('#fff')).toBeNull();
    expect(safeHexColor('#gggggg')).toBeNull();
    expect(safeHexColor(-1)).toBeNull();
    expect(safeHexColor(0x1000000)).toBeNull();
    expect(safeHexColor(1.5)).toBeNull();
    expect(safeHexColor(null)).toBeNull();
    expect(safeHexColor(undefined)).toBeNull();
  });
});

describe('filenames and sizes', () => {
  it('strips path traversal and unsafe characters', () => {
    expect(safeFileName('../../etc/passwd', 'fallback')).toBe(
      '.._.._etc_passwd'.replace(/^\.+/, ''),
    );
    expect(safeFileName('report 2026.html', 'fallback')).toBe('report_2026.html');
    expect(safeFileName('', 'fallback')).toBe('fallback');
    expect(safeFileName('...', 'fallback')).toBe('fallback');
  });

  it('formats sizes for humans', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(-1)).toBe('unknown size');
    expect(formatBytes(Number.NaN)).toBe('unknown size');
  });
});
