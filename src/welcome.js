const { EmbedBuilder } = require('discord.js');
const db = require('./db');

const fmt = (t, m) =>
  t.replaceAll('{user}', `<@${m.id}>`)
    .replaceAll('{username}', m.user.username)
    .replaceAll('{server}', m.guild.name)
    .replaceAll('{count}', String(m.guild.memberCount));

function render(w, m) {
  const text = fmt(w.message, m);
  if (!w.embed) return { content: text };
  return {
    embeds: [new EmbedBuilder().setColor(w.color).setDescription(text)
      .setThumbnail(m.user.displayAvatarURL()).setTimestamp()],
  };
}

async function send(key, member) {
  const w = db.get(member.guild.id)[key];
  if (!w.enabled || !w.channel) return;
  const ch = member.guild.channels.cache.get(w.channel);
  if (ch?.isTextBased()) ch.send(render(w, member)).catch(() => {});
}

module.exports = { render, send };
