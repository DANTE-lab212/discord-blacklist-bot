require("dotenv").config();

// --- إعدادات الخادم (Render / Host) ---
const express = require("express");
const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || "0.0.0.0";

app.get("/", (req, res) => res.send("Bot is active and running on Host!"));

app.listen(port, host, () =>
  console.log(`✅ Web server is listening on ${host}:${port}`)
);
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
const path = require("path");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration
  ]
});

const DB_FILE = path.join(__dirname, "data.json");

// ✅ قاعدة البيانات في الذاكرة (Cache) لسرعة الأداء
let db = loadDB();

function createDefaultDB() {
  return {
    blacklist: {},
    history: {},
    warnings: {},
    timeouts: {},
    allowedUsers: [],
    allowedRoles: []
  };
}

function loadDB() {
  if (!fs.existsSync(DB_FILE)) return createDefaultDB();
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (error) {
    console.error("Failed to load DB:", error);
    return createDefaultDB();
  }
}

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// ✅ ذواكر التخزين المؤقتة للوحات والتحكم
const activePanels = new Map(); // لمنع تكرار اللوحات بالروم
const panelOwners = new Map();  // لربط اللوحة بصاحبها فقط
const selectedUser = new Map();
const selectedUserTimeouts = new Map();

function setSelectedUser(guildId, userId, targetUserId) {
  const key = `${guildId}_${userId}`;
  selectedUser.set(key, targetUserId);

  if (selectedUserTimeouts.has(key)) clearTimeout(selectedUserTimeouts.get(key));

  selectedUserTimeouts.set(
    key,
    setTimeout(() => {
      selectedUser.delete(key);
      selectedUserTimeouts.delete(key);
    }, 60000)
  );
}

function clearSelectedUser(guildId, userId) {
  const key = `${guildId}_${userId}`;
  selectedUser.delete(key);
  if (selectedUserTimeouts.has(key)) {
    clearTimeout(selectedUserTimeouts.get(key));
    selectedUserTimeouts.delete(key);
  }
}

const BLACKLIST_ROLE_ID = process.env.BLACKLIST_ROLE_ID;

function getBlacklistRole(guild) {
  return guild.roles.cache.find(r =>
    BLACKLIST_ROLE_ID ? r.id === BLACKLIST_ROLE_ID : r.name.toLowerCase() === "blacklisted"
  );
}

function getLogChannel(guild) {
  return guild.channels.cache.find(c => c.name.toLowerCase() === "blacklist-log" && c.isTextBased());
}

function canUse(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (db.allowedUsers.includes(member.id)) return true;
  if (member.roles.cache.some(r => db.allowedRoles.includes(r.id))) return true;
  return false;
}

async function sendLog(guild, type, member, admin, reason) {
  const logChannel = getLogChannel(guild);
  if (!logChannel) return;

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
      { name: "⏳ Timeouts", value: `${timeouts}`, inline: true }
    )
    .setTimestamp();

  logChannel.send({ embeds: [embed] });
}

async function applyBlacklist(member, admin, reason) {
  const role = getBlacklistRole(member.guild);
  if (!role) return false;

  try {
    await member.roles.set([role]);
  } catch (error) { return false; }

  db.blacklist[member.id] = { reason, by: admin.id, time: Date.now() };
  db.history[member.id] ??= [];
  db.history[member.id].push({ type: "BLACKLIST", reason, by: admin.id, time: Date.now() });
  saveDB();

  try {
    await member.send({
      embeds: [new EmbedBuilder().setColor("Red").setTitle("🚫 ACCESS DENIED").setDescription(`You are blacklisted from **${member.guild.name}**.\n\n📝 Reason: ${reason}`)]
    });
  } catch {}

  await sendLog(member.guild, "BL", member, admin.user, reason);
  return true;
}

async function removeBlacklist(member, admin, reason) {
  const role = getBlacklistRole(member.guild);
  if (role) {
    try { await member.roles.remove(role); } 
    catch (error) { return false; }
  }

  delete db.blacklist[member.id];
  saveDB();

  try {
    await member.send({
      embeds: [new EmbedBuilder().setColor("Green").setTitle("♻️ BLACKLIST REMOVED").setDescription(`Your blacklist was removed.\n\n📝 Reason: ${reason}`)]
    });
  } catch {}

  await sendLog(member.guild, "UNBL", member, admin.user, reason);
  return true;
}

// 🛡️ نظام التقاط التايم أوت الاحترافي (مباشر من ديسكورد)
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  if (!oldMember.isCommunicationDisabled() && newMember.isCommunicationDisabled()) {
    try {
      const fetchedLogs = await newMember.guild.fetchAuditLogs({ limit: 1, type: 24 });
      const auditEntry = fetchedLogs.entries.first();

      if (auditEntry && auditEntry.target.id === newMember.id) {
        db.timeouts[newMember.id] ??= [];
        db.timeouts[newMember.id].push({
          by: auditEntry.executor.id,
          time: Date.now(),
          reason: auditEntry.reason || "بدون سبب"
        });
        saveDB();
        console.log(`✅ تم التقاط التايم أوت للعضو: ${newMember.user.tag}`);
      }
    } catch (error) { console.log("خطأ في تسجيل التايم أوت:", error); }
  }
});

// 🚨 نظام كشف المتهربين من البلاك ليست 🚨
client.on("guildMemberAdd", async member => {
  if (db.blacklist[member.id]) {
    const role = getBlacklistRole(member.guild);
    if (role) {
      await member.roles.set([role]).catch(() => {});
      
      // إرسال تنبيه التحايل لروم اللوق
      const logChannel = getLogChannel(member.guild);
      if (logChannel) {
        const alertEmbed = new EmbedBuilder()
          .setColor("Orange") // لون التحذير (البرتقالي)
          .setTitle("⚠️ محاولة تحايل وتخطي البلاك ليست")
          .setDescription(`العضو **${member.user.tag}** حاول الدخول إلى السيرفر مجدداً وهو مدرج في قائمة البلاك ليست!`)
          .setThumbnail(member.user.displayAvatarURL())
          .addFields(
            { name: "👤 المستخدم", value: member.user.tag, inline: true },
            { name: "🆔 المعرف", value: member.id, inline: true },
            { name: "⚙️ الإجراء المتبع", value: "تمت إعادة سحب الرتب وفرض رتبة البلاك ليست تلقائياً.", inline: false }
          )
          .setFooter({ text: "Ultimate Blacklist System" })
          .setTimestamp();

        logChannel.send({ embeds: [alertEmbed] }).catch(() => {});
      }
    }
  }
});

client.on("messageCreate", async message => {
  if (!message.guild) return;

  // 🛡️ نظام التقاط التحذيرات (إذا بوت الحماية أرسل كلمة تحذير)
  if (message.author.bot && message.channel.name.toLowerCase() === "blacklist-log") {
    if (message.content.includes("تحذير") || message.content.includes("warn")) {
      const targetUser = message.mentions.users.first();
      if (targetUser) {
        db.warnings[targetUser.id] ??= [];
        db.warnings[targetUser.id].push({ time: Date.now() });
        saveDB();
        console.log(`✅ تم تسجيل تحذير للعضو: ${targetUser.tag}`);
      }
    }
    return;
  }

  if (message.author.bot || !message.member) return;

  if (db.blacklist[message.author.id]) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      await message.delete().catch(() => {});
      return;
    }
  }

  if (message.content.trim().toLowerCase() !== "!panel") return;

  if (!canUse(message.member)) return message.reply("❌ No permission");

  // تنظيف اللوحة القديمة بالروم
  if (activePanels.has(message.channel.id)) {
    activePanels.get(message.channel.id).delete().catch(() => {});
  }

  const userMenu = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder().setCustomId("select_user").setPlaceholder("Select User")
  );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("blacklist").setLabel("🚫 BLACKLIST").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("unblacklist").setLabel("♻️ UNBLACKLIST").setStyle(ButtonStyle.Success)
  );

  const panelEmbed = new EmbedBuilder()
    .setTitle("🚫 BLACKLIST PANEL")
    .setColor("Red")
    .setDescription("حدد العضو من القائمة لاتخاذ الإجراء المناسب.\n\n⏳ **تنبيه: هذه اللوحة مخصصة لك فقط وسيتم إغلاقها وحذفها تلقائياً بعد 30 ثانية.**");

  const panelMsg = await message.channel.send({
    embeds: [panelEmbed],
    components: [userMenu, buttons]
  });

  // حفظ اللوحة وصاحبها في الذاكرة
  activePanels.set(message.channel.id, panelMsg);
  panelOwners.set(panelMsg.id, message.author.id);

  setTimeout(() => {
    panelMsg.delete().catch(() => {});
    message.delete().catch(() => {});
    activePanels.delete(message.channel.id);
    panelOwners.delete(panelMsg.id);
  }, 30000);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.member || !canUse(interaction.member)) {
    return interaction.reply({ content: "❌ No permission", ephemeral: true });
  }

  // 🔒 التحقق من صاحب اللوحة (مستحيل أحد يتدخل غير اللي كتب الأمر)
  if (interaction.message && interaction.customId !== "reason_input") {
    const ownerId = panelOwners.get(interaction.message.id);
    if (ownerId && interaction.user.id !== ownerId) {
      return interaction.reply({ content: "❌ **هذه اللوحة ليست لك!** اكتب `!panel` لفتح لوحتك الخاصة.", ephemeral: true });
    }
  }

  // 1. التعامل مع القائمة
  if (interaction.isUserSelectMenu()) {
    if (interaction.customId === "select_user") {
      const targetUserId = interaction.values[0];
      setSelectedUser(interaction.guild.id, interaction.user.id, targetUserId);

      const member = await interaction.guild.members.fetch(targetUserId).catch(() => null);
      if (!member) return interaction.reply({ content: "❌ User not found", ephemeral: true });

      const warns = db.warnings[member.id]?.length || 0;
      const timeouts = db.timeouts[member.id]?.length || 0;

      const profileEmbed = new EmbedBuilder()
        .setColor("#2b2d31")
        .setTitle(`ملف العضو: ${member.user.tag}`)
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
          { name: "🆔 ID", value: `${member.id}`, inline: true },
          { name: "⚠️ تحذيرات", value: `${warns}`, inline: true },
          { name: "⏳ تايم أوت", value: `${timeouts}`, inline: true }
        );

      return interaction.reply({ content: "✅ تم اختيار العضو بنجاح:", embeds: [profileEmbed], ephemeral: true });
    }
  }

  // 2. التعامل مع الأزرار
  if (interaction.isButton()) {
    const selected = selectedUser.get(`${interaction.guild.id}_${interaction.user.id}`);
    if (!selected && !interaction.customId.startsWith("confirm_bl_")) {
      return interaction.reply({ content: "❌ الرجاء تحديد العضو من القائمة أولاً.", ephemeral: true });
    }

    const targetId = interaction.customId.startsWith("confirm_bl_") ? interaction.customId.split("_")[2] : selected;
    const member = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (!member) return interaction.reply({ content: "❌ User not found", ephemeral: true });

    const botMember = interaction.guild.members.me;

    // 🛡️ نظام حماية الرتب الصارم
    if (member.id === interaction.guild.ownerId) {
      return interaction.reply({ content: "❌ لا يمكنك تنفيذ أي إجراء على مالك السيرفر.", ephemeral: true });
    }
    if (interaction.user.id !== interaction.guild.ownerId) {
      if (member.roles.highest.position >= interaction.member.roles.highest.position) {
        return interaction.reply({ content: "❌ لا يمكنك تنفيذ الأمر على شخص رتبته أعلى من رتبتك أو تساويه.", ephemeral: true });
      }
    }
    if (member.roles.highest.position >= botMember.roles.highest.position) {
      return interaction.reply({ content: "❌ لا أستطيع تنفيذ الأمر لأن رتبة هذا العضو أعلى من رتبتي أو تساويه.", ephemeral: true });
    }

    if (interaction.customId === "blacklist") {
      return interaction.reply({
        ephemeral: true,
        embeds: [new EmbedBuilder().setColor("Red").setTitle("⚠️ CONFIRM").setDescription(`هل أنت متأكد من وضع ${member.user.tag} في البلاك ليست؟`)],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`confirm_bl_${member.id}`).setLabel("CONFIRM").setStyle(ButtonStyle.Danger)
          )
        ]
      });
    }

    if (interaction.customId.startsWith("confirm_bl_")) {
      const modal = new ModalBuilder().setCustomId(`blacklist_modal_${member.id}`).setTitle("نظام العقوبات - إضافة سبب");
      const reasonInput = new TextInputBuilder()
        .setCustomId("reason_input")
        .setLabel("ما هو سبب البلاك ليست؟")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      return interaction.showModal(modal);
    }

    if (interaction.customId === "unblacklist") {
      const result = await removeBlacklist(member, interaction.member, "Removed via Panel");
      clearSelectedUser(interaction.guild.id, interaction.user.id);

      if (!result) return interaction.reply({ content: "❌ حدث خطأ، يرجى التأكد من صلاحيات رتبتي.", ephemeral: true });
      return interaction.reply({ content: `♻️ تم فك البلاك ليست عن ${member.user.tag} بنجاح.`, ephemeral: true });
    }
  }

  // 3. المودال (السبب)
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith("blacklist_modal_")) {
      const targetId = interaction.customId.split("_")[2];
      const reason = interaction.fields.getTextInputValue("reason_input");
      const member = await interaction.guild.members.fetch(targetId).catch(() => null);
      
      if (!member) return interaction.reply({ content: "❌ User not found", ephemeral: true });

      const result = await applyBlacklist(member, interaction.member, reason);
      clearSelectedUser(interaction.guild.id, interaction.user.id);

      if (!result) return interaction.reply({ content: "❌ حدث خطأ في إعطاء الرتبة، تأكد من صلاحيات البوت.", ephemeral: true });
      return interaction.reply({ content: `🚫 تم إدراج ${member.user.tag} في البلاك ليست بنجاح.`, ephemeral: true });
    }
  }
});

client.on("ready", () => console.log("Bot online"));
client.login(process.env.TOKEN);
