const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder,
  PermissionFlagsBits: P, MessageFlags, AttachmentBuilder,
} = require('discord.js');
const db = require('./db');
const ticketTypes = require('./ticketTypes');

const E = MessageFlags.Ephemeral;
const ALLOW = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles];

const supportRoles = (t) => t.roles || (t.role ? [t.role] : []);
const ownerOf = (channel) => channel.topic?.startsWith('ticket:')
  ? channel.topic.slice(7).split(':')[0]
  : null;
const isStaff = (i, t) =>
  supportRoles(t).some((roleId) => i.member.roles.cache.has(roleId)) ||
  i.memberPermissions.has(P.ManageChannels);

async function open(i, requestedType = 'assistance') {
  const t = db.get(i.guildId).tickets;
  const type = ticketTypes.find((item) => item.value === requestedType) ||
    (i.guild.channels.cache.get(requestedType)?.type === ChannelType.GuildCategory
      ? ticketTypes.find((item) => item.value === 'assistance')
      : null);
  const parent = t.parentCategory && i.guild.channels.cache.get(t.parentCategory);
  if (!type || !parent || parent.type !== ChannelType.GuildCategory) {
    return i.reply({ content: '⚠️ Le système de tickets n\'est pas configuré.', flags: E });
  }
  const existing = i.guild.channels.cache.find((c) =>
    c.parentId === parent.id && ownerOf(c) === i.user.id);
  if (existing) return i.reply({ content: `Tu as déjà un ticket ouvert : ${existing}`, flags: E });

  await i.deferReply({ flags: E });
  t.counter++;
  db.save();

  const roles = supportRoles(t).filter((roleId) => i.guild.roles.cache.has(roleId));
  const perms = [
    { id: i.guild.id, deny: [P.ViewChannel] },
    { id: i.user.id, allow: ALLOW },
    { id: i.client.user.id, allow: [...ALLOW, P.ManageChannels] },
  ];
  for (const roleId of roles) perms.push({ id: roleId, allow: ALLOW });

  const channel = await i.guild.channels.create({
    name: `ticket-${type.value}-${String(t.counter).padStart(4, '0')}`,
    type: ChannelType.GuildText,
    parent: parent.id,
    topic: `ticket:${i.user.id}:${type.value}`,
    permissionOverwrites: perms,
  });

  await channel.send({
    content: `${i.user}${roles.length ? ` ${roles.map((roleId) => `<@&${roleId}>`).join(' ')}` : ''}`,
    allowedMentions: { users: [i.user.id], roles },
    embeds: [new EmbedBuilder().setColor(0x57f287).setTitle(`🎫 ${type.label}`)
      .setDescription('Explique ta demande, le support va te répondre rapidement.')],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:claim').setLabel('🙋 Prendre en charge').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ticket:close').setLabel('🔒 Fermer').setStyle(ButtonStyle.Danger),
    )],
  });
  return i.editReply(`✅ Ticket créé : ${channel}`);
}

async function transcript(channel) {
  const all = [];
  let before;
  while (all.length < 2000) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    all.push(...batch.values());
    before = batch.last().id;
  }
  return all.reverse().map((m) => {
    const files = [...m.attachments.values()].map((a) => a.url).join(' ');
    return `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content}${files ? ` ${files}` : ''}${m.embeds.length ? ' [embed]' : ''}`;
  }).join('\n');
}

async function close(i) {
  const t = db.get(i.guildId).tickets;
  const ownerId = ownerOf(i.channel);
  if (!ownerId) return i.reply({ content: 'Ce salon n\'est pas un ticket.', flags: E });
  if (i.user.id !== ownerId && !isStaff(i, t)) {
    return i.reply({ content: 'Tu ne peux pas fermer ce ticket.', flags: E });
  }
  await i.reply('🔒 Fermeture du ticket dans 5 secondes… Un transcript est enregistré.');

  const text = await transcript(i.channel);
  const file = () => new AttachmentBuilder(Buffer.from(text || '(vide)', 'utf8'), { name: `${i.channel.name}.txt` });
  const embed = new EmbedBuilder().setColor(0xed4245).setTitle('🔒 Ticket fermé')
    .addFields(
      { name: 'Ticket', value: i.channel.name, inline: true },
      { name: 'Ouvert par', value: `<@${ownerId}>`, inline: true },
      { name: 'Fermé par', value: `${i.user}`, inline: true },
    ).setTimestamp();

  const logCh = t.logChannel && i.guild.channels.cache.get(t.logChannel);
  if (logCh) await logCh.send({ embeds: [embed], files: [file()] }).catch(() => {});
  const owner = await i.client.users.fetch(ownerId).catch(() => null);
  if (owner) await owner.send({ embeds: [embed], files: [file()] }).catch(() => {});

  setTimeout(() => i.channel.delete().catch(() => {}), 5000);
}

async function claim(i) {
  const t = db.get(i.guildId).tickets;
  if (!isStaff(i, t)) return i.reply({ content: 'Réservé au support.', flags: E });
  return i.reply(`🙋 ${i.user} prend en charge ce ticket.`);
}

async function handle(i) {
  if (i.customId === 'ticket:open') return open(i, 'assistance');
  if (i.customId === 'ticket:category') return open(i, i.values[0]);
  if (i.customId === 'ticket:close') return close(i);
  if (i.customId === 'ticket:claim') return claim(i);
}

module.exports = { handle };
