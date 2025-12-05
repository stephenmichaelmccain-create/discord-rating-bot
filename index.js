import { Client, GatewayIntentBits, Partials } from "discord.js";

// ----- ENVIRONMENT CONFIG -----
const {
  DISCORD_TOKEN,
  GUILD_ID,
  SOURCE_CHANNEL_ID,
  PROCESSED_CHANNEL_ID,
  N8N_SOURCE_WEBHOOK_URL,
  N8N_RATING_WEBHOOK_URL,
} = process.env;

if (!DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN is not set. Please add it as an environment variable.");
  process.exit(1);
}

// ----- CLIENT -----
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember],
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
  if (!url) {
    console.warn("⚠️ Tried to POST to empty url. Skipping.");
    return;
  }

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
  if (PROCESSED_CHANNEL_ID) console.log(`📤 Rating channel: ${PROCESSED_CHANNEL_ID}`);
});

// ----- MESSAGE HANDLER (SOURCE → N8N_SOURCE_WEBHOOK_URL) -----
client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;

    // Filter by guild if GUILD_ID is set
    if (GUILD_ID && message.guildId && message.guildId !== GUILD_ID) return;

    // Filter by specific channel if provided
    if (SOURCE_CHANNEL_ID && message.channelId !== SOURCE_CHANNEL_ID) return;

    if (!N8N_SOURCE_WEBHOOK_URL) {
      console.warn("⚠️ N8N_SOURCE_WEBHOOK_URL not set, skipping source message forwarding.");
      return;
    }

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

    logDebug("📨 Forwarding source message → n8n", { id: message.id });
    await postJSON(N8N_SOURCE_WEBHOOK_URL, payload);
  } catch (err) {
    console.error("❌ Error in messageCreate handler:", err);
  }
});

// ----- REACTION HANDLER (RATINGS → N8N_RATING_WEBHOOK_URL) -----
const ratingEmojiMap = {
  "1️⃣": 1,
  "2️⃣": 2,
  "3️⃣": 3,
  "4️⃣": 4,
  // optional plain numbers
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
};

client.on("messageReactionAdd", async (reaction, user) => {
  try {
    if (user.bot) return;

    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch (err) {
        console.error("❌ Failed to fetch partial reaction:", err);
        return;
      }
    }

    const message = reaction.message;

    // Filter by guild and processed channel
    if (GUILD_ID && message.guildId && message.guildId !== GUILD_ID) return;
    if (PROCESSED_CHANNEL_ID && message.channelId !== PROCESSED_CHANNEL_ID) return;

    const emojiKey = reaction.emoji.name;
    const rating = ratingEmojiMap[emojiKey];
    if (!rating) return; // ignore non-rating reactions

    if (!N8N_RATING_WEBHOOK_URL) {
      console.warn("⚠️ N8N_RATING_WEBHOOK_URL not set, skipping rating forwarding.");
      return;
    }

    const payload = {
      type: "rating",
      messageId: message.id,
      channelId: message.channelId,
      guildId: message.guildId ?? null,
      url: buildMessageUrl(message),
      rater: {
        id: user.id,
        username: user.username,
        discriminator: user.discriminator,
        tag: `${user.username}#${user.discriminator}`,
      },
      rating,
      emoji: emojiKey,
      originalAuthor: message.author
        ? {
            id: message.author.id,
            username: message.author.username,
            discriminator: message.author.discriminator,
            tag: message.author.tag,
          }
        : null,
      originalContent: message.content,
      createdTimestamp: Date.now(),
    };

    logDebug("⭐ Forwarding rating → n8n", {
      rating,
      messageId: message.id,
      userId: user.id,
    });
    await postJSON(N8N_RATING_WEBHOOK_URL, payload);
  } catch (err) {
    console.error("❌ Error in messageReactionAdd handler:", err);
  }
});

// ----- LOGIN -----
client
  .login(DISCORD_TOKEN)
  .catch((err) => {
    console.error("❌ Login failed:", err);
    process.exit(1);
  });
