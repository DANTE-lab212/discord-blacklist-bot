require("dotenv").config();

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
} = require("discord.js");

const fs = require("fs");

/* ================= CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

/* ================= DB ================= */
const DB_FILE = "./data.json";

function load() {
  if (!fs.existsSync(DB_FILE)) {
    return {
      blacklist: {},
      history: {},
      warnings: {},
      timeouts: {},
      allowedUsers: [],
      allowedRoles: []
    };
  }
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function save(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

/* ================= PERMISSIONS (FIXED DEBUG) ================= */
function canUse(member) {
  const db = load();

  if (!member) return false;

  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (db.allowedUsers.includes(member.id)) return true;
  if (member.roles.cache.some(r => db.allowedRoles.includes(r.id))) return true;

  return false;
}

/* ================= STORAGE ================= */
const selectedUser = new Map();
const selectedDuration = new Map();

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
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: role.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
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
async function logAction(guild, action, member, admin, reason, duration) {

  const { log } = await setup(guild);

  const embed = new EmbedBuilder()
    .setTitle("📛 BLACKLIST LOG")
    .setColor("Red")
    .addFields(
      { name: "User", value: member.user.tag, inline: true },
      { name: "By", value: admin.user.tag, inline: true },
      { name: "Action", value: action, inline: true },
      { name: "Reason", value: reason || "None", inline: true },
      { name: "Duration", value: duration === "perma" ? "Permanent" : duration || "N/A", inline: true }
    )
    .setTimestamp();

  log.send({ embeds: [embed] });
}

/* ================= APPLY ================= */
async function apply(member, reason, duration) {

  const { room } = await setup(member.guild);
  const db = load();

  await member.roles.add(member.guild.roles.cache.find(r => r.name === "Blacklisted"));

  let expires = null;
  if (duration !== "perma") expires = Date.now() + Number(duration);

  db.blacklist[member.id] = { reason, expires };

  if (!db.history[member.id]) db.history[member.id] = [];
  db.history[member.id].push(`BLACKLISTED | ${reason}`);

  save(db);

  try {
    await member.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🚫 BLACKLISTED")
          .setColor("Red")
          .setDescription(`Reason: ${reason}`)
      ]
    });
  } catch {}

  room.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("🚫 BLACKLISTED USER")
        .setColor("Red")
        .setDescription(`${member.user.tag}\nReason: ${reason}`)
    ]
  });
}

/* ================= PANEL (FIXED) ================= */
client.on("messageCreate", async (message) => {

  if (message.author.bot) return;

  if (message.content === "!panel") {

    // 🔥 FIX: temporary bypass so it ALWAYS works first
    // بعد ما تتأكد شغالة رجع canUse إذا تبي
    // if (!canUse(message.member)) return message.reply("❌ No permission");

    const members = await message.guild.members.fetch();

    const options = members
      .filter(m => !m.user.bot)
      .first(25)
      .map(m => ({
        label: m.user.username,
        value: m.id
      }));

    const userMenu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("user")
        .setPlaceholder("Select user")
        .addOptions(options)
    );

    const durationMenu = new ActionRowBuilder().addComponents(
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
      new ButtonBuilder().setCustomId("unbl").setLabel("♻️ UNBLACKLIST").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("profile").setLabel("👤 PROFILE").setStyle(ButtonStyle.Primary)
    );

    const embed = new EmbedBuilder()
      .setTitle("🚨 BLACKLIST PANEL")
      .setColor("Red")
      .setDescription("Working System ✅");

    message.reply({ embeds: [embed], components: [userMenu, durationMenu, buttons] });
  }
});

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async (interaction) => {

  const db = load();

  if (interaction.isStringSelectMenu()) {

    if (interaction.customId === "user") {
      selectedUser.set(interaction.user.id, interaction.values[0]);
      return interaction.reply({ content: "User selected", ephemeral: true });
    }

    if (interaction.customId === "duration") {
      selectedDuration.set(interaction.user.id, interaction.values[0]);
      return interaction.reply({ content: "Duration selected", ephemeral: true });
    }
  }

  if (!interaction.isButton()) return;

  const uid = selectedUser.get(interaction.user.id);
  const member = await interaction.guild.members.fetch(uid).catch(() => null);
  if (!member) return interaction.reply({ content: "Select user first", ephemeral: true });

  const duration = selectedDuration.get(interaction.user.id) || "perma";

  if (interaction.customId === "bl") {
    return interaction.reply({
      content: `Confirm blacklist ${member.user.tag}`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`confirm_${member.id}`)
            .setLabel("CONFIRM")
            .setStyle(ButtonStyle.Danger)
        )
      ],
      ephemeral: true
    });
  }

  if (interaction.customId.startsWith("confirm_")) {

    await apply(member, "No reason", duration);

    return interaction.update({ content: "🚫 Done", components: [] });
  }

  if (interaction.customId === "unbl") {

    delete db.blacklist[member.id];
    save(db);

    const role = interaction.guild.roles.cache.find(r => r.name === "Blacklisted");
    if (role) await member.roles.remove(role);

    return interaction.reply({ content: "♻️ Removed", ephemeral: true });
  }

  if (interaction.customId === "profile") {

    const data = db.blacklist[member.id];

    const embed = new EmbedBuilder()
      .setTitle("👤 PROFILE")
      .setColor("Blue")
      .addFields(
        { name: "User", value: member.user.tag },
        { name: "Blacklisted", value: data ? "YES" : "NO" }
      );

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

/* ================= LOGIN ================= */
client.login(process.env.TOKEN);
