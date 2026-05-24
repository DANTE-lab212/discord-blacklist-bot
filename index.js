require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once('ready', () => {
  console.log(`${client.user.tag} online`);
});

client.on('messageCreate', (message) => {
  if (message.author.bot) return;

  if (message.content === 'hello') {
    message.reply('hello back 👋');
  }
});

client.login(process.env.TOKEN);
