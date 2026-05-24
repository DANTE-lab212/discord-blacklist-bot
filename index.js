require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} = require('discord.js');

const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const FILE = './blacklist.json';
const tempTargets = new Map();

function load() {
  if (!fs.existsSync(FILE)) return [];
  return JSON.parse(fs.readFileSync(FILE));
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

async function getRole(guild) {
  let role = guild.roles.cache.find(r => r.name === 'Blacklisted');

  if (!role) {
    role = await guild.roles.create({
      name: 'Blacklisted',
      permissions: []
    });

    for (const channel of guild.channels.cache.values()) {
      await channel.permissionOverwrites.edit(role, {
        ViewChannel: false,
        SendMessages: false,
        Connect: false
      });
    }
  }

  return role;
}

async function apply(member) {
  const role = await getRole(member.guild);
  if (!member.roles.cache.has(role.id)) {
    await member.roles.add(role);
  }
}

client.once('ready', () => {
  console.log(`${client.user.tag} online`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content.startsWith('!panel')) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return;

    const args = message.content.split(' ');
    const targetId = args[1];

    if (!targetId) return message.reply('حط ID');

    const member = await message.guild.members.fetch(targetId).catch(() => null);
    if (!member) return message.reply('ID غلط');

    tempTargets.set(message.author.id, member.id);

    const embed = new EmbedBuilder()
      .setTitle('⚙️ Blacklist Panel')
      .setDescription(`Target: ${member.user.tag}`)
      .setColor('Red');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('blacklist')
        .setLabel('Blacklist')
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId('unblacklist')
        .setLabel('Unblacklist')
        .setStyle(ButtonStyle.Success)
    );

    message.reply({ embeds: [embed], components: [row] });
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
    return interaction.reply({ content: 'No permission', ephemeral: true });

  const targetId = tempTargets.get(interaction.user.id);
  if (!targetId)
    return interaction.reply({ content: 'حدد عضو أول', ephemeral: true });

  const member = await interaction.guild.members.fetch(targetId).catch(() => null);
  if (!member)
    return interaction.reply({ content: 'العضو غير موجود', ephemeral: true });

  const data = load();

  if (interaction.customId === 'blacklist') {
    if (!data.includes(member.id)) {
      data.push(member.id);
      save(data);
    }

    await apply(member);

    return interaction.reply({
      content: `🚫 Blacklisted: ${member.user.tag}`,
      ephemeral: true
    });
  }

  if (interaction.customId === 'unblacklist') {
    const newData = data.filter(id => id !== member.id);
    save(newData);

    const role = interaction.guild.roles.cache.find(r => r.name === 'Blacklisted');
    if (role) await member.roles.remove(role);

    return interaction.reply({
      content: `✅ Unblacklisted: ${member.user.tag}`,
      ephemeral: true
    });
  }
});

client.login(process.env.TOKEN);
