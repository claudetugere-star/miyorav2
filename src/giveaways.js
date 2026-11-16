const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder,
  MessageFlags, PermissionFlagsBits,
} = require('discord.js');
const { randomInt } = require('crypto');
const db = require('./db');
const parseDuration = require('./duration');

const E = MessageFlags.Ephemeral;
const MAX_TIMEOUT = 2_147_000_000;
const timers = new Map();

function embedFor(giveaway) {
  const endsAt = Math.floor(giveaway.endsAt / 1000);
  const embed = new EmbedBuilder()
    .setColor(giveaway.ended ? 0x747f8d : 0xf1c40f)
    .setTitle(giveaway.ended ? '🎉 Giveaway terminé' : '🎉 Giveaway')
    .setDescription(
      `**Lot :** ${giveaway.prize}\n` +
      `**Organisé par :** <@${giveaway.hostId}>\n` +
      `**Fin :** <t:${endsAt}:R> (<t:${endsAt}:f>)\n` +
      `**Gagnants :** ${giveaway.winnerCount}`,
    )
    .addFields({ name: 'Participants', value: String(giveaway.entrants.length), inline: true });

  if (giveaway.ended) {
    embed.addFields({
      name: 'Résultat',
      value: giveaway.winners.length
        ? giveaway.winners.map((id) => `<@${id}>`).join('\n')
        : 'Aucun participant : aucun gagnant.',
    });
  }
  return embed;
}

function schedule(client, guild, giveaway, retryDelay) {
  const key = `${guild.id}:${giveaway.messageId}`;
  clearTimeout(timers.get(key));
  const delay = retryDelay ?? Math.max(0, Math.min(giveaway.endsAt - Date.now(), MAX_TIMEOUT));
  const timer = setTimeout(() => {
    timers.delete(key);
    if (giveaway.ended) return;
    if (giveaway.endsAt > Date.now()) return schedule(client, guild, giveaway);
    finish(guild, giveaway).catch((error) => {
      console.error(`Impossible de terminer le giveaway ${giveaway.messageId} :`, error);
      schedule(client, guild, giveaway, 60_000);
    });
  }, delay);
  if (timer.unref) timer.unref();
  timers.set(key, timer);
}

async function finish(guild, giveaway) {
  if (giveaway.ended) return;
  if (!giveaway.endedAt) {
    giveaway.endedAt = Date.now();
    const pool = [...new Set(giveaway.entrants)];
    giveaway.winners = [];
    while (pool.length && giveaway.winners.length < giveaway.winnerCount) {
      giveaway.winners.push(pool.splice(randomInt(pool.length), 1)[0]);
    }
    db.save();
  }

  const channel = guild.channels.cache.get(giveaway.channelId) ||
    await guild.channels.fetch(giveaway.channelId).catch(() => null);
  if (!channel) {
    console.error(`Salon introuvable pour le giveaway ${giveaway.messageId}.`);
    giveaway.ended = true;
    db.save();
    return;
  }
  const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
  if (!message) {
    console.error(`Message introuvable pour le giveaway ${giveaway.messageId}.`);
    giveaway.ended = true;
    db.save();
    return;
  }
  const content = giveaway.winners.length
    ? `🎉 Félicitations ${giveaway.winners.map((id) => `<@${id}>`).join(', ')} !`
    : '🎉 Giveaway terminé : aucun participant.';
  giveaway.ended = true;
  try {
    await message.edit({
      content,
      embeds: [embedFor(giveaway)],
      components: [],
      allowedMentions: { parse: [], users: giveaway.winners },
    });
  } catch (error) {
    giveaway.ended = false;
    db.save();
    throw error;
  }
  db.save();
  console.log(`Giveaway ${giveaway.messageId} terminé sur ${guild.id}.`);
}

async function create(i) {
  const prize = i.options.getString('lot').trim();
  const durationText = i.options.getString('duree');
  const duration = parseDuration(durationText);
  const winnerCount = i.options.getInteger('gagnants');
  if (!prize) return i.reply({ content: '⚠️ Le lot ne peut pas être vide.', flags: E });
  if (!duration) {
    return i.reply({ content: '⚠️ Durée invalide. Exemples : `30s`, `10m`, `2h`, `1d` (maximum 28 jours).', flags: E });
  }

  const channel = i.options.getChannel('salon') || i.channel;
  const allowedTypes = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
  if (!channel || !allowedTypes.includes(channel.type)) {
    return i.reply({ content: '⚠️ Choisis un salon textuel pour publier le giveaway.', flags: E });
  }
  const botMember = i.guild.members.me;
  if (!botMember || !channel.permissionsFor(botMember)?.has([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
  ])) {
    return i.reply({ content: '⚠️ Je dois pouvoir voir le salon, envoyer des messages et intégrer des liens.', flags: E });
  }

  const giveaway = {
    messageId: null,
    channelId: channel.id,
    prize,
    hostId: i.user.id,
    winnerCount,
    endsAt: Date.now() + duration,
    entrants: [],
    winners: [],
    ended: false,
  };
  await i.deferReply({ flags: E });
  const message = await channel.send({
    embeds: [embedFor(giveaway)],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('giveaway:join').setLabel('Participer').setEmoji('🎉').setStyle(ButtonStyle.Success),
    )],
    allowedMentions: { parse: [] },
  });
  giveaway.messageId = message.id;
  db.get(i.guildId).giveaways[message.id] = giveaway;
  db.save();
  schedule(i.client, i.guild, giveaway);
  return i.editReply(`✅ Giveaway publié dans ${channel}.\n[Ouvrir le giveaway](https://discord.com/channels/${i.guildId}/${channel.id}/${message.id})`);
}

async function join(i) {
  const giveaway = db.get(i.guildId).giveaways[i.message.id];
  if (!giveaway) return i.reply({ content: '⚠️ Ce giveaway est introuvable ou terminé.', flags: E });
  if (giveaway.ended || giveaway.endsAt <= Date.now()) {
    return i.reply({ content: '⏱️ Les participations à ce giveaway sont terminées.', flags: E });
  }
  if (i.user.bot) return i.reply({ content: 'Les bots ne peuvent pas participer.', flags: E });
  if (giveaway.entrants.includes(i.user.id)) {
    return i.reply({ content: 'Tu participes déjà à ce giveaway. 🎉', flags: E });
  }
  giveaway.entrants.push(i.user.id);
  db.save();
  return i.reply({ content: `✅ Ta participation au lot **${giveaway.prize}** est enregistrée !`, flags: E });
}

function handle(i) {
  if (i.customId === 'giveaway:join') return join(i);
}

function initialize(client) {
  for (const guild of client.guilds.cache.values()) {
    const records = db.get(guild.id).giveaways;
    for (const giveaway of Object.values(records)) {
      if (!giveaway.ended && Number.isFinite(giveaway.endsAt) && giveaway.messageId) {
        schedule(client, guild, giveaway);
      }
    }
  }
}

module.exports = { create, handle, initialize };
