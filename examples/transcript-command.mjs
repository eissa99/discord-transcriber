/**
 * A minimal bot with a /transcript command. Set DISCORD_TOKEN and register the
 * command yourself (or copy this handler into a bot you already run).
 */
import { Client, GatewayIntentBits, MessageFlags } from 'discord.js';
import { createTranscript } from 'discord-transcriber';

// MessageContent is privileged but non-negotiable here: without it (declared
// AND enabled on the Bot page of the Developer Portal) Discord redacts
// content, embeds, attachments and components from message history, and every
// human message in the transcript would come back empty.
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent],
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'transcript') return;
  if (!interaction.channel?.isTextBased() || !interaction.inGuild()) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const transcript = await createTranscript(interaction.channel, {
    limit: 2000,
    brand: { name: 'My Server' },
  });

  // One message per file: Discord's upload limit applies to the whole request,
  // so batching several near-limit files into one message would fail.
  const [first, ...rest] = transcript.files;
  await interaction.editReply({
    content: `Transcript of ${transcript.messageCount} messages${transcript.truncated ? ' (truncated)' : ''}.`,
    files: [first],
  });
  for (const file of rest) {
    await interaction.followUp({
      files: [file],
      flags: MessageFlags.Ephemeral,
    });
  }
});

await client.login(process.env.DISCORD_TOKEN);
