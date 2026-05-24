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

const DB = './data.json';

/* ================= DATABASE ================= */
function load() {
  if (!fs.existsSync(DB)) {
    return {
      blacklist: {},
      warnings: {},
      timeouts: {},
      history: {}
    };
  }
  return JSON.parse(fs.readFileSync(DB));
}

function save(data) {
  fs.writeFileSync(DB, JSON.stringify(data, null, 2));
}

/* ================= PERMISSIONS ================= */
function canUse(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

/* ================= SETUP ================= */
async function setup(guild) {

  let role = guild.roles.cache.find(r => r.name === "Blacklisted");

  if (!role) {
    role = await guild.roles.create({
      name: "Blacklisted",
      permissions: []
    });
  }

  let room = guild.channels.cache.find(c => c.name === "🚫-BLACKLISTED");

  if (!room) {
    room = await guild.channels.create({
      name: "🚫-BLACKLISTED",
      type: ChannelType.GuildText,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionsBitField.Flags.ViewChannel]
        },
        {
          id: role.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages
          ]
        }
      ]
    });
  }

  let log = guild.channels.cache.find(c => c.name === "blacklist-log");

  if (!log) {
    log = await guild.channels.create({
      name: "blacklist-log",
      type: ChannelType.GuildText
    });
  }

  return { role, room, log };
}

/* ================= LOG ================= */
async function logAction(guild, action, member, admin, reason) {

  const { log } = await setup(guild);

  const embed = new EmbedBuilder()
    .setTitle("📛 BLACKLIST LOG")
    .setColor("Red")
    .addFields(
      { name: "User", value: member.user.tag, inline: true },
      { name: "By", value: admin.user.tag, inline: true },
      { name: "Action", value: action, inline: true },
      { name: "Reason", value: reason || "None", inline: true }
    )
    .setTimestamp();

  log.send({ embeds: [embed] });
}

/* ================= APPLY BLACKLIST ================= */
async function apply(member, reason, duration) {

  const { role, room } = await setup(member.guild);
  const db = load();

  await member.roles.add(role);

  let expiry = null;

  if (duration !== "perma") {
    expiry = Date.now() + Number(duration);
  }

  db.blacklist[member.id] = {
    reason,
    expires: expiry
  };

  if (!db.history[member.id]) db.history[member.id] = [];
  db.history[member.id].push(`BLACKLISTED | ${reason}`);

  save(db);

  /* ================= DM ================= */
  try {
    await member.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🚫 BLACKLISTED")
          .setColor("Red")
          .setDescription(
            `You are blacklisted from **${member.guild.name}**\n\n` +
            `📝 Reason: ${reason}\n` +
            `⏳ Duration: ${duration === "perma" ? "Permanent" : "Temporary"}`
          )
      ]
    });
  } catch {}

  /* ================= ROOM ================= */
  room.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("🚫 USER BLACKLISTED")
        .setColor("Red")
        .setDescription(
          `${member.user.tag}\n\n` +
          `📝 Reason: ${reason}\n` +
          `⏳ Duration: ${duration === "perma" ? "Permanent" : duration}`
        )
    ]
  });
}

/* ================= AUTO EXPIRE ================= */
setInterval(async () => {

  const db = load();

  for (const id in db.blacklist) {

    const data = db.blacklist[id];

    if (data.expires && Date.now() > data.expires) {

      for (const guild of client.guilds.cache.values()) {

        const member = await guild.members.fetch(id).catch(() => null);
        if (!member) continue;

        const role = guild.roles.cache.find(r => r.name === "Blacklisted");
        if (role) await member.roles.remove(role);
      }

      delete db.blacklist[id];
    }
  }

  save(db);

}, 60000);

/* ================= PANEL ================= */
const selected = new Map();
const selectedDuration = new Map();

client.on('messageCreate', async (message) => {

  if (message.author.bot) return;

  if (message.content === "!panel") {

    if (!canUse(message.member)) return;

    const members = await message.guild.members.fetch();

    const options = members
      .filter(m => !m.user.bot)
      .first(25)
      .map(m => ({
        label: `👤 ${m.user.username}`,
        value: m.id,
        description: m.id
      }));

    const menu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("user")
        .setPlaceholder("Select user")
        .addOptions(options)
    );

    const duration = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("duration")
        .setPlaceholder("Select duration")
        .addOptions([
          { label: "1 Hour", value: "3600000" },
          { label: "2 Hours", value: "7200000" },
          { label: "4 Hours", value: "14400000" },
          { label: "10 Hours", value: "36000000" },
          { label: "1 Day", value: "86400000" },
          { label: "1 Week", value: "604800000" },
          { label: "1 Month", value: "2592000000" },
          { label: "Permanent", value: "perma" }
        ])
    );

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("bl").setLabel("🚫 BLACKLIST").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("unbl").setLabel("♻️ UNBLACKLIST").setStyle(ButtonStyle.Success)
    );

    const embed = new EmbedBuilder()
      .setTitle("🚨 BLACKLIST PANEL")
      .setColor("Red")
      .setDescription("Elite Control System");

    message.reply({
      embeds: [embed],
      components: [menu, duration, buttons]
    });
  }
});

/* ================= INTERACTIONS ================= */
client.on('interactionCreate', async (interaction) => {

  const db = load();

  if (interaction.isStringSelectMenu()) {

    if (interaction.customId === "user") {
      selected.set(interaction.user.id, interaction.values[0]);
      return interaction.reply({ content: "User selected", ephemeral: true });
    }

    if (interaction.customId === "duration") {
      selectedDuration.set(interaction.user.id, interaction.values[0]);
      return interaction.reply({ content: "Duration selected", ephemeral: true });
    }
  }

  if (interaction.isButton()) {

    if (!canUse(interaction.member))
      return interaction.reply({ content: "No permission", ephemeral: true });

    const id = selected.get(interaction.user.id);
    const duration = selectedDuration.get(interaction.user.id) || "perma";

    const member = await interaction.guild.members.fetch(id).catch(() => null);
    if (!member) return;

    if (interaction.customId === "bl") {

      const reason = "No reason set";

      await apply(member, reason, duration);
      await logAction(interaction.guild, "BLACKLIST", member, interaction.member, reason);

      return interaction.reply({ content: "🚫 Blacklisted", ephemeral: true });
    }

    if (interaction.customId === "unbl") {

      delete db.blacklist[member.id];
      save(db);

      const role = interaction.guild.roles.cache.find(r => r.name === "Blacklisted");
      if (role) await member.roles.remove(role);

      await logAction(interaction.guild, "UNBLACKLIST", member, interaction.member);

      return interaction.reply({ content: "♻️ Removed", ephemeral: true });
    }
  }
});

client.login(process.env.TOKEN);
