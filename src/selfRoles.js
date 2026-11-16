const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const db = require('./db');

const E = MessageFlags.Ephemeral;

async function handle(i) {
  const config = db.get(i.guildId).reactionRoles;
  const allowed = new Set(config.roles || []);
  const selected = [...new Set(i.values)].filter((roleId) => allowed.has(roleId));
  if (!selected.length) {
    return i.reply({ content: '⚠️ Aucun rôle valide sélectionné dans ce menu.', flags: E });
  }
  const botMember = i.guild.members.me;
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return i.reply({ content: '⚠️ Le bot n’a plus la permission Gérer les rôles.', flags: E });
  }

  await i.deferReply({ flags: E });
  const member = await i.guild.members.fetch(i.user.id);
  const added = [];
  const removed = [];
  const failed = [];

  for (const roleId of selected) {
    const role = i.guild.roles.cache.get(roleId) || await i.guild.roles.fetch(roleId).catch(() => null);
    if (!role || role.managed || !role.editable) {
      failed.push(roleId);
      continue;
    }
    try {
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(role, 'Rôle retiré via le menu de rôles');
        removed.push(roleId);
      } else {
        await member.roles.add(role, 'Rôle attribué via le menu de rôles');
        added.push(roleId);
      }
    } catch (error) {
      console.error(`Impossible de basculer le rôle ${roleId} pour ${i.user.id} :`, error);
      failed.push(roleId);
    }
  }

  const lines = [];
  if (added.length) lines.push(`✅ Ajouté(s) : ${added.map((id) => `<@&${id}>`).join(', ')}`);
  if (removed.length) lines.push(`↩️ Retiré(s) : ${removed.map((id) => `<@&${id}>`).join(', ')}`);
  if (failed.length) lines.push(`⚠️ Échec pour : ${failed.map((id) => `<@&${id}>`).join(', ')}. Vérifie les permissions et la position des rôles.`);
  return i.editReply({
    content: lines.join('\n'),
    allowedMentions: { parse: [], roles: [...added, ...removed, ...failed] },
  });
}

module.exports = { handle };
