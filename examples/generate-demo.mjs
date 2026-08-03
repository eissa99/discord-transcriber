/**
 * Renders a sample conversation to `examples/demo.html` using the pure
 * rendering layer — no Discord connection, no token. Run `npm run build`
 * first, then `npm run demo`, then open the file in a browser.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTranscript } from '../dist/index.js';

const _7sO = {
  id: '300000000000000001',
  displayName: '7sO',
  username: '7so',
  avatarUrl: null,
  bot: false,
  color: '#00b0f4',
};

const eissa = {
  id: '300000000000000002',
  displayName: 'Eissa',
  username: 'eissa',
  avatarUrl: null,
  bot: false,
  color: '#f0a52a',
};

const helper = {
  id: '300000000000000003',
  displayName: 'CastCord',
  username: 'castcord',
  avatarUrl: null,
  bot: true,
  color: '#9146ff',
};

const base = {
  editedAt: null,
  attachments: [],
  embeds: [],
  stickers: [],
  actionRows: [],
  reference: null,
  forwarded: null,
  thread: null,
  reactions: [],
  system: false,
  systemAction: null,
  pinned: false,
  groupedWithPrevious: false,
};

const at = (minutes) => new Date(Date.UTC(2026, 6, 30, 14, minutes));

const messages = [
  {
    ...base,
    id: '900000000000000001',
    author: helper,
    createdAt: at(0),
    // A Components V2 message, as the CastCord bot actually sends: no content,
    // everything in the layout tree.
    content: '',
    componentsV2: true,
    components: [
      {
        kind: 'container',
        color: '#9146ff',
        components: [
          {
            kind: 'textDisplay',
            content:
              '## Welcome to #support\nDescribe your problem and someone will help you shortly.',
          },
          { kind: 'separator', divider: true, spacing: 'small' },
          {
            kind: 'textDisplay',
            content: '> Please include your **operating system** and `app version`.',
          },
          {
            kind: 'actionRow',
            components: [
              { kind: 'button', label: 'Close', style: 'danger', disabled: false, url: null, emoji: null },
              { kind: 'button', label: 'Claim', style: 'primary', disabled: false, url: null, emoji: null },
              {
                kind: 'button',
                label: 'Docs',
                style: 'link',
                disabled: false,
                url: 'https://example.com/docs',
                emoji: null,
              },
            ],
          },
        ],
      },
    ],
    pinned: true,
  },
  {
    ...base,
    id: '900000000000000002',
    author: helper,
    createdAt: at(0),
    content: '',
    system: true,
    systemAction: 'pinned',
    reference: {
      messageId: '900000000000000001',
      authorName: 'CastCord',
      excerpt: 'Welcome to #support',
      resolved: true,
      authorColor: '#9146ff',
      authorAvatarUrl: null,
      authorBot: true,
      hasMedia: false,
    },
  },
  {
    ...base,
    id: '900000000000000003',
    author: _7sO,
    createdAt: at(2),
    content:
      "Hey! The app **keeps disconnecting** every few minutes on Windows 11.\nI'm on version `4.2.1` — logs attached.",
    attachments: [
      {
        id: '1',
        name: 'connection-logs.txt',
        url: 'https://cdn.discordapp.com/attachments/1/2/connection-logs.txt',
        size: 48213,
        contentType: 'text/plain',
        isImage: false,
      },
    ],
  },
  {
    ...base,
    id: '900000000000000004',
    author: _7sO,
    createdAt: at(3),
    content: 'It happens on wifi *and* ethernet, so ~~my router~~ probably not the network.',
    groupedWithPrevious: true,
    reactions: [{ name: '👀', id: null, animated: false, count: 2 }],
    thread: {
      name: 'connection-debug',
      messageCount: 5,
      lastMessage: {
        authorName: 'Eissa',
        authorAvatarUrl: null,
        authorColor: '#f0a52a',
        content: 'works after the update 🎉',
        createdAt: at(20),
      },
    },
  },
  {
    ...base,
    id: '900000000000000005',
    author: eissa,
    createdAt: at(9),
    content:
      'Thanks <@300000000000000001>! That build had a heartbeat bug — ||fixed in 4.2.2||.\nTry updating and tell me if it still drops.',
    reference: {
      messageId: '900000000000000003',
      authorName: '7sO',
      excerpt: 'Hey! The app keeps disconnecting every few minutes on Windows 11.',
      resolved: true,
      authorColor: '#00b0f4',
      authorAvatarUrl: null,
      authorBot: false,
      hasMedia: true,
    },
  },
  {
    ...base,
    id: '900000000000000006',
    author: eissa,
    createdAt: at(10),
    content: 'Release notes:',
    embeds: [
      {
        kind: 'rich',
        title: 'Version 4.2.2',
        description: 'Fixes the reconnect loop reported by **several users**.',
        url: 'https://example.com/releases/4.2.2',
        color: '#3ba55d',
        authorName: 'Release team',
        footerText: 'Released July 30, 2026',
        imageUrl: null,
        thumbnailUrl: null,
        imageProxyUrl: null,
        thumbnailProxyUrl: null,
        timestamp: null,
        fields: [
          { name: 'Platform', value: 'Windows', inline: true },
          { name: 'Severity', value: 'High', inline: true },
          { name: 'Status', value: 'Fixed', inline: true },
        ],
      },
    ],
    groupedWithPrevious: true,
  },
  {
    ...base,
    id: '900000000000000007',
    author: _7sO,
    createdAt: at(21),
    content: 'That fixed it — thank you so much! 🎉',
    editedAt: at(22),
    reactions: [
      { name: '❤️', id: null, animated: false, count: 1 },
      { name: '🙌', id: null, animated: false, count: 3 },
    ],
  },
  {
    ...base,
    id: '900000000000000009',
    author: _7sO,
    createdAt: at(23),
    // A forwarded message: the material lives in the snapshot, not in content.
    content: '',
    forwarded: {
      content: `To open a ticket press the button 🎫
Welcome to **CastCord** Support!`,
      attachments: [],
      embeds: [],
      stickers: [],
      components: [
        {
          kind: 'actionRow',
          components: [
            { kind: 'button', label: 'Open Ticket', style: 'primary', disabled: false, url: null, emoji: null },
          ],
        },
      ],
      originChannelName: '「🌐」welcome',
      originTimestamp: new Date(Date.UTC(2026, 6, 24, 5, 4)),
    },
  },
  {
    ...base,
    id: '900000000000000008',
    author: helper,
    createdAt: at(25),
    content: 'Ticket closed by **Eissa**. A transcript of this channel has been saved.',
    // The row Discord shows above a slash-command reply: "Eissa used /close".
    interaction: { commandName: 'close', userName: 'Eissa', userAvatarUrl: null },
  },
];

const mentions = {
  users: { '300000000000000001': '7sO', '300000000000000002': 'Eissa' },
  roles: {},
  channels: {},
};

const parts = renderTranscript(
  {
    guildName: 'CastCord',
    channelName: 'support',
    messages,
    truncated: false,
    generatedAt: at(30),
    mentions,
  },
  {
    filename: 'demo',
    brand: {
      name: 'CastCord Support',
      accentColor: '#9146ff',
      footerText: 'Generated by Eissa (eissa)',
    },
    metadata: [
      { label: 'Category', value: 'Technical Support', icon: 'tag' },
      { label: 'Opened by', value: '7sO (7so)', icon: 'person' },
      { label: 'Handled by', value: 'Eissa (eissa)', icon: 'shield' },
      { label: 'Messages', value: '9', icon: 'chat' },
      { label: 'Resolution', value: 'Fixed by updating to version 4.2.2.', icon: 'note', wide: true },
    ],
  },
);

const target = join(dirname(fileURLToPath(import.meta.url)), 'demo.html');
writeFileSync(target, parts[0].content);
console.log(`Wrote ${target} (${parts[0].content.byteLength} bytes)`);
