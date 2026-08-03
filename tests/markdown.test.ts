import { describe, expect, it } from 'vitest';
import {
  EMPTY_MENTIONS,
  renderMarkdown,
  type MentionIndex,
} from '../src/markdown.js';

const MENTIONS: MentionIndex = {
  users: { '300000000000000001': '7sO', '300000000000000002': 'Eissa' },
  roles: {
    '200000000000000001': { name: 'Support Team', color: '#9146ff' },
    '200000000000000002': { name: 'Muted', color: null },
  },
  channels: { '400000000000000001': 'general', '400000000000000002': 'ticket-1042' },
};

const render = (content: string, mentions: MentionIndex = MENTIONS): string =>
  renderMarkdown(content, mentions);

describe('text formatting', () => {
  it('renders the formatting Discord supports', () => {
    expect(render('**bold**')).toContain('<strong>bold</strong>');
    expect(render('*italic*')).toContain('<em>italic</em>');
    expect(render('_italic_')).toContain('<em>italic</em>');
    expect(render('__underline__')).toContain('<u>underline</u>');
    expect(render('~~strike~~')).toContain('<s>strike</s>');
    expect(render('***both***')).toContain('<strong><em>both</em></strong>');
    expect(render('||secret||')).toContain('<span class="spoiler">secret</span>');
  });

  it('nests formatting', () => {
    const html = render('**bold with *italic* inside**');
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('leaves underscores inside identifiers alone', () => {
    const html = render('call read_file_sync now');
    expect(html).not.toContain('<em>');
    expect(html).toContain('read_file_sync');
  });

  it('honours backslash escapes', () => {
    const html = render(String.raw`\*not italic\*`);
    expect(html).not.toContain('<em>');
    expect(html).toContain('*not italic*');
  });

  it('renders inline code without formatting its contents', () => {
    const html = render('use `**not bold**` here');
    expect(html).toContain('<code class="inline">**not bold**</code>');
    expect(html).not.toContain('<strong>');
  });

  it('renders fenced code blocks verbatim', () => {
    const html = render('```ts\nconst x = **1**;\n```');
    expect(html).toContain('<pre class="code-block" data-language="ts">');
    // `=` is HTML-escaped like every other text leaf; a browser renders it back
    // to `=`, so the code reads exactly as it was written.
    expect(html).toContain('const x &#61; **1**;');
    expect(html).not.toContain('<strong>');
  });

  it('renders a fence with no language', () => {
    expect(render('```\nplain\n```')).toContain('<pre class="code-block"><code>plain</code></pre>');
  });

  it('keeps text around a code block', () => {
    const html = render('before\n```\ncode\n```\nafter');
    expect(html).toContain('before');
    expect(html).toContain('code');
    expect(html).toContain('after');
  });
});

describe('block structure', () => {
  it('renders headings', () => {
    expect(render('# Title')).toContain('<div class="md-heading h1">Title</div>');
    expect(render('## Sub')).toContain('<div class="md-heading h2">Sub</div>');
    expect(render('### Small')).toContain('<div class="md-heading h3">Small</div>');
  });

  it('renders block quotes, merging consecutive lines', () => {
    const html = render('> first\n> second');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('first<br>second');
    expect((html.match(/<blockquote>/g) ?? []).length).toBe(1);
  });

  it('renders a triple-arrow quote as one block to the end', () => {
    const html = render('>>> everything\nafter too');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('after too');
  });

  it('renders bullet and numbered lists', () => {
    expect(render('- one\n- two')).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(render('1. one\n2. two')).toContain('<ol><li>one</li><li>two</li></ol>');
  });

  it('preserves single line breaks inside a paragraph', () => {
    expect(render('line one\nline two')).toContain('line one<br>line two');
  });

  it('renders empty content as nothing', () => {
    expect(render('')).toBe('');
    expect(render('   \n  ')).toBe('');
  });
});

describe('mentions', () => {
  it('resolves user mentions to display names', () => {
    expect(render('hey <@300000000000000001>')).toContain('<span class="mention">@7sO</span>');
    expect(render('hey <@!300000000000000002>')).toContain('<span class="mention">@Eissa</span>');
  });

  it('resolves role mentions and applies the role colour', () => {
    const html = render('<@&200000000000000001>');
    expect(html).toContain('@Support Team');
    // Discord tints both the text and the pill behind it with the role colour,
    // rather than leaving the default blurple background under coloured text.
    expect(html).toContain('style="color:#9146ff;background-color:rgba(145, 70, 255, 0.1)"');
  });

  it('renders an uncoloured role without a style attribute', () => {
    const html = render('<@&200000000000000002>');
    expect(html).toContain('@Muted');
    expect(html).not.toContain('style="color:');
  });

  it('resolves channel mentions', () => {
    expect(render('see <#400000000000000001>')).toContain('<span class="mention">#general</span>');
  });

  it('renders @everyone and @here as mentions', () => {
    expect(render('@everyone')).toContain('<span class="mention">@everyone</span>');
    expect(render('@here')).toContain('<span class="mention">@here</span>');
  });

  it('renders slash command mentions', () => {
    expect(render('</ticket close:123456789012345678>')).toContain(
      '<span class="mention">/ticket close</span>',
    );
  });

  it('falls back to the ID when a mention cannot be resolved', () => {
    const html = render('<@999999999999999999>', EMPTY_MENTIONS);
    expect(html).toContain('@999999999999999999');
    // The raw markup must never survive into the document.
    expect(html).not.toContain('<@999999999999999999>');
    expect(html).not.toContain('&lt;@999999999999999999&gt;');
  });

  it('renders mentions inside formatting', () => {
    const html = render('**ping <@300000000000000001>**');
    expect(html).toContain('<strong>');
    expect(html).toContain('@7sO');
  });
});

describe('emoji, timestamps and links', () => {
  it('renders custom emoji as CDN images', () => {
    const html = render('<:castcord:123456789012345678>');
    expect(html).toContain('https://cdn.discordapp.com/emojis/123456789012345678.png');
    expect(html).toContain('alt=":castcord:"');
  });

  it('renders animated emoji as gifs', () => {
    expect(render('<a:wave:123456789012345678>')).toContain(
      'https://cdn.discordapp.com/emojis/123456789012345678.gif',
    );
  });

  it('renders unicode emoji untouched', () => {
    expect(render('nice 👋')).toContain('👋');
  });

  it('renders Discord timestamps', () => {
    const html = render('<t:1772000000:F>');
    expect(html).toContain('timestamp-chip');
    expect(html).toContain('2026');
  });

  it('supports every timestamp style', () => {
    for (const style of ['t', 'T', 'd', 'D', 'f', 'F', 'R']) {
      expect(render(`<t:1772000000:${style}>`)).toContain('timestamp-chip');
    }
    expect(render('<t:1772000000>')).toContain('timestamp-chip');
  });

  it('linkifies bare URLs', () => {
    const html = render('see https://castcord.example/docs for more');
    expect(html).toContain('href="https://castcord.example/docs"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  it('keeps trailing sentence punctuation out of a bare URL', () => {
    const html = render('read https://example.com/a.');
    expect(html).toContain('href="https://example.com/a"');
  });

  it('renders masked links', () => {
    const html = render('[the docs](https://example.com/docs)');
    expect(html).toContain('>the docs</a>');
    expect(html).toContain('href="https://example.com/docs"');
  });
});

describe('security', () => {
  /**
   * The meaningful property is not "this word is absent" - escaped text may
   * legitimately read `onerror` - but "every tag in the output was emitted by
   * the renderer". This parses the tags back out and checks exactly that.
   */
  const ALLOWED_TAGS = new Set([
    'p',
    'br',
    'strong',
    'em',
    'u',
    's',
    'span',
    'code',
    'pre',
    'blockquote',
    'ul',
    'ol',
    'li',
    'div',
    'a',
    'img',
  ]);

  function assertOnlyRendererMarkup(html: string): void {
    for (const [, closing, name, attributes] of html.matchAll(
      /<(\/?)([a-zA-Z][\w-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>/g,
    )) {
      expect(ALLOWED_TAGS.has((name ?? '').toLowerCase())).toBe(true);
      if (closing === '/') continue;

      const attrs = attributes ?? '';
      // No event handler can survive, in any casing or spacing.
      expect(attrs).not.toMatch(/\bon[a-z]+\s*=/i);
      // Every URL-bearing attribute is https and quoted.
      for (const [, url] of attrs.matchAll(/(?:href|src)="([^"]*)"/g)) {
        expect(url).toMatch(/^https?:\/\//);
      }
    }
  }

  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '"><script>alert(1)</script>',
    "'><svg/onload=alert(1)>",
    '</style><script>alert(1)</script>',
    '<a href="javascript:alert(1)">x</a>',
    '<body onload=alert(1)>',
    '<style>*{display:none}</style>',
    '<!--<script>alert(1)</script>-->',
    '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  ];

  it.each(payloads)('emits no attacker-controlled markup for %s', (payload) => {
    const html = render(payload);

    // Nothing the attacker wrote became a tag.
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<iframe/i);
    expect(html).not.toMatch(/<svg/i);
    expect(html).not.toMatch(/<style/i);
    expect(html).toContain('&lt;');
    assertOnlyRendererMarkup(html);
  });

  it('emits only renderer markup for every construct combined', () => {
    const html = render(
      [
        '# <script>x</script>',
        '> **<img src=x onerror=1>**',
        '- [a](javascript:alert(1))',
        '`<b>`',
        '```<script>```',
        '||<svg onload=1>||',
        '<@300000000000000001> <@&200000000000000001> <#400000000000000001>',
        '<:e:123456789012345678> <t:1772000000:F> https://example.com',
      ].join('\n'),
    );

    assertOnlyRendererMarkup(html);
  });

  it('escapes hostile content inside every formatting construct', () => {
    const payload = '<script>alert(1)</script>';
    const wrapped = [
      `**${payload}**`,
      `*${payload}*`,
      `~~${payload}~~`,
      `||${payload}||`,
      `> ${payload}`,
      `# ${payload}`,
      `- ${payload}`,
      `\`${payload}\``,
      '```\n' + payload + '\n```',
      `[${payload}](https://example.com)`,
    ];

    for (const content of wrapped) {
      const html = render(content);
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    }
  });

  it('never produces a link to a non-http scheme', () => {
    const hostile = [
      '[click me](javascript:alert(1))',
      '[click me](javascript:alert1)',
      '[x](data:text/html,abc)',
      '[x](file:///etc/passwd)',
      'go javascript:alert(1)',
      'go data:text/html,abc',
      'go file:///etc/passwd',
    ];

    for (const content of hostile) {
      const html = render(content);
      // The scheme may remain as inert visible text; what must never exist is
      // an anchor pointing at it.
      expect(html).not.toMatch(/href="(?!https?:\/\/)/);
      assertOnlyRendererMarkup(html);
    }
  });

  it('renders the label as plain text when a masked link target is unusable', () => {
    const html = render('[click me](javascript:alert1)');
    expect(html).toContain('click me');
    expect(html).not.toContain('<a ');
  });

  it('cannot inject an attribute through a resolved mention name', () => {
    const hostile: MentionIndex = {
      users: { '300000000000000001': '" onmouseover="alert(1)' },
      roles: { '200000000000000001': { name: '<img src=x>', color: 'red;background:url(x)' } },
      channels: { '400000000000000001': '"><script>alert(1)</script>' },
    };

    const html = renderMarkdown(
      '<@300000000000000001> <@&200000000000000001> <#400000000000000001>',
      hostile,
    );

    // The names are shown, but only ever as escaped text.
    expect(html).toContain('&quot;');
    expect(html).not.toMatch(/<script/i);
    // A hostile role colour is rejected by safeHexColor before it reaches style.
    expect(html).not.toContain('background:url');
    expect(html).not.toContain('style="color:red');
    assertOnlyRendererMarkup(html);
  });

  it('cannot inject through a code block language tag', () => {
    const html = render('```"><script>alert(1)</script>\nx\n```');
    expect(html).not.toContain('<script');
  });

  it('survives pathological nesting without hanging or overflowing', () => {
    const deep = '*'.repeat(200) + 'text' + '*'.repeat(200);
    const start = Date.now();
    const html = render(deep);
    expect(Date.now() - start).toBeLessThan(2000);
    expect(html).not.toContain('<script');
  });

  it('handles very long content in reasonable time', () => {
    const long = 'word **bold** <@300000000000000001> https://example.com\n'.repeat(2000);
    const start = Date.now();
    render(long);
    expect(Date.now() - start).toBeLessThan(5000);
  });

  it('never leaves an unbalanced tag that could swallow the document', () => {
    for (const content of ['**unclosed', '||unclosed', '`unclosed', '```unclosed', '[x](']) {
      const html = render(content);
      const open = (html.match(/<(strong|em|s|u|span|code|pre|blockquote)\b/g) ?? []).length;
      const close = (html.match(/<\/(strong|em|s|u|span|code|pre|blockquote)>/g) ?? []).length;
      expect(open).toBe(close);
    }
  });
});

describe('timestamp overflow', () => {
  it('degrades an out-of-range <t:...> instead of throwing', () => {
    // Date's range is ±8.64e15 ms; these seconds overflow it. One absurd token
    // typed by one member must not abort the whole transcript.
    expect(() => render('<t:99999999999999>')).not.toThrow();
    expect(() => render('<t:-9999999999999:F>')).not.toThrow();
    expect(render('see you <t:99999999999999:F>')).toContain('timestamp-chip');
  });
});

describe('subtext', () => {
  it('renders -# at the start of a line as subtext', () => {
    expect(render('-# small print')).toContain('<div class="md-subtext">small print</div>');
  });

  it('renders inline formatting inside subtext', () => {
    expect(render('-# small **bold** print')).toContain('<strong>bold</strong>');
  });

  it('leaves -# alone in the middle of a line', () => {
    const html = render('this is not -# subtext');
    expect(html).not.toContain('md-subtext');
    expect(html).toContain('this is not -# subtext');
  });

  it('separates subtext from the paragraph above it', () => {
    const html = render('a real line' + String.fromCharCode(10) + '-# the small print');
    expect(html).toContain('<p>a real line</p>');
    expect(html).toContain('<div class="md-subtext">the small print</div>');
  });
});

describe('underline italics with three underscores', () => {
  it('renders ___text___ as underlined italics', () => {
    expect(render('___both___')).toContain('<u><em>both</em></u>');
  });
});

describe('nested lists', () => {
  it('nests an indented item under its parent', () => {
    expect(render('- parent' + String.fromCharCode(10) + ' - child')).toContain(
      '<ul><li>parent<ul><li>child</li></ul></li></ul>',
    );
  });

  it('returns to the outer level after a nested run', () => {
    const html = render(['- a', ' - b', '- c'].join(String.fromCharCode(10)));
    expect(html).toContain('<li>a<ul><li>b</li></ul></li><li>c</li>');
  });

  it('keeps an ordered outer list ordered around a bulleted sublist', () => {
    const html = render(['1. one', ' - sub', '2. two'].join(String.fromCharCode(10)));
    expect(html).toContain('<ol><li>one<ul><li>sub</li></ul></li><li>two</li></ol>');
  });
});
