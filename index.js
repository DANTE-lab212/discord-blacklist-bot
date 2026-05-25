أبشر يا DANTE، هذا هو كود `index.js` كامل ومتكامل من الصفر، مدمج فيه كل التعديلات اللي طلبناها وتعبنا عليها:

* نظام الحفظ الدائم (data.json).
* نظام مسح رسالة البانل بعد دقيقة.
* نظام مسح اختيار المشرف من الذاكرة بعد دقيقة لتفادي الأخطاء.
* عرض بروفايل العضو المخفي (تاريخ الحساب، دخوله السيرفر، عدد تحذيراته والتايم أوت).
* ثيم سيرفر **ELYSIUM** الملون (الوردي الفاقع `#F91A5A` وزر إزالة الحظر الأزرق).
* مودال كتابة السبب بعنوان "نظام العقوبات".
* نظام التصدي لمحاولات التخطي (إرجاع الرتبة تلقائياً عند الخروج والدخول).

انسخ هذا الكود بالكامل والصقه في ملف `index.js` الخاص بك:

```javascript
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

/* ================= TEMP MAP ================= */

// لتخزين العضو المحدد مؤقتاً
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
    .setColor(type === "BL" ? "#F91A5A" : "Blue")
    .setTitle(type === "BL" ? "🚫 تم إعطاء بلاك ليست" : "♻️ تم إزالة البلاك ليست")
    .setThumbnail(member.user.displayAvatarURL())
    .addFields(
      { name: "👤 العضو", value: `${member.user.tag}`, inline: true },
      { name: "🆔 المعرف", value: member.id, inline: true },
      { name: "👮 الإداري", value: admin.tag, inline: true },
      { name: "📝 السبب", value: reason || "لا يوجد سبب", inline: false },
      { name: "⚠️ التحذيرات السابقة", value: `${warns}`, inline: true },
      { name: "⏳ التايم أوت السابق", value: `${timeouts}`, inline: true }
    )
    .setFooter({ text: "Elysium Security System" })
    .setTimestamp();

  logChannel.send({ embeds: [embed] });
}

/* ================= APPLY BLACKLIST ================= */

async function applyBlacklist(member, admin, reason) {
  const db = loadDB();
  const role = getBlacklistRole(member.guild);

  if (!role) {
    return admin.send("❌ لم يتم العثور على رتبة 'Blacklisted' في السيرفر.").catch(() => {});
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
          .setColor("#F91A5A")
          .setTitle("🚫 تم حظرك من السيرفر")
          .setDescription(`لقد تم إعطاؤك بلاك ليست في سيرفر **${member.guild.name}**.\n\n📝 السبب: ${reason}`)
      ]
    });
  } catch {}

  await sendLog(member.guild, "BL", member, admin.user, reason);
}

/* ================= REMOVE BLACKLIST ================= */

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
          .setColor("Blue")
          .setTitle("♻️ إزالة البلاك ليست")
          .setDescription(`تمت إزالة البلاك ليست الخاص بك وتقدر تتفاعل بالسيرفر الآن.\n\n📝 السبب: ${reason}`)
      ]
    });
  } catch {}

  await sendLog(member.guild, "UNBL", member, admin.user, reason);
}

/* ================= EVENT: GUILD MEMBER ADD ================= */

client.on("guildMemberAdd", async (member) => {
  const db = loadDB();
  // إذا كان العضو في البلاك ليست وحاول يدخل من جديد
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
        .setFooter({ text: "Elysium Security System" })
        .setTimestamp();
      logChannel.send({ embeds: [embed] });
    }
  }
});

/* ================= MESSAGES & PANEL ================= */

client.on("messageCreate", async message => {
  if (!message.guild || message.author.bot) return;

  const db = loadDB();
  // منع المتبندين من الكلام
  if (db.blacklist[message.author.id]) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      await message.delete().catch(() => {});
      return;
    }
  }

  // إظهار لوحة التحكم
  if (message.content !== "!panel") return;
  if (!canUse(message.member)) return message.reply("❌ لا تملك صلاحية لاستخدام هذا الأمر.");

  const userMenu = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId("select_user")
      .setPlaceholder("🔍 | ابحث وحدد العضو من هنا...")
  );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("blacklist")
      .setLabel("🚫 إعطاء بلاك ليست")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("unblacklist")
      .setLabel("♻️ إزالة البلاك ليست")
      .setStyle(ButtonStyle.Primary)
  );

  const embed = new EmbedBuilder()
    .setColor("#F91A5A")
    .setTitle("🎮 E L Y S I U M  |  لوحة التحكم")
    .setDescription("**أهلاً بك في نظام عقوبات اليزيوم!** 🚀\n\nالرجاء اختيار العضو من القائمة بالأسفل لتطبيق العقوبة أو إزالتها.\n`تأكد من اختيار الشخص الصحيح قبل التأكيد.`")
    .setFooter({ text: "Elysium Management", iconURL: client.user.displayAvatarURL() });

  const panelMsg = await message.channel.send({
    embeds: [embed],
    components: [userMenu, buttons]
  });

  // مسح البانل بعد 60 ثانية لتنظيف الشات
  setTimeout(() => {
    panelMsg.delete().catch(() => {});
  }, 60000);
});

/* ================= INTERACTIONS ================= */

client.on("interactionCreate", async interaction => {
  if (!canUse(interaction.member)) {
    return interaction.reply({ content: "❌ لا تملك صلاحيات كافية.", ephemeral: true });
  }

  /* 1. اختيار العضو وعرض البروفايل */
  if (interaction.isUserSelectMenu()) {
    if (interaction.customId === "select_user") {
      const targetUserId = interaction.values[0];
      selectedUser.set(interaction.user.id, targetUserId);

      // مسح الاختيار من الذاكرة بعد 60 ثانية
      setTimeout(() => {
        if (selectedUser.get(interaction.user.id) === targetUserId) {
          selectedUser.delete(interaction.user.id);
        }
      }, 60000);

      const member = await interaction.guild.members.fetch(targetUserId).catch(() => null);
      if (!member) return interaction.reply({ content: "❌ لم يتم العثور على العضو.", ephemeral: true });

      const db = loadDB();
      const warns = db.warnings[member.id]?.length || 0;
      const timeouts = db.timeouts[member.id]?.length || 0;

      const profileEmbed = new EmbedBuilder()
        .setColor("#F91A5A")
        .setTitle(`ملف العضو: ${member.user.tag}`)
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
          { name: "📅 إنشاء الحساب", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: "📥 دخول السيرفر", value: member.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>` : "غير معروف", inline: true },
          { name: "⚠️ تحذيرات", value: `${warns}`, inline: true },
          { name: "⏳ تايم أوت", value: `${timeouts}`, inline: true }
        )
        .setFooter({ text: "لديك 60 ثانية لتأكيد العقوبة من الأزرار السفلية للبانل" });

      return interaction.reply({
        content: "✅ **تم اختيار العضو بنجاح. راجع بياناته قبل اتخاذ الإجراء:**",
        embeds: [profileEmbed],
        ephemeral: true
      });
    }
  }

  /* 2. ضغط الأزرار (تأكيد أو إلغاء) */
  if (interaction.isButton()) {
    const selected = selectedUser.get(interaction.user.id);
    if (!selected) return interaction.reply({ content: "❌ الرجاء تحديد عضو من القائمة أولاً، أو انتهى وقت التحديد (دقيقة).", ephemeral: true });

    const member = await interaction.guild.members.fetch(selected).catch(() => null);
    if (!member) return interaction.reply({ content: "❌ لم يتم العثور على العضو في السيرفر.", ephemeral: true });

    if (interaction.customId === "blacklist") {
      return interaction.reply({
        ephemeral: true,
        embeds: [
          new EmbedBuilder()
            .setColor("Red")
            .setTitle("⚠️ تأكيد البلاك ليست")
            .setDescription(`هل أنت متأكد من إعطاء بلاك ليست للعضو **${member.user.tag}**؟`)
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`confirm_bl_${member.id}`)
              .setLabel("تأكيد العقوبة")
              .setStyle(ButtonStyle.Danger)
          )
        ]
      });
    }

    if (interaction.customId.startsWith("confirm_bl_")) {
      const targetId = interaction.customId.split("_")[2];
      const modal = new ModalBuilder()
        .setCustomId(`blacklist_modal_${targetId}`)
        .setTitle("نظام العقوبات - توثيق الإجراء");

      const reasonInput = new TextInputBuilder()
        .setCustomId("reason_input")
        .setLabel("تفاصيل المخالفة (السبب):")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("أدخل تفاصيل المخالفة ليتم تسجيلها في قاعدة البيانات...")
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
      return interaction.showModal(modal);
    }

    if (interaction.customId === "unblacklist") {
      await removeBlacklist(member, interaction.member, "تمت الإزالة بواسطة الإدارة");
      selectedUser.delete(interaction.user.id);
      return interaction.reply({ content: `♻️ تم إزالة البلاك ليست عن **${member.user.tag}** بنجاح.`, ephemeral: true });
    }
  }

  /* 3. استقبال المودال (السبب) وتطبيق البلاك ليست */
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith("blacklist_modal_")) {
      const targetId = interaction.customId.split("_")[2];
      const reason = interaction.fields.getTextInputValue("reason_input");

      const member = await interaction.guild.members.fetch(targetId).catch(() => null);
      if (!member) return interaction.reply({ content: "❌ لم يتم العثور على العضو.", ephemeral: true });

      await applyBlacklist(member, interaction.member, reason);
      selectedUser.delete(interaction.user.id);

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor("#F91A5A")
            .setDescription(`🚫 تم إعطاء البلاك ليست للعضو **${member.user.tag}** بنجاح.`)
        ],
        ephemeral: true
      });
    }
  }
});

/* ================= READY ================= */

client.on("ready", () => {
  console.log(`✅ البوت شغال وجاهز باسم: ${client.user.tag}`);
});

/* ================= LOGIN ================= */

client.login(process.env.TOKEN);

```
