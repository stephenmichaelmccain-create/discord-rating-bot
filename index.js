import { Client, GatewayIntentBits, Partials } from "discord.js";

// ----- ENVIRONMENT CONFIG -----
const {
  DISCORD_TOKEN,
  GUILD_ID,
  SOURCE_CHANNEL_ID,
  N8N_SOURCE_WEBHOOK_URL,
} = process.env;

if (!DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN is not set. Please add it as an environment variable.");
  process.exit(1);
}

if (!N8N_SOURCE_WEBHOOK_URL) {
  console.error("❌ N8N_SOURCE_WEBHOOK_URL is not set. Please add it as an environment variable.");
  process.exit(1);
}

// ----- CLIENT -----
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers, // only needed because we send member/roles info
  ],
  partials: [Partials.Message, Partials.Channel, Partials.User, Partials.GuildMember],
});

// Utility: build a Discord message URL
function buildMessageUrl(message) {
  const guildId = message.guild?.id ?? GUILD_ID ?? "@me";
  return `https://discord.com/channels/${guildId}/${message.channelId}/${message.id}`;
}

// Utility: debug logger
function logDebug(label, obj) {
  console.log(label, JSON.stringify(obj, null, 2));
}

// Utility: POST JSON helper
async function postJSON(url, body) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`❌ Webhook POST failed (${res.status} ${res.statusText}):`, text);
    }
  } catch (err) {
    console.error("❌ Error posting to webhook:", err);
  }
}

// ----- READY -----
client.once("ready", (c) => {
  console.log(`✅ Bot logged in as ${c.user.tag}`);
  if (GUILD_ID) console.log(`🔗 Restricted to guild: ${GUILD_ID}`);
  if (SOURCE_CHANNEL_ID) console.log(`📥 Source channel: ${SOURCE_CHANNEL_ID}`);
});

// ----- MESSAGE HANDLER (SOURCE → N8N_SOURCE_WEBHOOK_URL) -----
client.on("messageCreate", async (message) => {
  try {
    // ✅ includes BOTH humans and bots (no bot filter)

    // Filter by guild if GUILD_ID is set
    if (GUILD_ID && message.guildId && message.guildId !== GUILD_ID) return;

    // Filter by specific channel if provided
    if (SOURCE_CHANNEL_ID && message.channelId !== SOURCE_CHANNEL_ID) return;

    const payload = {
      type: "source_message",
      messageId: message.id,
      channelId: message.channelId,
      guildId: message.guildId ?? null,
      url: buildMessageUrl(message),
      author: {
        id: message.author.id,
        username: message.author.username,
        discriminator: message.author.discriminator,
        tag: message.author.tag,
        bot: message.author.bot,
      },
      member: message.member
        ? {
            nickname: message.member.nickname,
            displayName: message.member.displayName,
            roles: message.member.roles.cache.map((r) => ({ id: r.id, name: r.name })),
          }
        : null,
      content: message.content,
      attachments: message.attachments.map((a) => ({
        id: a.id,
        name: a.name,
        contentType: a.contentType,
        size: a.size,
        url: a.url,
        proxyUrl: a.proxyURL,
      })),
      embeds: message.embeds.map((e) => e.toJSON()),
      createdTimestamp: message.createdTimestamp,
    };

    logDebug("📨 Forwarding message → n8n", { id: message.id, bot: message.author.bot });
    await postJSON(N8N_SOURCE_WEBHOOK_URL, payload);
  } catch (err) {
    console.error("❌ Error in messageCreate handler:", err);
  }
});

// ----- LOGIN -----
client
  .login(DISCORD_TOKEN)
  .catch((err) => {
    console.error("❌ Login failed:", err);
    process.exit(1);
  });

