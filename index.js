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
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
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

/* ---------- DB ---------- */
function load() {
  if (!fs.existsSync(FILE)) {
    return { blacklist: {}, warnings: {}, history: {} };
  }
  return JSON.parse(fs.readFileSync(FILE));
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

/* ---------- ROLE CHECK (GOD SECURITY) ---------- */
function hasPermission(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

/* ---------- SYSTEM SETUP ---------- */
async function setup(guild) {

  let role = guild.roles.cache.find(r => r.name === 'Blacklisted');

  if (!role) {
    role = await guild.roles.create({
      name: 'Blacklisted',
      permissions: []
    });
  }

  let log = guild.channels.cache.find(c => c.name === 'god-log');

  if (!log) {
    log = await guild.channels.create({
      name: 'god-log',
      type: ChannelType.GuildText
    });
  }

  let blRoom = guild.channels.cache.find(c => c.name === "you're-blacklisted");

  if (!blRoom) {
    blRoom = await guild.channels.create({
      name: "you're-blacklisted",
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: role.id, allow: [PermissionsBitField.Flags.ViewChannel] }
      ]
    });

    blRoom.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🚫 ACCESS DENIED")
          .setDescription("You are blacklisted from this server.")
          .setColor("Red")
      ]
    });
  }

  return { role, log, blRoom };
}

/* ---------- LOG SYSTEM ---------- */
async function logAction(guild, title, member, admin, reason) {
  const { log } = await setup(guild);

  const embed = new EmbedBuilder()
    .setTitle(title)
    .addFields(
      { name: "User", value: `${member.user.tag}` },
      { name: "Admin", value: `${admin.user.tag}` },
      { name: "Reason", value: reason || "None" },
      { name: "Time", value: new Date().toLocaleString() }
    )
    .setColor("Purple")
    .setTimestamp();

  log.send({ embeds: [embed] });
}

/* ---------- APPLY / REMOVE ---------- */
async function apply(member) {
  const { role } = await setup(member.guild);
  if (!member.roles.cache.has(role.id)) await member.roles.add(role);
}

async function remove(member) {
  const role = member.guild.roles.cache.find(r => r.name === 'Blacklisted');
  if (role) await member.roles.remove(role);
}

/* ---------- READY ---------- */
client.once('ready', () => {
  console.log(`⚡ GOD MODE ACTIVE: ${client.user.tag}`);
});

/* ---------- PANEL ---------- */
const selected = new Map();

client.on('messageCreate', async (message) => {

  if (message.author.bot) return;

  if (message.content === '!panel') {

    if (!hasPermission(message.member))
      return message.reply("No permission");

    const members = await message.guild.members.fetch();

    const options = members
      .filter(m => !m.user.bot)
      .first(25)
      .map(m => ({
        label: m.user.username,
        description: m.user.id,
        value: m.id
      }));

    const select = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('select')
        .setPlaceholder('Select user')
        .addOptions(options)
    );

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('blacklist').setLabel('🚫 BL').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('unblacklist').setLabel('✅ UNBL').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('warn').setLabel('⚠️ Warn').setStyle(ButtonStyle.Secondary)
    );

    const embed = new EmbedBuilder()
      .setTitle("⚡ GOD MODE PANEL")
      .setColor("Purple");

    message.reply({ embeds: [embed], components: [select, buttons] });
  }
});

/* ---------- INTERACTIONS ---------- */
client.on('interactionCreate', async (interaction) => {

  const data = load();

  if (interaction.isStringSelectMenu()) {
    selected.set(interaction.user.id, interaction.values[0]);
    return interaction.reply({ content: "Selected", ephemeral: true });
  }

  if (interaction.isButton()) {

    if (!hasPermission(interaction.member))
      return interaction.reply({ content: "No permission", ephemeral: true });

    const userId = selected.get(interaction.user.id);
    if (!userId)
      return interaction.reply({ content: "Select user first", ephemeral: true });

    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (!member)
      return interaction.reply({ content: "Not found", ephemeral: true });

    /* BLACKLIST */
    if (interaction.customId === 'blacklist') {

      data.blacklist[member.id] = Date.now();
      save(data);

      await apply(member);
      await logAction(interaction.guild, "BLACKLISTED", member, interaction.member, "Manual");

      return interaction.reply({ content: "🚫 Done", ephemeral: true });
    }

    /* UNBLACKLIST */
    if (interaction.customId === 'unblacklist') {

      const modal = new ModalBuilder()
        .setCustomId('unbl')
        .setTitle('Unblacklist Reason');

      const input = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Reason')
        .setStyle(TextInputStyle.Paragraph);

      modal.addComponents(new ActionRowBuilder().addComponents(input));

      return interaction.showModal(modal);
    }

    /* WARN */
    if (interaction.customId === 'warn') {

      if (!data.warnings[member.id]) data.warnings[member.id] = 0;
      data.warnings[member.id]++;

      save(data);

      await logAction(interaction.guild, "WARNING ADDED", member, interaction.member, "Warned");

      return interaction.reply({ content: "⚠️ Warned", ephemeral: true });
    }
  }

  /* MODAL */
  if (interaction.isModalSubmit()) {

    const reason = interaction.fields.getTextInputValue('reason');
    const userId = selected.get(interaction.user.id);

    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    delete data.blacklist[member.id];
    save(data);

    await remove(member);
    await logAction(interaction.guild, "UNBLACKLISTED", member, interaction.member, reason);

    return interaction.reply({ content: "Done", ephemeral: true });
  }
});

client.login(process.env.TOKEN);
