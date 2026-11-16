const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  ChannelType, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits, MessageFlags,
} = require('discord.js');
const db = require('./db');
const { render } = require('./welcome');
const ticketTypes = require('./ticketTypes');

const E = MessageFlags.Ephemeral;
const HEX = /^#?[0-9a-f]{6}$/i;
const normHex = (s) => (s.startsWith('#') ? s : `#${s}`);
const btn = (id, label, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const row = (...c) => new ActionRowBuilder().addComponents(...c);
const back = () => row(btn('cfg:home', '⬅️ Retour'));
const ch = (id) => (id ? `<#${id}>` : '*non défini*');
const ro = (id) => (id ? `<@&${id}>` : '*non défini*');
const chanSelect = (id, ph, types) =>
  row(new ChannelSelectMenuBuilder().setCustomId(id).setPlaceholder(ph).setChannelTypes(types));
const base = (title, desc) => new EmbedBuilder().setColor(0x5865f2).setTitle(title).setDescription(desc);
const input = (id, label, style, value, required = true, max) => {
  const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
  if (value) t.setValue(String(value));
  if (max) t.setMaxLength(max);
  return row(t);
};
// ---------- Vues ----------
function home() {
  return {
    embeds: [base('⚙️ Configuration du bot', 'Choisis la section à configurer.')],
    components: [row(
      btn('cfg:tickets', '🎫 Tickets'), btn('cfg:welcome', '👋 Bienvenue'),
      btn('cfg:goodbye', '🚪 Au revoir'), btn('cfg:logs', '📜 Logs'),
      btn('cfg:reaction-roles', '🎭 Rôles à choisir'),
    )],
  };
}

function logsView(g) {
  return {
    embeds: [base('📜 Logs de modération', `Salon actuel : ${ch(g.logChannel)}\nChoisis le salon où seront envoyés les logs.`)],
    components: [chanSelect('cfg:logs:set', 'Salon de logs', [ChannelType.GuildText]), back()],
  };
}

function ticketsView(g, guild) {
  const t = g.tickets;
  const parentCategory = t.parentCategory &&
    guild.channels.cache.get(t.parentCategory)?.type === ChannelType.GuildCategory ? t.parentCategory : null;
  const roles = (t.roles || (t.role ? [t.role] : []))
    .filter((roleId) => guild.roles.cache.has(roleId));
  const categorySelect = new ChannelSelectMenuBuilder().setCustomId('cfg:t:parent-category')
    .setPlaceholder('Catégorie Discord où ranger les tickets')
    .setChannelTypes([ChannelType.GuildCategory]);
  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('cfg:t:roles').setPlaceholder('Rôles support (sélection multiple)')
    .setMinValues(0).setMaxValues(25);
  if (parentCategory) categorySelect.setDefaultChannels(parentCategory);
  if (roles.length) roleSelect.setDefaultRoles(...roles.slice(0, 25));
  const e = base('🎫 Configuration des tickets', 'Configure tout ici, puis envoie le panel dans un salon.')
    .addFields(
      { name: 'Catégorie Discord de rangement', value: ch(parentCategory), inline: true },
      { name: 'Rôles support', value: roles.length ? roles.map(ro).join(', ') : '*aucun*', inline: true },
      { name: 'Salon de transcripts', value: ch(t.logChannel), inline: true },
      { name: 'Salon du panel', value: ch(t.panelChannel), inline: true },
      { name: 'Choix affichés', value: ticketTypes.map((type) => type.label).join(' • ') },
      { name: 'Panel', value: `**${t.panel.title}**\n${t.panel.description}\nTexte du menu : \`${t.panel.button}\` • Couleur : \`${t.panel.color}\`` },
    );
  return {
    embeds: [e],
    components: [
      row(categorySelect),
      row(roleSelect),
      chanSelect('cfg:t:logs', 'Salon des transcripts', [ChannelType.GuildText]),
      chanSelect('cfg:t:panel-channel', 'Salon où envoyer le panel', [ChannelType.GuildText]),
      row(
        btn('cfg:t:edit', '✏️ Modifier le panel'),
        btn('cfg:t:send', '📨 Envoyer le panel', ButtonStyle.Success),
        btn('cfg:home', '⬅️ Retour'),
      ),
    ],
  };
}

function reactionRolesView(g, guild) {
  const r = g.reactionRoles;
  const roles = (r.roles || []).filter((roleId) => guild.roles.cache.has(roleId)).slice(0, 25);
  const summary = roles.length
    ? roles.map((roleId) => `<@&${roleId}>`).join(', ').slice(0, 1000)
    : '*Aucun rôle sélectionné.*';
  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('cfg:rr:roles').setPlaceholder('Choisir les rôles disponibles dans le menu')
    .setMinValues(0).setMaxValues(25);
  if (roles.length) roleSelect.setDefaultRoles(...roles.slice(0, 25));
  const panelChannel = r.panelChannel && guild.channels.cache.get(r.panelChannel);
  const panelLink = r.panelMessageId && panelChannel
    ? `[Ouvrir le panel](https://discord.com/channels/${guild.id}/${panelChannel.id}/${r.panelMessageId})`
    : '*aucun panel publié*';
  const e = base('🎭 Menu de rôles', 'Choisis le salon et plusieurs rôles, puis publie le menu. Chaque membre peut en sélectionner plusieurs : un rôle déjà détenu sera retiré.')
    .addFields(
      { name: 'Salon du menu', value: ch(r.channel), inline: true },
      { name: 'Panel actif', value: panelLink, inline: true },
      { name: 'Rôles proposés', value: summary },
    );
  return {
    embeds: [e],
    components: [
      chanSelect('cfg:rr:channel', 'Salon où publier le menu', [ChannelType.GuildText]),
      row(roleSelect),
      row(
        btn('cfg:rr:publish', '📨 Publier / actualiser le menu', ButtonStyle.Success),
        btn('cfg:home', '⬅️ Retour'),
      ),
    ],
  };
}

function welcomeView(g, key) {
  const w = g[key];
  const name = key === 'welcome' ? '👋 Message de bienvenue' : '🚪 Message d\'au revoir';
  const e = base(name, 'Variables : `{user}` `{username}` `{server}` `{count}`').addFields(
    { name: 'Statut', value: w.enabled ? '✅ Activé' : '❌ Désactivé', inline: true },
    { name: 'Salon', value: ch(w.channel), inline: true },
    { name: 'Format', value: w.embed ? 'Embed' : 'Texte simple', inline: true },
    { name: 'Message', value: w.message },
  ).setColor(w.color);
  return {
    embeds: [e],
    components: [
      chanSelect(`cfg:wc:${key}`, 'Salon', [ChannelType.GuildText]),
      row(
        btn(`cfg:wt:${key}`, w.enabled ? 'Désactiver' : 'Activer', w.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        btn(`cfg:we:${key}`, '✏️ Modifier le message'),
        btn(`cfg:wm:${key}`, 'Embed / Texte'),
        btn(`cfg:wx:${key}`, '👁️ Aperçu'),
      ),
      back(),
    ],
  };
}

// ---------- Routeur ----------
async function handle(i) {
  if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return i.reply({ content: 'Il te faut la permission « Gérer le serveur ».', flags: E });
  }
  const g = db.get(i.guildId);
  const id = i.customId;
  const [, act, key] = id.split(':');

  if (id === 'cfg:home') return i.update(home());
  if (id === 'cfg:tickets') return i.update(ticketsView(g, i.guild));
  if (id === 'cfg:welcome' || id === 'cfg:goodbye') return i.update(welcomeView(g, act));
  if (id === 'cfg:logs') return i.update(logsView(g));
  if (id === 'cfg:reaction-roles') return i.update(reactionRolesView(g, i.guild));

  if (id === 'cfg:logs:set') { g.logChannel = i.values[0]; db.save(); return i.update(logsView(g)); }

  // Tickets
  if (id === 'cfg:t:parent-category') { g.tickets.parentCategory = i.values[0]; db.save(); return i.update(ticketsView(g, i.guild)); }
  if (id === 'cfg:t:roles') { g.tickets.roles = i.values; db.save(); return i.update(ticketsView(g, i.guild)); }
  if (id === 'cfg:t:logs') { g.tickets.logChannel = i.values[0]; db.save(); return i.update(ticketsView(g, i.guild)); }
  if (id === 'cfg:t:panel-channel') { g.tickets.panelChannel = i.values[0]; db.save(); return i.update(ticketsView(g, i.guild)); }

  if (id === 'cfg:t:edit') {
    const p = g.tickets.panel;
    return i.showModal(new ModalBuilder().setCustomId('cfg:t:modal').setTitle('Panel de tickets').addComponents(
      input('title', 'Titre', TextInputStyle.Short, p.title, true, 100),
      input('description', 'Description', TextInputStyle.Paragraph, p.description, true, 2000),
      input('button', 'Texte du menu', TextInputStyle.Short, p.button, true, 80),
      input('color', 'Couleur (hex, ex: #5865F2)', TextInputStyle.Short, p.color, true, 7),
    ));
  }
  if (id === 'cfg:t:modal') {
    const p = g.tickets.panel;
    p.title = i.fields.getTextInputValue('title');
    p.description = i.fields.getTextInputValue('description');
    p.button = i.fields.getTextInputValue('button');
    const c = i.fields.getTextInputValue('color').trim();
    if (HEX.test(c)) p.color = normHex(c);
    db.save();
    return i.update(ticketsView(g, i.guild));
  }
  if (id === 'cfg:t:send') {
    const category = g.tickets.parentCategory && i.guild.channels.cache.get(g.tickets.parentCategory);
    if (!category || category.type !== ChannelType.GuildCategory) {
      return i.reply({ content: '⚠️ Choisis la catégorie Discord où ranger les tickets.', flags: E });
    }
    const channel = g.tickets.panelChannel && i.guild.channels.cache.get(g.tickets.panelChannel);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return i.reply({ content: '⚠️ Choisis le salon où envoyer le panel.', flags: E });
    }
    if (!channel.permissionsFor(i.guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
      return i.reply({ content: '⚠️ Je ne peux pas écrire dans le salon du panel.', flags: E });
    }
    const p = g.tickets.panel;
    const menu = new StringSelectMenuBuilder().setCustomId('ticket:category')
      .setPlaceholder(p.button)
      .addOptions(ticketTypes);
    await channel.send({
      embeds: [new EmbedBuilder().setTitle(p.title).setDescription(p.description).setColor(p.color)],
      components: [row(menu)],
    });
    return i.reply({ content: `✅ Panel envoyé dans ${channel}.`, flags: E });
  }

  // Rôles par réaction
  if (id === 'cfg:rr:channel') {
    g.reactionRoles.channel = i.values[0];
    db.save();
    return i.update(reactionRolesView(g, i.guild));
  }
  if (id === 'cfg:rr:roles') {
    const invalid = i.values.filter((roleId) => {
      const role = i.guild.roles.cache.get(roleId);
      return !role || role.managed || !i.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles) || !role.editable;
    });
    if (invalid.length) {
      return i.reply({ content: '⚠️ Je ne peux pas gérer un ou plusieurs des rôles sélectionnés. Vérifie ma permission Gérer les rôles et la position de mon rôle.', flags: E });
    }
    g.reactionRoles.roles = i.values;
    db.save();
    return i.update(reactionRolesView(g, i.guild));
  }
  if (id === 'cfg:rr:publish') {
    if (!g.reactionRoles.channel) return i.reply({ content: '⚠️ Choisis d\'abord un salon.', flags: E });
    if (!g.reactionRoles.roles.length) return i.reply({ content: '⚠️ Sélectionne au moins un rôle dans le menu.', flags: E });
    return i.showModal(new ModalBuilder().setCustomId('cfg:rr:panel').setTitle('Menu de rôles').addComponents(
      input('message', 'Instructions affichées', TextInputStyle.Paragraph, 'Sélectionne un ou plusieurs rôles. En sélectionnant un rôle déjà obtenu, tu le retires.', true, 2000),
    ));
  }
  if (id === 'cfg:rr:panel') {
    const channel = i.guild.channels.cache.get(g.reactionRoles.channel);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return i.reply({ content: '⚠️ Le salon choisi n’existe plus. Sélectionne-en un autre.', flags: E });
    }
    const botMember = i.guild.members.me;
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return i.reply({ content: '⚠️ Il me faut la permission Gérer les rôles pour publier ce menu.', flags: E });
    }
    const roles = g.reactionRoles.roles.map((roleId) => i.guild.roles.cache.get(roleId));
    if (!roles.length || roles.some((role) => !role || role.managed || !role.editable)) {
      return i.reply({ content: '⚠️ Un ou plusieurs rôles ne sont plus disponibles ou sont au-dessus de mon rôle. Mets à jour la sélection.', flags: E });
    }
    if (!channel.permissionsFor(botMember)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
      return i.reply({ content: '⚠️ Il me faut les permissions Voir le salon et Envoyer des messages.', flags: E });
    }
    await i.deferReply({ flags: E });
    const previousMessageId = g.reactionRoles.panelMessageId;
    const previousChannelId = g.reactionRoles.panelChannel;
    const menu = new StringSelectMenuBuilder().setCustomId('selfrole:select')
      .setPlaceholder('Choisis un ou plusieurs rôles')
      .setMinValues(1).setMaxValues(roles.length)
      .addOptions(roles.map((role) => ({ label: role.name.slice(0, 100), value: role.id })));
    const message = await channel.send({
      content: i.fields.getTextInputValue('message'),
      allowedMentions: { parse: [] },
      components: [row(menu)],
    });
    g.reactionRoles.panelMessageId = message.id;
    g.reactionRoles.panelChannel = channel.id;
    g.reactionRoles.mappings = {};
    g.reactionRoles.selectedRole = null;
    db.save();
    if (previousMessageId && previousChannelId) {
      const previousChannel = i.guild.channels.cache.get(previousChannelId);
      if (previousChannel?.isTextBased()) {
        const previousMessage = await previousChannel.messages.fetch(previousMessageId).catch(() => null);
        if (previousMessage?.author.id === i.client.user.id) {
          previousMessage.delete().catch((error) =>
            console.error('Impossible de supprimer l’ancien panel de rôles :', error));
        }
      }
    }
    return i.editReply(
      `✅ Menu publié dans ${channel}.\n[Ouvrir le menu](https://discord.com/channels/${i.guildId}/${channel.id}/${message.id})\nLes membres peuvent sélectionner plusieurs rôles. Un rôle déjà détenu sera retiré.`,
    );
  }
  // Bienvenue / Au revoir
  if (act === 'wc') { g[key].channel = i.values[0]; db.save(); return i.update(welcomeView(g, key)); }
  if (act === 'wt') { g[key].enabled = !g[key].enabled; db.save(); return i.update(welcomeView(g, key)); }
  if (act === 'wm') { g[key].embed = !g[key].embed; db.save(); return i.update(welcomeView(g, key)); }
  if (act === 'wx') return i.reply({ ...render(g[key], i.member), flags: E });
  if (act === 'we') {
    return i.showModal(new ModalBuilder().setCustomId(`cfg:wsubmit:${key}`).setTitle('Message').addComponents(
      input('message', 'Message', TextInputStyle.Paragraph, g[key].message, true, 1500),
      input('color', 'Couleur de l\'embed (hex)', TextInputStyle.Short, g[key].color, true, 7),
    ));
  }
  if (act === 'wsubmit') {
    g[key].message = i.fields.getTextInputValue('message');
    const c = i.fields.getTextInputValue('color').trim();
    if (HEX.test(c)) g[key].color = normHex(c);
    db.save();
    return i.update(welcomeView(g, key));
  }
}

module.exports = { handle, home };
