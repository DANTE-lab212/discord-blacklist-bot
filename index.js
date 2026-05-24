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
    return { allowedUsers: [], allowedRoles: [] };
  }
  return JSON.parse(fs.readFileSync(DB_FILE));
}

/* ================= CHECK PERMISSION ================= */
function canUse(member) {
  const db = load();

  if (!member) return false;

  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    db.allowedUsers.includes(member.id) ||
    member.roles.cache.some(r => db.allowedRoles.includes(r.id))
  );
}

/* ================= SELECTED USER ================= */
const selectedUser = new Map();

/* ================= PANEL COMMAND ================= */
client.on("messageCreate", async (message) => {

  if (!message.guild) return;
  if (message.author.bot) return;

  console.log("message received:", message.content); // للتأكد

  if (message.content.trim() !== "!panel") return;

  if (!canUse(message.member))
    return message.reply("❌ No permission");

  await message.guild.members.fetch();

  const members = message.guild.members.cache
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
      .addOptions(members)
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

  const embed = new EmbedBuilder()
    .setTitle("BLACKLIST PANEL")
    .setColor("Red")
    .setDescription("Control Panel Loaded");

  message.channel.send({
    embeds: [embed],
    components: [menu, buttons]
  });
});

/* ================= INTERACTIONS ================= */
client.on("interactionCreate", async (interaction) => {

  if (!interaction.isStringSelectMenu() && !interaction.isButton()) return;

  if (interaction.isStringSelectMenu()) {

    if (interaction.customId === "user") {
      selectedUser.set(interaction.user.id, interaction.values[0]);

      return interaction.reply({
        content: `User selected`,
        ephemeral: true
      });
    }
  }

  if (interaction.isButton()) {

    const uid = selectedUser.get(interaction.user.id);

    if (!uid)
      return interaction.reply({
        content: "Select a user first",
        ephemeral: true
      });

    const member = await interaction.guild.members.fetch(uid).catch(() => null);

    if (!member)
      return interaction.reply({
        content: "User not found",
        ephemeral: true
      });

    /* BLACKLIST */
    if (interaction.customId === "bl") {

      const role = interaction.guild.roles.cache.find(r => r.name === "Blacklisted");

      if (!role)
        return interaction.reply({
          content: "Blacklisted role not found",
          ephemeral: true
        });

      await member.roles.set([role]).catch(() => {});

      return interaction.reply({
        content: `🚫 ${member.user.tag} blacklisted`,
        ephemeral: true
      });
    }

    /* UNBLACKLIST */
    if (interaction.customId === "unbl") {

      const role = interaction.guild.roles.cache.find(r => r.name === "Blacklisted");

      if (role) {
        await member.roles.remove(role).catch(() => {});
      }

      return interaction.reply({
        content: `♻️ ${member.user.tag} unblacklisted`,
        ephemeral: true
      });
    }
  }
});

/* ================= LOGIN ================= */
client.login(process.env.TOKEN);
