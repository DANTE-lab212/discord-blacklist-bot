require("dotenv").config();

// --- الإضافة الخاصة بـ Render وأي استضافة لفتح المنفذ (Port) ---
const express = require("express");
const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || "0.0.0.0";
app.get("/", (req, res) => res.send("Bot is active and running on Host!"));
app.listen(port, host, () => console.log(`✅ Web server is listening on ${host}:${port}`));
// ---------------------------------------------------------------

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const fs = require("fs");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const DB_FILE = "./data.json";

function loadDB() {
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

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

const selectedUser = new Map();

function getBlacklistRole(guild) {
  return guild.roles.cache.find(
    r => r.name.toLowerCase() === "blacklisted"
  );
}

function getLogChannel(guild) {
  return guild.channels.cache.find(
    c => c.name.toLowerCase() === "blacklist-log"
  );
}

function canUse(member) {
  const db = loadDB();
  if (!member) return false;

  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return true;
  }
  if (db.allowedUsers.includes(member.id)) {
    return true;
  }
  if (member.roles.cache.some(r => db.allowedRoles.includes(r.id))) {
    return true;
  }
  return false;
}

async function sendLog(guild, type, member, admin, reason) {
  const logChannel = getLogChannel(guild);
  if (!logChannel) return;

  const db = loadDB();
  const warns = db.warnings[member.id]?.length || 0;
  const timeouts = db.timeouts[member.id]?.length || 0;

  const embed = new EmbedBuilder()
    .setColor(type === "BL" ? "Red" : "Green")
    .setTitle(type === "BL" ? "🚫 USER BLACKLISTED" : "♻️ USER UNBLACKLISTED")
    .setThumbnail(member.user.displayAvatarURL())
    .addFields(
      { name: "👤 User", value: `${member.user.tag}`, inline: true },
      { name: "🆔 ID", value: member.id, inline: true },
      { name: "👮 Staff", value: admin.tag, inline: true },
      { name: "📝 Reason", value: reason || "No reason", inline: false },
      { name: "⚠️ Warnings", value: `${warns}`, inline: true },
      { name: "⏳ Timeouts", value: `${timeouts}`, inline: true },
      { name: "📅 Account Created", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: false },
      { name: "📥 Joined Server", value: member.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>` : "Unknown", inline: false }
    )
    .setFooter({ text: "Ultimate Blacklist System" })
    .setTimestamp();

  logChannel.send({ embeds: [embed] });
}

async function applyBlacklist(member, admin, reason) {
  const db = loadDB();
  const role = getBlacklistRole(member.guild);

  if (!role) {
    return admin.send("❌ Blacklisted role not found.").catch(() => {});
  }

  await member.roles.set([role]).catch(() => {});

  db.blacklist[member.id] = { reason, by: admin.id, time: Date.now() };
  if (!db.history[member.id]) db.history[member.id] = [];
  
  db.history[member.id].push({ type: "BLACKLIST", reason, by: admin.id, time: Date.now() });
  saveDB(db);

  try {
    await member.send({
      embeds: [
        new EmbedBuilder()
          .setColor("Red")
          .setTitle("🚫 ACCESS DENIED")
          .setDescription(`You are blacklisted from **${member.guild.name}**.\n\n📝 Reason: ${reason}`)
      ]
    });
  } catch {}

  await sendLog(member.guild, "BL", member, admin.user, reason);
}

async function removeBlacklist(member, admin, reason) {
  const db = loadDB();
  const role = getBlacklistRole(member.guild);

  delete db.blacklist[member.id];
  saveDB(db);

  if (role) await member.roles.remove(role).catch(() => {});

  try {
    await member.send({
      embeds: [
        new EmbedBuilder()
          .setColor("Green")
          .setTitle("♻️ BLACKLIST REMOVED")
          .setDescription(`Your blacklist was removed.\n\n📝 Reason: ${reason}`)
      ]
    });
  } catch {}

  await sendLog(member.guild, "UNBL", member, admin.user, reason);
}

client.on("guildMemberAdd", async (member) => {
  const db = loadDB();
  if (db.blacklist[member.id]) {
    const role = getBlacklistRole(member.guild);
    if (role) await member.roles.set([role]).catch(() => {});

    const logChannel = getLogChannel(member.guild);
    if (logChannel) {
      const embed = new EmbedBuilder()
        .setColor("Orange")
        .setTitle("⚠️ محاولة تحايل وتخطي البلاك ليست")
        .setDescription(`العضو **${member.user.tag}** حاول الدخول إلى السيرفر مجدداً وهو مدرج في قائمة البلاك ليست!`)
        .addFields(
          { name: "👤 المستخدم", value: `${member.user.tag}`, inline: true },
          { name: "🆔 المعرف", value: `${member.id}`, inline: true },
          { name: "⚙️ الإجراء المتبع", value: "تمت إعادة سحب الرتب وفرض رتبة البلاك ليست تلقائياً.", inline: false }
        )
        .setThumbnail(member.user.displayAvatarURL())
        .setFooter({ text: "Ultimate Blacklist System" })
        .setTimestamp();
      logChannel.send({ embeds: [embed] });
    }
  }
});

client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot) return;

  const db = loadDB();
  if (db.blacklist[message.author.id]) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      await message.delete().catch(() => {});
      return;
    }
  }

  if (message.content !== "!panel") return;
  if (!canUse(message.member)) return message.reply("❌ No permission");

  const userMenu = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId("select_user")
      .setPlaceholder("Select User (Search active)")
  );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("blacklist")
      .setLabel("🚫 BLACKLIST")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("unblacklist")
      .setLabel("♻️ UNBLACKLIST")
      .setStyle(ButtonStyle.Success)
  );

  const embed = new EmbedBuilder()
    .setColor("Red")
    .setTitle("🚫 BLACKLIST PANEL")
    .setDescription("Advanced moderation system");

  const panelMsg = await message.channel.send({
    embeds: [embed],
    components: [userMenu, buttons]
  });

  setTimeout(() => {
    panelMsg.delete().catch(() => {});
  }, 60000);
});

client.on("interactionCreate", async interaction => {
  if (!canUse(interaction.member)) {
    return interaction.reply({ content: "❌ No permission", ephemeral: true });
  }

  if (interaction.isUserSelectMenu()) {
    if (interaction.customId === "select_user") {
      const targetUserId = interaction.values[0];
      selectedUser.set(interaction.user.id, targetUserId);

      setTimeout(() => {
        if (selectedUser.get(interaction.user.id) === targetUserId) {
          selectedUser.delete(interaction.user.id);
        }
      }, 60000);

      const member = await interaction.guild.members.fetch(targetUserId).catch(() => null);
      if (!member) return interaction.reply({ content: "❌ User not found", ephemeral: true });

      const db = loadDB();
      const warns = db.warnings[member.id]?.length || 0;
      const timeouts = db.timeouts[member.id]?.length || 0;

      const profileEmbed = new EmbedBuilder()
        .setColor("#2b2d31")
        .setTitle(`ملف العضو: ${member.user.tag}`)
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
          { name: "🆔 ID", value: `${member.id}`, inline: true },
          { name: "📅 إنشاء الحساب", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: "📥 دخول السيرفر", value: member.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>` : "غير معروف", inline: true },
          { name: "⚠️ تحذيرات", value: `${warns}`, inline: true },
          { name: "⏳ تايم أوت", value: `${timeouts}`, inline: true }
        );

      return interaction.reply({
        content: "✅ **تم اختيار العضو بنجاح. راجع بياناته قبل اتخاذ العقوبة:**",
        embeds: [profileEmbed],
        ephemeral: true
      });
    }
  }

  if (interaction.isButton()) {
    const selected = selectedUser.get(interaction.user.id);
    if (!selected) return interaction.reply({ content: "❌ Select user first or time expired (1 Min)", ephemeral: true });

    const member = await interaction.guild.members.fetch(selected).catch(() => null);
    if (!member) return interaction.reply({ content: "❌ User not found", ephemeral: true });

    if (interaction.customId === "blacklist") {
      return interaction.reply({
        ephemeral: true,
        embeds: [
          new EmbedBuilder()
            .setColor("Red")
            .setTitle("⚠️ CONFIRM BLACKLIST")
            .setDescription(`Blacklist ${member.user.tag}?`)
        ],
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

    if (interaction.customId.startsWith("confirm_bl_")) {
      const targetId = interaction.customId.split("_")[2];
      const modal = new ModalBuilder()
        .setCustomId(`blacklist_modal_${targetId}`)
        .setTitle("نظام العقوبات - إضافة سبب");

      const reasonInput = new TextInputBuilder()
        .setCustomId("reason_input")
        .setLabel("ما هو سبب البلاك ليست؟")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("اكتب السبب بالتفصيل هنا...")
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      return interaction.showModal(modal);
    }

    if (interaction.customId === "unblacklist") {
      await removeBlacklist(member, interaction.member, "Blacklist removed");
      selectedUser.delete(interaction.user.id);
      return interaction.reply({ content: `♻️ ${member.user.tag} unblacklisted`, ephemeral: true });
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith("blacklist_modal_")) {
      const targetId = interaction.customId.split("_")[2];
      const reason = interaction.fields.getTextInputValue("reason_input");

      const member = await interaction.guild.members.fetch(targetId).catch(() => null);
      if (!member) return interaction.reply({ content: "❌ User not found", ephemeral: true });

      await applyBlacklist(member, interaction.member, reason);
      selectedUser.delete(interaction.user.id);

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor("Red")
            .setDescription(`🚫 ${member.user.tag} blacklisted successfully.`)
        ],
        ephemeral: true
      });
    }
  }S
});

client.on("ready", () => {
  console.log(`${client.user.tag} online`);
});

client.login(process.env.TOKEN);