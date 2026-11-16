const { SlashCommandBuilder, PermissionFlagsBits: P, EmbedBuilder, MessageFlags, ChannelType } = require('discord.js');
const db = require('./db');
const { home } = require('./panel');
const giveaways = require('./giveaways');
const parseDuration = require('./duration');

const E = MessageFlags.Ephemeral;

function check(i, member) {
  if (!member) return 'Membre introuvable sur le serveur.';
  if (member.id === i.user.id) return 'Tu ne peux pas te cibler toi-même.';
  if (member.id === i.guild.ownerId) return 'Impossible de cibler le propriétaire du serveur.';
  if (i.guild.members.me.roles.highest.comparePositionTo(member.roles.highest) <= 0)
    return 'Mon rôle est trop bas par rapport à ce membre.';
  if (i.user.id !== i.guild.ownerId && i.member.roles.highest.comparePositionTo(member.roles.highest) <= 0)
    return 'Ce membre a un rôle égal ou supérieur au tien.';
  return null;
}

async function modLog(guild, { title, color, target, mod, reason, extra }) {
  const id = db.get(guild.id).logChannel;
  const c = id && guild.channels.cache.get(id);
  if (!c) return;
  const e = new EmbedBuilder().setColor(color).setTitle(title).setTimestamp()
    .addFields({ name: 'Modérateur', value: `${mod}`, inline: true });
  if (target) e.addFields({ name: 'Membre', value: `${target.tag} (${target.id})`, inline: true });
  if (reason) e.addFields({ name: 'Raison', value: reason });
  if (extra) e.addFields({ name: 'Détails', value: extra });
  c.send({ embeds: [e] }).catch(() => {});
}

const modCmd = (name, desc, perm, reasonOpt = true) => {
  const b = new SlashCommandBuilder().setName(name).setDescription(desc)
    .setDefaultMemberPermissions(perm).setDMPermission(false)
    .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true));
  if (reasonOpt) b.addStringOption((o) => o.setName('raison').setDescription('Raison'));
  return b;
};
const reasonOf = (i) => i.options.getString('raison') || 'Aucune raison fournie';
const dm = (user, text) => user.send(text).catch(() => {});

module.exports = [
  {
    data: modCmd('ban', 'Bannir un membre', P.BanMembers)
      .addIntegerOption((o) => o.setName('jours').setDescription('Jours de messages à supprimer (0-7)').setMinValue(0).setMaxValue(7)),
    async execute(i) {
      const user = i.options.getUser('membre');
      const member = await i.guild.members.fetch(user.id).catch(() => null);
      if (member) { const err = check(i, member); if (err) return i.reply({ content: err, flags: E }); }
      const reason = reasonOf(i);
      await dm(user, `🔨 Tu as été banni de **${i.guild.name}**.\nRaison : ${reason}`);
      await i.guild.members.ban(user, { reason: `${i.user.tag} : ${reason}`, deleteMessageSeconds: (i.options.getInteger('jours') || 0) * 86400 });
      await i.reply(`🔨 **${user.tag}** a été banni. Raison : ${reason}`);
      modLog(i.guild, { title: '🔨 Ban', color: 0xed4245, target: user, mod: i.user, reason });
    },
  },
  {
    data: new SlashCommandBuilder().setName('unban').setDescription('Débannir un utilisateur')
      .setDefaultMemberPermissions(P.BanMembers).setDMPermission(false)
      .addStringOption((o) => o.setName('id').setDescription('ID de l\'utilisateur').setRequired(true))
      .addStringOption((o) => o.setName('raison').setDescription('Raison')),
    async execute(i) {
      const id = i.options.getString('id').trim();
      const reason = reasonOf(i);
      const ban = await i.guild.bans.fetch(id).catch(() => null);
      if (!ban) return i.reply({ content: 'Cet utilisateur n\'est pas banni.', flags: E });
      await i.guild.bans.remove(id, `${i.user.tag} : ${reason}`);
      await i.reply(`✅ **${ban.user.tag}** a été débanni.`);
      modLog(i.guild, { title: '✅ Unban', color: 0x57f287, target: ban.user, mod: i.user, reason });
    },
  },
  {
    data: modCmd('kick', 'Expulser un membre', P.KickMembers),
    async execute(i) {
      const user = i.options.getUser('membre');
      const member = await i.guild.members.fetch(user.id).catch(() => null);
      const err = check(i, member);
      if (err) return i.reply({ content: err, flags: E });
      const reason = reasonOf(i);
      await dm(user, `👢 Tu as été expulsé de **${i.guild.name}**.\nRaison : ${reason}`);
      await member.kick(`${i.user.tag} : ${reason}`);
      await i.reply(`👢 **${user.tag}** a été expulsé. Raison : ${reason}`);
      modLog(i.guild, { title: '👢 Kick', color: 0xe67e22, target: user, mod: i.user, reason });
    },
  },
  {
        data: modCmd('mute', 'Rendre muet un membre (timeout)', P.ModerateMembers, false)
      .addStringOption((o) => o.setName('duree').setDescription('Ex : 10m, 2h, 1d (max 28d)').setRequired(true))
      .addStringOption((o) => o.setName('raison').setDescription('Raison')),
    async execute(i) {
      const user = i.options.getUser('membre');
      const member = await i.guild.members.fetch(user.id).catch(() => null);
      const err = check(i, member);
      if (err) return i.reply({ content: err, flags: E });
      const raw = i.options.getString('duree');
      const ms = parseDuration(raw);
      if (!ms) return i.reply({ content: 'Durée invalide. Exemples : `30s`, `10m`, `2h`, `1d` (max 28d).', flags: E });
      const reason = reasonOf(i);
      await member.timeout(ms, `${i.user.tag} : ${reason}`);
      await dm(user, `🔇 Tu as été rendu muet sur **${i.guild.name}** pour ${raw}.\nRaison : ${reason}`);
      await i.reply(`🔇 **${user.tag}** est muet pour ${raw}. Raison : ${reason}`);
      modLog(i.guild, { title: '🔇 Mute', color: 0xf1c40f, target: user, mod: i.user, reason, extra: `Durée : ${raw}` });
    },
  },
  {
    data: modCmd('unmute', 'Retirer le mute d\'un membre', P.ModerateMembers),
    async execute(i) {
      const user = i.options.getUser('membre');
      const member = await i.guild.members.fetch(user.id).catch(() => null);
      if (!member) return i.reply({ content: 'Membre introuvable.', flags: E });
      await member.timeout(null, `${i.user.tag}`);
      await i.reply(`🔊 **${user.tag}** n'est plus muet.`);
      modLog(i.guild, { title: '🔊 Unmute', color: 0x57f287, target: user, mod: i.user, reason: reasonOf(i) });
    },
  },
  {
    data: modCmd('warn', 'Avertir un membre', P.ModerateMembers),
    async execute(i) {
      const user = i.options.getUser('membre');
      const member = await i.guild.members.fetch(user.id).catch(() => null);
      const err = check(i, member);
      if (err) return i.reply({ content: err, flags: E });
      const reason = reasonOf(i);
      const g = db.get(i.guildId);
      (g.warns[user.id] ||= []).push({ id: Date.now().toString(36), mod: i.user.id, reason, date: Date.now() });
      db.save();
      await dm(user, `⚠️ Avertissement sur **${i.guild.name}**.\nRaison : ${reason}`);
      await i.reply(`⚠️ **${user.tag}** a reçu un avertissement (${g.warns[user.id].length} au total). Raison : ${reason}`);
      modLog(i.guild, { title: '⚠️ Warn', color: 0xf1c40f, target: user, mod: i.user, reason, extra: `Total : ${g.warns[user.id].length}` });
    },
  },
  {
    data: modCmd('warns', 'Voir les avertissements d\'un membre', P.ModerateMembers, false),
    async execute(i) {
      const user = i.options.getUser('membre');
      const list = db.get(i.guildId).warns[user.id] || [];
      if (!list.length) return i.reply({ content: `**${user.tag}** n'a aucun avertissement.`, flags: E });
      const desc = list.slice(-10).map((w, n) => `**${n + 1}.** <t:${Math.floor(w.date / 1000)}:d> — ${w.reason} (par <@${w.mod}>)`).join('\n');
      return i.reply({ embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle(`⚠️ Avertissements de ${user.tag}`).setDescription(desc)], flags: E });
    },
  },
  {
    data: modCmd('clearwarns', 'Effacer les avertissements d\'un membre', P.ModerateMembers, false),
    async execute(i) {
      const user = i.options.getUser('membre');
      delete db.get(i.guildId).warns[user.id];
      db.save();
      await i.reply(`🧽 Avertissements de **${user.tag}** effacés.`);
      modLog(i.guild, { title: '🧽 Clear warns', color: 0x3498db, target: user, mod: i.user });
    },
  },
  {
    data: new SlashCommandBuilder().setName('clear').setDescription('Supprimer des messages')
      .setDefaultMemberPermissions(P.ManageMessages).setDMPermission(false)
      .addIntegerOption((o) => o.setName('nombre').setDescription('Nombre de messages (1-100)').setMinValue(1).setMaxValue(100).setRequired(true))
      .addUserOption((o) => o.setName('membre').setDescription('Ne supprimer que les messages de ce membre')),
    async execute(i) {
      const n = i.options.getInteger('nombre');
      const user = i.options.getUser('membre');
      await i.deferReply({ flags: E });
      let target = n;
      if (user) {
        const fetched = await i.channel.messages.fetch({ limit: 100 });
        target = [...fetched.filter((m) => m.author.id === user.id).values()].slice(0, n);
      }
      const deleted = await i.channel.bulkDelete(target, true);
      await i.editReply(`🧹 ${deleted.size} message(s) supprimé(s) (les messages de plus de 14 jours sont ignorés).`);
      modLog(i.guild, { title: '🧹 Clear', color: 0x3498db, mod: i.user, extra: `${deleted.size} message(s) dans ${i.channel}${user ? ` de ${user.tag}` : ''}` });
    },
  },
  {
    data: new SlashCommandBuilder().setName('say').setDescription('Faire parler le bot dans un salon')
      .setDefaultMemberPermissions(P.ManageMessages).setDMPermission(false)
      .addChannelOption((o) => o.setName('salon').setDescription('Salon cible').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
      .addStringOption((o) => o.setName('message').setDescription('Texte (utilise \\n pour un retour à la ligne)').setRequired(true))
      .addBooleanOption((o) => o.setName('embed').setDescription('Envoyer sous forme d\'embed'))
      .addStringOption((o) => o.setName('titre').setDescription('Titre de l\'embed'))
      .addStringOption((o) => o.setName('couleur').setDescription('Couleur de l\'embed (hex, ex : #5865F2)')),
    async execute(i) {
      const c = i.options.getChannel('salon');
      if (!c.permissionsFor(i.guild.members.me).has([P.ViewChannel, P.SendMessages]))
        return i.reply({ content: 'Je ne peux pas écrire dans ce salon.', flags: E });
      const text = i.options.getString('message').replaceAll('\\n', '\n');
      if (i.options.getBoolean('embed')) {
        const e = new EmbedBuilder().setDescription(text).setColor(0x5865f2);
        const titre = i.options.getString('titre');
        const couleur = i.options.getString('couleur');
        if (titre) e.setTitle(titre);
        if (couleur && /^#?[0-9a-f]{6}$/i.test(couleur)) e.setColor(couleur.startsWith('#') ? couleur : `#${couleur}`);
        await c.send({ embeds: [e] });
      } else {
        await c.send({ content: text, allowedMentions: { parse: ['users'] } });
      }
      return i.reply({ content: `✅ Message envoyé dans ${c}.`, flags: E });
    },
  },
  {
    data: new SlashCommandBuilder().setName('giveway').setDescription('Lancer un giveaway avec tirage automatique')
      .setDefaultMemberPermissions(P.ManageGuild).setDMPermission(false)
      .addStringOption((o) => o.setName('lot').setDescription('Lot à gagner').setRequired(true).setMaxLength(100))
      .addStringOption((o) => o.setName('duree').setDescription('Ex : 30s, 10m, 2h, 1d (max 28 jours)').setRequired(true).setMaxLength(10))
      .addIntegerOption((o) => o.setName('gagnants').setDescription('Nombre de gagnants (1-20)').setRequired(true).setMinValue(1).setMaxValue(20))
      .addChannelOption((o) => o.setName('salon').setDescription('Salon de publication (par défaut : ici)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
    async execute(i) { return giveaways.create(i); },
  },
  {
    data: new SlashCommandBuilder().setName('config').setDescription('Ouvrir le panel de configuration du bot')
      .setDefaultMemberPermissions(P.ManageGuild).setDMPermission(false),
    async execute(i) { return i.reply({ ...home(), flags: E }); },
  },
];
