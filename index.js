require("dotenv").config();

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

/* ================= CLIENT ================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

/* ================= DATABASE ================= */

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

/* ================= TEMP ================= */

const selectedUser = new Map();

/* ================= SETUP ================= */

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

/* ================= PERMISSIONS ================= */

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

/* ================= LOG SYSTEM ================= */

async function sendLog(guild, type, member, admin, reason) {
  const logChannel = getLogChannel(guild);
  if (!logChannel) return;

  const db = loadDB();
  const warns = db.warnings[member.id]?.length || 0;
  const timeouts = db.timeouts[member.id]?.length || 0;

  const embed = new EmbedBuilder()
    .setColor(type === "BL" ? "Red" : "Green")
    .setTitle(
      type === "BL"
        ? "🚫 USER BLACKLISTED"
        : "♻️ USER UNBLACKLISTED"
    )
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

/* ================= APPLY BLACKLIST ================= */

async function applyBlacklist(member, admin, reason) {
  const db = loadDB();
  const role = getBlacklistRole(member.guild);

  if (!role) {
    return admin.send("❌ Blacklisted role not found.").catch(() => {});
  }

  /* remove all roles and set blacklist role */
  await member.roles.set([role]).catch(() => {});

  /* save to database */
  db.blacklist[member.id] = {
    reason,
    by: admin.id,
    time: Date.now()
  };

  if (!db.history[member.id]) {
    db.history[member.id] = [];
  }

  db.history[member.id].push({
    type: "BLACKLIST",
    reason,
    by: admin.id,
    time: Date.now()
  });

  saveDB(db);

  /* Send DM to the user */
  try {
    await member.send({
      embeds: [
        new EmbedBuilder()
          .setColor("Red")
          .setTitle("🚫 ACCESS DENIED")
          .setDescription(
            `You are blacklisted from **${member.guild.name}**.\n\n` +
            `📝 Reason: ${reason}`
          )
      ]
    });
  } catch {}

  /* Send to log channel */
  await sendLog(member.guild, "BL", member, admin.user, reason);
}

/* ================= REMOVE BLACKLIST ================= */

async function removeBlacklist(member, admin, reason) {
  const db = loadDB();
  const role = getBlacklistRole(member.guild);

  delete db.blacklist[member.id];
  saveDB(db);

  if (role) {
    await member.roles.remove(role).catch(() => {});
  }

  try {
    await member.send({
      embeds: [
        new EmbedBuilder()
          .setColor("Green")
          .setTitle("♻️ BLACKLIST REMOVED")
          .setDescription(
            `Your blacklist was removed.\n\n` +
            `📝 Reason: ${reason}`
          )
      ]
    });
  } catch {}

  await sendLog(member.guild, "UNBL", member, admin.user, reason);
}

/* ================= EVENT: GUILD MEMBER ADD (ANTI-EVASION) ================= */

client.on("guildMemberAdd", async (member) => {
  const db = loadDB();

  // التحقق التلقائي إذا كان العضو موجوداً في البلاك ليست عند دخوله
  if (db.blacklist[member.id]) {
    const role = getBlacklistRole(member.guild);
    if (role) {
      await member.roles.set([role]).catch(() => {});
    }

    // إرسال لوق التنبيه بمحاولة التحايل
    const logChannel = getLogChannel(member.guild);
    if (logChannel) {
      const embed = new EmbedBuilder()
        .setColor("Orange")
        .setTitle("⚠️ محاولة تحايل وتخطي البلاك ليست")
        .setDescription(`العضو **${member.user.tag}** حاول الدخول إلى السيرفر مجدداً وهو مدرج في قائمة البلاك ليست!`)
        .addFields(
          { name: "👤 المستخدم", value: `${member.user.tag}`, inline: true },
          { name: "🆔 المعرف الخاص به", value: `${member.id}`, inline: true },
          { name: "⚙️ الإجراء المتبع", value: "تمت إعادة سحب الرتب وفرض رتبة البلاك ليست تلقائياً.", inline: false }
        )
        .setThumbnail(member.user.displayAvatarURL())
        .setFooter({ text: "Ultimate Blacklist System" })
        .setTimestamp();

      logChannel.send({ embeds: [embed] });
    }
  }
});

/* ================= MESSAGES & PANEL ================= */

client.on("messageCreate", async message => {
  if (!message.guild) return;
  if (message.author.bot) return;

  const db = loadDB();

  /* block blacklisted users from typing */
  if (db.blacklist[message.author.id]) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      await message.delete().catch(() => {});
      return;
    }
  }

  /* panel setup */
  if (message.content !== "!panel") return;

  if (!canUse(message.member)) {
    return message.reply("❌ No permission");
  }

  // استخدام UserSelectMenuBuilder لحل مشكلة الـ 25 عضو نهائياً
  const userMenu = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId("select_user")
      .setPlaceholder("Select User")
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

  message.channel.send({
    embeds: [embed],
    components: [userMenu, buttons]
  });
});

/* ================= INTERACTIONS ================= */

client.on("interactionCreate", async interaction => {
  if (!canUse(interaction.member)) {
    return interaction.reply({
      content: "❌ No permission",
      ephemeral: true
    });
  }

  /* 1. معالجة اختيار العضو من القائمة */
  if (interaction.isUserSelectMenu()) {
    if (interaction.customId === "select_user") {
      selectedUser.set(interaction.user.id, interaction.values[0]);
      return interaction.reply({
        content: "✅ User selected",
        ephemeral: true
      });
    }
  }

  /* 2. معالجة ضغط الأزرار */
  if (interaction.isButton()) {
    const selected = selectedUser.get(interaction.user.id);

    if (!selected) {
      return interaction.reply({
        content: "❌ Select user first",
        ephemeral: true
      });
    }

    const member = await interaction.guild.members.fetch(selected).catch(() => null);

    if (!member) {
      return interaction.reply({
        content: "❌ User not found",
        ephemeral: true
      });
    }

    /* عند الضغط على زر الحظر الأساسي */
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

    /* عند الضغط على زر التأكيد الـ CONFIRM (إظهار المربع المنبثق) */
    if (interaction.customId.startsWith("confirm_bl_")) {
      const targetId = interaction.customId.split("_")[2];

      const modal = new ModalBuilder()
        .setCustomId(`blacklist_modal_${targetId}`)
        .setTitle("إضافة سبب الحظر");

      const reasonInput = new TextInputBuilder()
        .setCustomId("reason_input")
        .setLabel("ما هو سبب البلاك ليست؟")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("اكتب السبب بالتفصيل هنا...")
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      return interaction.showModal(modal);
    }

    /* عند الضغط على زر فك الحظر */
    if (interaction.customId === "unblacklist") {
      await removeBlacklist(member, interaction.member, "Blacklist removed");
      selectedUser.delete(interaction.user.id); // تنظيف الذاكرة

      return interaction.reply({
        content: `♻️ ${member.user.tag} unblacklisted`,
        ephemeral: true
      });
    }
  }

  /* 3. معالجة استقبال بيانات الـ Modal (مربع نص السبب) */
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith("blacklist_modal_")) {
      const targetId = interaction.customId.split("_")[2];
      const reason = interaction.fields.getTextInputValue("reason_input");

      const member = await interaction.guild.members.fetch(targetId).catch(() => null);
      if (!member) return interaction.reply({ content: "❌ User not found", ephemeral: true });

      await applyBlacklist(member, interaction.member, reason);
      selectedUser.delete(interaction.user.id); // تنظيف الذاكرة بعد النجاح

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor("Red")
            .setDescription(`🚫 ${member.user.tag} blacklisted successfully.`)
        ],
        ephemeral: true
      });
    }
  }
});

/* ================= READY ================= */

client.on("ready", () => {
  console.log(`${client.user.tag} online`);
});

/* ================= LOGIN ================= */

client.login(process.env.TOKEN);
