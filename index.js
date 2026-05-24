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

const DB_FILE = './data.json';

/* ================= DB ================= */
function load() {
  if (!fs.existsSync(DB_FILE)) {
    return {
      blacklist: {},
      history: {},
      allowedRoles: [],
      allowedUsers: []
    };
  }
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function save(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

/* ================= PERMS ================= */
function canUse(member) {
  const db = load();
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (db.allowedUsers.includes(member.id)) return true;
  if (member.roles.cache.some(r => db.allowedRoles.includes(r.id))) return true;
  return false;
}

/* ================= SETUP SYSTEM ================= */
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
async function logAction(guild, action, target, admin) {

  const { log } = await setup(guild);

  const embed = new EmbedBuilder()
    .setTitle("📛 BLACKLIST LOG")
    .setColor("Red")
    .addFields(
      { name: "User", value: target.user.tag, inline: true },
      { name: "By", value: admin.user.tag, inline: true },
      { name: "Action", value: action, inline: true },
      { name: "Time", value: new Date().toLocaleString(), inline: true }
    )
    .setTimestamp();

  log.send({ embeds: [embed] });
}

/* ================= APPLY BLACKLIST ================= */
async function apply(member) {

  const { role, room } = await setup(member.guild);
  const db = load();

  await member.roles.add(role);

  // DM
  try {
    await member.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🚫 BLACKLISTED")
          .setColor("Red")
          .setDescription(
            `You are blacklisted from **${member.guild.name}**\n\n` +
            `🚫 تم منعك من السيرفر`
          )
      ]
    });
  } catch {}

  // save history
  if (!db.history[member.id]) db.history[member.id] = [];
  db.history[member.id].push(`BLACKLISTED at ${new Date().toLocaleString()}`);
  save(db);

  // room message
  room.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("🚫 BLACKLISTED USER")
        .setColor("Red")
        .setDescription(`${member.user.tag} has been restricted`)
    ]
  });
}

/* ================= REMOVE ================= */
async function remove(member) {

  const role = member.guild.roles.cache.find(r => r.name === "Blacklisted");
  if (!role) return;

  await member.roles.remove(role);
}

/* ================= PANEL ================= */
const selected = new Map();

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
        .setCustomId("select")
        .setPlaceholder("Select user")
        .addOptions(options)
    );

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("bl").setLabel("🚫 BLACKLIST").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("unbl").setLabel("♻️ UNBLACKLIST").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("profile").setLabel("👤 PROFILE").setStyle(ButtonStyle.Primary)
    );

    const embed = new EmbedBuilder()
      .setTitle("🚨 BLACKLIST PANEL")
      .setColor("Red")
      .setDescription("Security Control System");

    message.reply({ embeds: [embed], components: [menu, buttons] });
  }
});

/* ================= INTERACTIONS ================= */
client.on('interactionCreate', async (interaction) => {

  const db = load();

  if (interaction.isStringSelectMenu()) {
    selected.set(interaction.user.id, interaction.values[0]);
    return interaction.reply({ content: "Selected", ephemeral: true });
  }

  if (interaction.isButton()) {

    if (!canUse(interaction.member))
      return interaction.reply({ content: "No permission", ephemeral: true });

    const id = selected.get(interaction.user.id);
    const member = await interaction.guild.members.fetch(id).catch(() => null);
    if (!member) return;

    /* BLACKLIST */
    if (interaction.customId === "bl") {
      return interaction.reply({
        content: `Confirm blacklist for ${member.user.tag}?`,
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

    /* CONFIRM */
    if (interaction.customId.startsWith("confirm_")) {

      const id = interaction.customId.split("_")[1];
      const m = await interaction.guild.members.fetch(id);

      db.blacklist[m.id] = true;
      save(db);

      await apply(m);
      await logAction(interaction.guild, "BLACKLIST", m, interaction.member);

      return interaction.update({ content: "🚫 Blacklisted", components: [] });
    }

    /* UNBLACKLIST */
    if (interaction.customId === "unbl") {

      delete db.blacklist[member.id];
      save(db);

      await remove(member);
      await logAction(interaction.guild, "UNBLACKLIST", member, interaction.member);

      return interaction.reply({ content: "♻️ Removed", ephemeral: true });
    }

    /* PROFILE */
    if (interaction.customId === "profile") {

      const embed = new EmbedBuilder()
        .setTitle("👤 PROFILE")
        .setColor("Blue")
        .setDescription(
          `User: ${member.user.tag}\n` +
          `Blacklisted: ${db.blacklist[member.id] ? "YES" : "NO"}\n` +
          `History: ${(db.history[member.id] || []).length}`
        );

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
});

/* ================= START ================= */
client.login(process.env.TOKEN);
