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

/* ================= DB ================= */
function load() {
  if (!fs.existsSync(FILE)) {
    return {
      blacklist: {},
      warnings: {},
      timeouts: {},
      history: {},
      allowedRoles: [],
      allowedUsers: []
    };
  }
  return JSON.parse(fs.readFileSync(FILE));
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

/* ================= PERMISSION SYSTEM ================= */
function hasPerm(member) {
  const data = load();

  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (data.allowedUsers.includes(member.id)) return true;
  if (member.roles.cache.some(r => data.allowedRoles.includes(r.id))) return true;

  return false;
}

/* ================= SETUP ================= */
async function setup(guild) {

  let role = guild.roles.cache.find(r => r.name === 'Blacklisted');

  if (!role) {
    role = await guild.roles.create({
      name: 'Blacklisted',
      permissions: []
    });
  }

  let log = guild.channels.cache.find(c => c.name === 'elysium-blacklist-log');

  if (!log) {
    log = await guild.channels.create({
      name: 'elysium-blacklist-log',
      type: ChannelType.GuildText
    });
  }

  let room = guild.channels.cache.find(c => c.name === "🚫-you're-blacklisted");

  if (!room) {
    room = await guild.channels.create({
      name: "🚫-you're-blacklisted",
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: role.id, allow: [PermissionsBitField.Flags.ViewChannel] }
      ]
    });

    room.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🚫 ACCESS DENIED")
          .setDescription("You are blacklisted from this server.")
          .setColor("Red")
      ]
    });
  }

  return { role, log, room };
}

/* ================= LOG ================= */
async function logAction(guild, action, member, admin, reason) {

  const { log } = await setup(guild);

  const embed = new EmbedBuilder()
    .setTitle("📛 ELYSIUM BLACKLIST LOG")
    .setColor("Red")
    .setThumbnail(member.user.displayAvatarURL())
    .addFields(
      { name: "User", value: member.user.tag, inline: true },
      { name: "By", value: admin.user.tag, inline: true },
      { name: "Action", value: action, inline: true },
      { name: "Reason", value: reason || "None", inline: true },
      { name: "Time", value: new Date().toLocaleString(), inline: true }
    )
    .setTimestamp();

  log.send({ embeds: [embed] });
}

/* ================= PROFILE ================= */
function profile(data, member) {

  const warns = data.warnings[member.id] || 0;
  const timeouts = data.timeouts[member.id] || 0;
  const bl = data.blacklist[member.id];
  const history = data.history[member.id] || [];

  return new EmbedBuilder()
    .setTitle("👤 PROFILE DASHBOARD")
    .setColor(bl ? "Red" : "Green")
    .setThumbnail(member.user.displayAvatarURL())
    .addFields(
      { name: "User", value: member.user.tag, inline: true },
      { name: "ID", value: member.id, inline: true },
      { name: "Joined", value: member.joinedAt?.toLocaleString() || "Unknown", inline: true },
      { name: "Created", value: member.user.createdAt.toLocaleString(), inline: true },

      { name: "Blacklist", value: bl ? "YES" : "NO", inline: true },
      { name: "Warnings", value: `${warns}`, inline: true },
      { name: "Timeouts", value: `${timeouts}`, inline: true },

      {
        name: "Last Action",
        value: history.length ? history.slice(-1)[0] : "No history"
      }
    )
    .setTimestamp();
}

/* ================= READY ================= */
client.once('ready', () => {
  console.log(`⚡ SYSTEM ONLINE: ${client.user.tag}`);
});

/* ================= PANEL ================= */
const selected = new Map();

client.on('messageCreate', async (message) => {

  if (message.author.bot) return;

  if (message.content === '!blacklistpanel') {

    if (!hasPerm(message.member))
      return message.reply("❌ No permission");

    const members = await message.guild.members.fetch();

    const options = members
      .filter(m => !m.user.bot)
      .first(25)
      .map(m => ({
        label: `👤 ${m.user.username}`,
        description: `🆔 ${m.id}`,
        value: m.id
      }));

    const select = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('select_user')
        .setPlaceholder('👥 Select user')
        .addOptions(options)
    );

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('blacklist').setLabel('🚫 BLACKLIST').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('unblacklist').setLabel('♻️ UNBLACKLIST').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('profile').setLabel('👤 PROFILE').setStyle(ButtonStyle.Primary)
    );

    const embed = new EmbedBuilder()
      .setTitle("🚨 BLACKLIST PANEL")
      .setDescription("Security Control System")
      .setColor("#ff0000");

    message.reply({ embeds: [embed], components: [select, buttons] });
  }
});

/* ================= INTERACTIONS ================= */
client.on('interactionCreate', async (interaction) => {

  const data = load();

  if (interaction.isStringSelectMenu()) {
    selected.set(interaction.user.id, interaction.values[0]);
    return interaction.reply({ content: "Selected", ephemeral: true });
  }

  if (interaction.isButton()) {

    if (!hasPerm(interaction.member))
      return interaction.reply({ content: "❌ No permission", ephemeral: true });

    const userId = selected.get(interaction.user.id);
    if (!userId)
      return interaction.reply({ content: "Select user first", ephemeral: true });

    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (!member)
      return interaction.reply({ content: "User not found", ephemeral: true });

    /* ================= BLACKLIST CONFIRM ================= */
    if (interaction.customId === 'blacklist') {

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`confirm_${member.id}`)
          .setLabel("🚫 CONFIRM BLACKLIST")
          .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
          .setCustomId('cancel')
          .setLabel("❌ CANCEL")
          .setStyle(ButtonStyle.Secondary)
      );

      return interaction.reply({
        content: `Confirm blacklist for ${member.user.tag}?`,
        components: [row],
        ephemeral: true
      });
    }

    /* CONFIRM */
    if (interaction.customId.startsWith('confirm_')) {

      const id = interaction.customId.split('_')[1];
      const m = await interaction.guild.members.fetch(id);

      const data = load();

      data.blacklist[m.id] = {
        by: interaction.user.id,
        time: Date.now()
      };

      if (!data.history[m.id]) data.history[m.id] = [];
      data.history[m.id].push(`BLACKLISTED by ${interaction.user.tag}`);

      save(data);

      await setup(interaction.guild);
      await logAction(interaction.guild, "BLACKLIST", m, interaction.member, "Confirmed");

      return interaction.update({
        content: `🚫 ${m.user.tag} blacklisted`,
        components: []
      });
    }

    /* CANCEL */
    if (interaction.customId === 'cancel') {
      return interaction.update({
        content: "❌ Cancelled",
        components: []
      });
    }

    /* UNBLACKLIST */
    if (interaction.customId === 'unblacklist') {

      delete data.blacklist[member.id];

      if (!data.history[member.id]) data.history[member.id] = [];
      data.history[member.id].push(`UNBLACKLISTED by ${interaction.user.tag}`);

      save(data);

      await logAction(interaction.guild, "UNBLACKLIST", member, interaction.member, "Manual");

      return interaction.reply({ content: "♻️ Removed", ephemeral: true });
    }

    /* PROFILE */
    if (interaction.customId === 'profile') {

      const embed = profile(data, member);

      return interaction.reply({
        embeds: [embed],
        ephemeral: true
      });
    }
  }
});

client.login(process.env.TOKEN);
