require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder
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
    return { blacklist: {}, allowedUsers: [], allowedRoles: [] };
  }
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function save(d) {
  fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2));
}

/* ================= STATE ================= */
const selectedUser = new Map();

/* ================= SETUP ================= */
function getSetup(guild) {

  const role = guild.roles.cache.find(r =>
    r.name.toLowerCase() === "blacklisted"
  );

  const room = guild.channels.cache.find(c =>
    c.name.toLowerCase().includes("blacklist")
  );

  const log = guild.channels.cache.find(c =>
    c.name.toLowerCase().includes("log")
  );

  return { role, room, log };
}

/* ================= PERMISSION ================= */
function canUse(member) {
  const db = load();

  if (!member) return false;

  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    db.allowedUsers.includes(member.id) ||
    member.roles.cache.some(r => db.allowedRoles.includes(r.id))
  );
}

/* ================= LOG ================= */
async function logAction(guild, type, member, admin, reason) {

  const { log } = getSetup(guild);
  if (!log) return;

  const embed = new EmbedBuilder()
    .setTitle(type === "BL" ? "🚫 BLACKLISTED" : "♻️ UNBLACKLISTED")
    .setColor(type === "BL" ? "Red" : "Green")
    .setThumbnail(member.user.displayAvatarURL())
    .addFields(
      { name: "User", value: member.user.tag, inline: true },
      { name: "ID", value: member.id, inline: true },
      { name: "By", value: admin.user.tag, inline: true },
      { name: "Reason", value: reason || "None", inline: false },
      { name: "Account Created", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` },
      { name: "Joined Server", value: member.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>` : "Unknown" }
    )
    .setTimestamp();

  log.send({ embeds: [embed] });
}

/* ================= BLACKLIST APPLY ================= */
async function applyBlacklist(member, reason) {

  const db = load();
  const { role } = getSetup(member.guild);

  if (!role) return;

  /* remove all roles */
  await member.roles.set([role]).catch(() => {});

  db.blacklist[member.id] = {
    reason,
    time: Date.now()
  };

  save(db);

  /* DM */
  try {
    await member.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🚫 BLACKLISTED")
          .setColor("Red")
          .setDescription(
            `You are blacklisted.\n\nReason: ${reason}`
          )
      ]
    });
  } catch {}
}

/* ================= UNBLACKLIST ================= */
async function removeBlacklist(member) {

  const db = load();
  const { role } = getSetup(member.guild);

  delete db.blacklist[member.id];
  save(db);

  if (role) {
    await member.roles.remove(role).catch(() => {});
  }
}

/* ================= PANEL ================= */
client.on("messageCreate", async (message) => {

  if (message.author.bot) return;

  if (message.content !== "!panel") return;

  if (!canUse(message.member))
    return message.reply("❌ No permission");

  const members = await message.guild.members.fetch();

  const options = members
    .filter(m => !m.user.bot)
    .map(m => ({
      label: m.user.username.slice(0, 25),
      value: m.id
    }))
    .slice(0, 25);

  const menu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("user")
      .setPlaceholder("Select user")
      .addOptions(options)
  );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("bl")
      .setLabel("🚫 BLACKLIST")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId("unbl")
      .setLabel("♻️ UNBLACKLIST")
      .setStyle(ButtonStyle.Success)
  );

  message.channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("BLACKLIST PANEL")
        .setColor("Red")
    ],
    components: [menu, buttons]
  });
});

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async (interaction) => {

  if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

  const uid = selectedUser.get(interaction.user.id);

  if (interaction.isStringSelectMenu()) {

    if (interaction.customId === "user") {
      selectedUser.set(interaction.user.id, interaction.values[0]);

      return interaction.reply({
        content: "User selected",
        ephemeral: true
      });
    }
  }

  const member = uid
    ? await interaction.guild.members.fetch(uid).catch(() => null)
    : null;

  if (!member)
    return interaction.reply({ content: "Select user first", ephemeral: true });

  /* ================= BLACKLIST CONFIRM ================= */
  if (interaction.customId === "bl") {

    return interaction.reply({
      content: `⚠️ Confirm blacklist for **${member.user.tag}**?`,
      ephemeral: true,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`confirm_bl_${member.id}`)
            .setLabel("CONFIRM")
            .setStyle(ButtonStyle.Danger)
        )
      ]
    });
  }

  /* ================= CONFIRM ACTION ================= */
  if (interaction.customId.startsWith("confirm_bl_")) {

    const reason = "No reason set";

    await applyBlacklist(member, reason);
    await logAction(interaction.guild, "BL", member, interaction.user, reason);

    return interaction.update({
      content: "🚫 Blacklisted successfully",
      components: []
    });
  }

  /* ================= UNBLACKLIST ================= */
  if (interaction.customId === "unbl") {

    await removeBlacklist(member);
    await logAction(interaction.guild, "UNBL", member, interaction.user, "Removed");

    return interaction.reply({
      content: "♻️ Unblacklisted",
      ephemeral: true
    });
  }
});

/* ================= READY ================= */
client.on("ready", () => {
  console.log(`${client.user.tag} online`);
});

/* ================= LOGIN ================= */
client.login(process.env.TOKEN);
