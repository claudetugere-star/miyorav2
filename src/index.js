require('dotenv').config();
const {
  Client, GatewayIntentBits, Events, REST, Routes, MessageFlags, Partials,
} = require('discord.js');
const commands = require('./commands');
const panel = require('./panel');
const tickets = require('./tickets');
const selfRoles = require('./selfRoles');
const giveaways = require('./giveaways');
const welcome = require('./welcome');
const db = require('./db');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessageReactions],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],
});
const map = new Map(commands.map((c) => [c.data.name, c]));

async function updateReactionRole(reaction, user, add) {
  try {
    if (user.partial) await user.fetch();
    if (user.bot) return;
    if (reaction.partial) await reaction.fetch();
    if (reaction.message.partial) await reaction.message.fetch();
    const guild = reaction.message.guild;
    if (!guild) return;
    const config = db.get(guild.id).reactionRoles;
    if (reaction.message.id !== config.panelMessageId) return;
    const key = reaction.emoji.id || reaction.emoji.name;
    const roleId = config.mappings[key];
    if (!roleId) return;
    const member = await guild.members.fetch(user.id);
    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      console.error(`Rôle réaction introuvable (${roleId}) sur le serveur ${guild.id}.`);
      return;
    }
    if (add) await member.roles.add(role, 'Rôle attribué par réaction');
    else await member.roles.remove(role, 'Rôle retiré par réaction');
  } catch (error) {
    console.error('Échec de la mise à jour d’un rôle par réaction :', error);
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Connecté en tant que ${c.user.tag}`);
  const rest = new REST().setToken(process.env.TOKEN);
  const body = commands.map((x) => x.data.toJSON());
  const route = process.env.GUILD_ID
    ? Routes.applicationGuildCommands(c.user.id, process.env.GUILD_ID)
    : Routes.applicationCommands(c.user.id);
  await rest.put(route, { body });
  console.log(`${body.length} commandes enregistrées.`);
  giveaways.initialize(c);
});

client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isChatInputCommand()) return await map.get(i.commandName)?.execute(i);
    if (i.customId?.startsWith('cfg:')) return await panel.handle(i);
    if (i.customId?.startsWith('selfrole:')) return await selfRoles.handle(i);
    if (i.customId?.startsWith('ticket:')) return await tickets.handle(i);
    if (i.customId?.startsWith('giveaway:')) return await giveaways.handle(i);
  } catch (err) {
    console.error(err);
    const msg = { content: '❌ Une erreur est survenue.', flags: MessageFlags.Ephemeral };
    if (i.deferred || i.replied) i.followUp(msg).catch(() => {});
    else i.reply(msg).catch(() => {});
  }
});

client.on(Events.GuildMemberAdd, (m) => welcome.send('welcome', m));
client.on(Events.GuildMemberRemove, (m) => welcome.send('goodbye', m));
client.on(Events.MessageReactionAdd, (reaction, user) => updateReactionRole(reaction, user, true));
client.on(Events.MessageReactionRemove, (reaction, user) => updateReactionRole(reaction, user, false));

client.login(process.env.TOKEN);
