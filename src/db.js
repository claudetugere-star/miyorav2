const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'db.json');
let data = {};
try { data = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}

const welcomeDefaults = (msg) => ({ enabled: false, channel: null, message: msg, embed: true, color: '#57F287' });

const defaults = () => ({
  logChannel: null,
  warns: {},
  welcome: welcomeDefaults('Bienvenue {user} sur **{server}** ! Nous sommes maintenant {count} membres.'),
  goodbye: { ...welcomeDefaults('**{username}** a quitté **{server}**. À bientôt !'), color: '#ED4245' },
  giveaways: {},
  tickets: {
    category: null, role: null, parentCategory: null, roles: [], panelChannel: null, logChannel: null, counter: 0,
    panel: {
      title: '🎫 Support',
      description: 'Choisis une catégorie ci-dessous pour ouvrir un ticket.',
      color: '#5865F2',
      button: 'Choisis une catégorie',
    },
  },
  reactionRoles: {
    channel: null, panelChannel: null, panelMessageId: null, roles: [], selectedRole: null, mappings: {},
  },
});

function fill(target, def) {
  for (const k of Object.keys(def)) {
    if (target[k] === undefined) target[k] = def[k];
    else if (def[k] && typeof def[k] === 'object' && !Array.isArray(def[k])) fill(target[k], def[k]);
  }
  return target;
}

function get(guildId) {
  if (!data[guildId]) data[guildId] = defaults();
  const guild = fill(data[guildId], defaults());
  let migrated = false;
  if (!guild.giveaways || typeof guild.giveaways !== 'object' || Array.isArray(guild.giveaways)) {
    guild.giveaways = {};
    migrated = true;
  }
  const tickets = guild.tickets;
  if (!Array.isArray(tickets.roles)) tickets.roles = [];
  if (!tickets.parentCategory) {
    tickets.parentCategory = tickets.category ||
      (Array.isArray(tickets.categories) ? tickets.categories[0] : null);
  }
  if (!tickets.roles.length && tickets.role) tickets.roles = [tickets.role];
  if ('category' in tickets) { delete tickets.category; migrated = true; }
  if ('categories' in tickets) { delete tickets.categories; migrated = true; }
  if ('role' in tickets) { delete tickets.role; migrated = true; }
  if (!guild.reactionRoles.panelChannel && guild.reactionRoles.panelMessageId && guild.reactionRoles.channel) {
    guild.reactionRoles.panelChannel = guild.reactionRoles.channel;
    migrated = true;
  }
  if (!Array.isArray(guild.reactionRoles.roles)) {
    guild.reactionRoles.roles = [];
    migrated = true;
  }
  if (!guild.reactionRoles.mappings || typeof guild.reactionRoles.mappings !== 'object' ||
      Array.isArray(guild.reactionRoles.mappings)) guild.reactionRoles.mappings = {};
  if (migrated) save();
  return guild;
}

let timer;
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  }, 300);
}

module.exports = { get, save };
