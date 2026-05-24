require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  ChannelType
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

const FILE = './data.json';

function load() {
  if (!fs.existsSync(FILE)) return { blacklist: [] };
  return JSON.parse(fs.readFileSync(FILE));
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

/* إنشاء أو جلب رتبة البلاك ليست */
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

/* تطبيق الحظر */
async function applyBlacklist(member) {
  const role = await getRole(member.guild);
  if (!member.roles.cache.has(role.id)) {
    await member.roles.add(role);
  }
}

/* لوق */
async function sendLog(guild, text) {
  let logChannel = guild.channels.cache.find(c => c.name === 'logs');

  if (!logChannel) {
    logChannel = await guild.channels.create({
      name: 'logs',
      type: ChannelType.GuildText
    });
  }

  logChannel.send(text);
}

client.once('ready', () => {
  console.log(`${client.user.tag} online`);
});

/* إعادة تطبيق البلاك ليست عند دخول العضو */
client.on('guildMemberAdd', async (member) => {
  const data = load();

  if (data.blacklist.includes(member.id)) {
    await applyBlacklist(member);
  }
});

/* لوحة التحكم */
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content === '!panel') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return;

    const members = message.guild.members.cache
      .filter(m => !m.user.bot)
      .first(25);

    const options = members.map(m => ({
      label: m.user.username,
      description: m.user.id,
      value: m.id
    }));

    const select = new StringSelectMenuBuilder()
      .setCustomId('select_user')
      .setPlaceholder('اختر العضو')
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(select);

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('bl')
        .setLabel('Blacklist')
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId('ubl')
        .setLabel('Unblacklist')
        .setStyle(ButtonStyle.Success)
    );

    const embed = new EmbedBuilder()
      .setTitle('⚙️ Advanced Control Panel')
      .setDescription('اختر عضو ثم نفذ العملية')
      .setColor('Red');

    message.reply({ embeds: [embed], components: [row, buttons] });
  }
});

/* تخزين العضو المختار */
const selected = new Map();

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;

  if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
    return interaction.reply({ content: 'No permission', ephemeral: true });

  const data = load();

  /* اختيار العضو */
  if (interaction.isStringSelectMenu()) {
    selected.set(interaction.user.id, interaction.values[0]);

    return interaction.reply({
      content: '✅ تم اختيار العضو',
      ephemeral: true
    });
  }

  const userId = selected.get(interaction.user.id);

  if (!userId)
    return interaction.reply({ content: 'اختر عضو أول', ephemeral: true });

  const member = await interaction.guild.members.fetch(userId).catch(() => null);

  if (!member)
    return interaction.reply({ content: 'العضو غير موجود', ephemeral: true });

  const log = `[${new Date().toLocaleString()}] ${interaction.user.tag}`;

  /* BLACKLIST */
  if (interaction.customId === 'bl') {
    if (!data.blacklist.includes(member.id)) {
      data.blacklist.push(member.id);
      save(data);
    }

    await applyBlacklist(member);

    await sendLog(interaction.guild,
      `🚫 BLACKLIST\nUser: ${member.user.tag}\nBy: ${interaction.user.tag}\nTime: ${new Date().toLocaleString()}`
    );

    return interaction.reply({
      content: `🚫 Blacklisted: ${member.user.tag}`,
      ephemeral: true
    });
  }

  /* UNBLACKLIST */
  if (interaction.customId === 'ubl') {
    data.blacklist = data.blacklist.filter(id => id !== member.id);
    save(data);

    const role = interaction.guild.roles.cache.find(r => r.name === 'Blacklisted');
    if (role) await member.roles.remove(role);

    await sendLog(interaction.guild,
      `✅ UNBLACKLIST\nUser: ${member.user.tag}\nBy: ${interaction.user.tag}\nTime: ${new Date().toLocaleString()}`
    );

    return interaction.reply({
      content: `✅ Unblacklisted: ${member.user.tag}`,
      ephemeral: true
    });
  }
});

client.login(process.env.TOKEN);
