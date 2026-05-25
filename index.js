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

  if (
    member.permissions.has(
      PermissionsBitField.Flags.Administrator
    )
  ) {
    return true;
  }

  if (db.allowedUsers.includes(member.id)) {
    return true;
  }

  if (
    member.roles.cache.some(r =>
      db.allowedRoles.includes(r.id)
    )
  ) {
    return true;
  }

  return false;
}

/* ================= LOG SYSTEM ================= */

async function sendLog(
  guild,
  type,
  member,
  admin,
  reason
) {

  const logChannel = getLogChannel(guild);

  if (!logChannel) return;

  const db = loadDB();

  const warns =
    db.warnings[member.id]?.length || 0;

  const timeouts =
    db.timeouts[member.id]?.length || 0;

  const embed = new EmbedBuilder()
    .setColor(type === "BL" ? "Red" : "Green")
    .setTitle(
      type === "BL"
        ? "🚫 USER BLACKLISTED"
        : "♻️ USER UNBLACKLISTED"
    )
    .setThumbnail(
      member.user.displayAvatarURL()
    )
    .addFields(
      {
        name: "👤 User",
        value: `${member.user.tag}`,
        inline: true
      },
      {
        name: "🆔 ID",
        value: member.id,
        inline: true
      },
      {
        name: "👮 Staff",
        value: admin.tag,
        inline: true
      },
      {
        name: "📝 Reason",
        value: reason || "No reason",
        inline: false
      },
      {
        name: "⚠️ Warnings",
        value: `${warns}`,
        inline: true
      },
      {
        name: "⏳ Timeouts",
        value: `${timeouts}`,
        inline: true
      },
      {
        name: "📅 Account Created",
        value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`,
        inline: false
      },
      {
        name: "📥 Joined Server",
        value: member.joinedAt
          ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:R>`
          : "Unknown",
        inline: false
      }
    )
    .setFooter({
      text: "Ultimate Blacklist System"
    })
    .setTimestamp();

  logChannel.send({
    embeds: [embed]
  });
}

/* ================= APPLY BLACKLIST ================= */

async function applyBlacklist(
  member,
  admin,
  reason
) {

  const db = loadDB();

  const role = getBlacklistRole(
    member.guild
  );

  if (!role) {
    return admin.send(
      "❌ Blacklisted role not found."
    ).catch(() => {});
  }

  /* remove all roles */

  await member.roles
    .set([role])
    .catch(() => {});

  /* save */

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

  /* DM */

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

  /* LOG */

  await sendLog(
    member.guild,
    "BL",
    member,
    admin.user,
    reason
  );
}

/* ================= REMOVE BLACKLIST ================= */

async function removeBlacklist(
  member,
  admin,
  reason
) {

  const db = loadDB();

  const role = getBlacklistRole(
    member.guild
  );

  delete db.blacklist[member.id];

  saveDB(db);

  if (role) {
    await member.roles
      .remove(role)
      .catch(() => {});
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

  await sendLog(
    member.guild,
    "UNBL",
    member,
    admin.user,
    reason
  );
}

/* ================= BLOCK BLACKLISTED USERS ================= */

client.on("messageCreate", async message => {

  if (!message.guild) return;
  if (message.author.bot) return;

  const db = loadDB();

  /* block blacklisted */

  if (db.blacklist[message.author.id]) {

    if (
      !message.member.permissions.has(
        PermissionsBitField.Flags.Administrator
      )
    ) {

      await message.delete().catch(() => {});

      return;
    }
  }

  /* panel */

  if (message.content !== "!panel") return;

  if (!canUse(message.member)) {
    return message.reply(
      "❌ No permission"
    );
  }

  const members =
    await message.guild.members.fetch();

  const options = members
    .filter(m => !m.user.bot)
    .map(m => ({
      label: m.user.username.slice(0, 25),
      value: m.id
    }))
    .slice(0, 25);

  const userMenu =
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("select_user")
        .setPlaceholder("Select User")
        .addOptions(options)
    );

  const buttons =
    new ActionRowBuilder().addComponents(

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
    .setDescription(
      "Advanced moderation system"
    );

  message.channel.send({
    embeds: [embed],
    components: [userMenu, buttons]
  });

});

/* ================= INTERACTIONS ================= */

client.on("interactionCreate", async interaction => {

  if (
    !interaction.isButton() &&
    !interaction.isStringSelectMenu()
  ) return;

  if (!canUse(interaction.member)) {
    return interaction.reply({
      content: "❌ No permission",
      ephemeral: true
    });
  }

  /* select user */

  if (interaction.isStringSelectMenu()) {

    if (
      interaction.customId ===
      "select_user"
    ) {

      selectedUser.set(
        interaction.user.id,
        interaction.values[0]
      );

      return interaction.reply({
        content:
          "✅ User selected",
        ephemeral: true
      });
    }
  }

  const selected =
    selectedUser.get(
      interaction.user.id
    );

  if (!selected) {
    return interaction.reply({
      content:
        "❌ Select user first",
      ephemeral: true
    });
  }

  const member =
    await interaction.guild.members
      .fetch(selected)
      .catch(() => null);

  if (!member) {
    return interaction.reply({
      content:
        "❌ User not found",
      ephemeral: true
    });
  }

  /* blacklist confirm */

  if (
    interaction.customId ===
    "blacklist"
  ) {

    return interaction.reply({
      ephemeral: true,
      embeds: [
        new EmbedBuilder()
          .setColor("Red")
          .setTitle(
            "⚠️ CONFIRM BLACKLIST"
          )
          .setDescription(
            `Blacklist ${member.user.tag}?`
          )
      ],
      components: [
        new ActionRowBuilder()
          .addComponents(

            new ButtonBuilder()
              .setCustomId(
                `confirm_bl_${member.id}`
              )
              .setLabel("CONFIRM")
              .setStyle(
                ButtonStyle.Danger
              )

          )
      ]
    });
  }

  /* confirm */

  if (
    interaction.customId.startsWith(
      "confirm_bl_"
    )
  ) {

    await applyBlacklist(
      member,
      interaction.member,
      "No reason provided"
    );

    return interaction.update({
      embeds: [
        new EmbedBuilder()
          .setColor("Red")
          .setDescription(
            `🚫 ${member.user.tag} blacklisted`
          )
      ],
      components: []
    });
  }

  /* unblacklist */

  if (
    interaction.customId ===
    "unblacklist"
  ) {

    await removeBlacklist(
      member,
      interaction.member,
      "Blacklist removed"
    );

    return interaction.reply({
      content:
        `♻️ ${member.user.tag} unblacklisted`,
      ephemeral: true
    });
  }

});

/* ================= READY ================= */

client.on("ready", () => {

  console.log(
    `${client.user.tag} online`
  );

});

/* ================= LOGIN ================= */

client.login(process.env.TOKEN);
