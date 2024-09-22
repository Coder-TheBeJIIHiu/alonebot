const { Telegraf, Markup, Scenes, session } = require('telegraf');
const fs = require('fs');
const express = require('express');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const Message = require('./models/Message');
const User = require('./models/User');

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
const CHANNEL_ID = '@alone_speakchnl';
const port = process.env.PORT || 3000;

mongoose.connect(process.env.MONGO_URI).then(() => console.log('Connected to MongoDB'));

const startScene = new Scenes.BaseScene('start');
const speakingScene = new Scenes.BaseScene('speaking');
const msgScene = new Scenes.BaseScene('msg');

const stage = new Scenes.Stage([startScene, speakingScene, msgScene]);

app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: "run", time: new Date(), bot: bot.botInfo });
});

const loadFile = (path) => fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : null;

startScene.enter(async (ctx) => {
  const messageText = loadFile('start.txt');
  if (messageText) {
    await sendOrEditMessage(ctx, messageText, Markup.inlineKeyboard([
      Markup.button.callback('📚 Правила', 'rules'),
      Markup.button.callback('📜 Политика', 'policy'),
      Markup.button.callback('💔 Высказаться', 'speak'),
    ]));
  }
});

startScene.action(['rules', 'policy'], async (ctx) => {
  const messageText = loadFile(`${ctx.callbackQuery.data}.txt`);
  if (messageText) {
    await sendOrEditMessage(ctx, messageText, Markup.inlineKeyboard([Markup.button.callback('🔙 Назад', 'back')]));
  }
});

startScene.action('speak', (ctx) => ctx.scene.enter('speaking'));
startScene.action('back', (ctx) => ctx.scene.enter('start'));

msgScene.enter(async (ctx) => {
  const ref = ctx.session.payload;
  ctx.session.payload = null;

  const message = await Message.findOne({ uuid: ref });
  let userMessage = message.message;

  if (userMessage.length > 30) {
    userMessage = userMessage.slice(0, 30) + '...';
  }

  const encodedText = encodeURIComponent(userMessage);
  const uri = await shortenUrl(`https://t.me/${bot.botInfo.username}?start=${message.uuid}`);

  const joins = message.joins || 0;
  const createdAt = new Date(message.createdAt).toLocaleDateString();
  const messageId = message.id;

  const statsMessage = `
<b>💬 Сообщение:</b> ${userMessage}
<b>📅 Дата создания:</b> ${createdAt}
<b>👥 Присоединились по ссылке:</b> ${joins}

<b>Выберите действие:</b>
  `;

  await ctx.replyWithHTML(statsMessage, Markup.inlineKeyboard([
    Markup.button.url('💬 Поделиться', `https://t.me/share/url?url=${uri}&text=${encodedText}`),
    Markup.button.url('📖 Открыть', `https://t.me/${CHANNEL_ID.replace('@', '')}/${messageId}`),
    Markup.button.callback('🔙 Назад', 'back')
  ]));
});

speakingScene.enter(async (ctx) => {
  const messageText = loadFile('work.txt');
  if (messageText) {
    await sendOrEditMessage(ctx, messageText, Markup.inlineKeyboard([Markup.button.callback('🔙 Назад', 'back')]));
  }
});

speakingScene.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return ctx.scene.enter('start');
  ctx.session.usrmsg = ctx.message.text;
  await sendOrEditMessage(ctx, "Сообщение получено. Подтвердите отправку или отмените действие.", Markup.inlineKeyboard([
    Markup.button.callback('✅ Да', 'yes'),
    Markup.button.callback('❌ Отмена', 'cancel')
  ]));
});

speakingScene.action('yes', async (ctx) => {
  const link = await sendMessageAndGetLink(CHANNEL_ID, ctx.session.usrmsg, ctx.from.id);
  ctx.session.payload = link.uuid;
  await ctx.scene.enter('msg');
});

speakingScene.action('cancel', (ctx) => ctx.scene.enter('start'));

bot.use(session());
bot.use(stage.middleware());

bot.on('text', async (ctx, next) => {
  const message = ctx.message;
  if (message.reply_to_message) {
    const repliedMessage = await Message.findOne({ id: message.reply_to_message.message_id });
    if (repliedMessage) {
      const replyToUser = await User.findOne({ uuid: repliedMessage.ownuuid });
      await bot.telegram.sendMessage(replyToUser.telegram_id, `Вам ответили:\n${message.text}`, Markup.inlineKeyboard([
        Markup.button.url('📖 Ответить', `https://t.me/${CHANNEL_ID.replace('@', '')}/${repliedMessage.id}/`)
      ]));
    }
  }
  next();
});

bot.command('stats', async (ctx) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalMessages = await Message.countDocuments();
    const botUptime = process.uptime();
    const uptime = new Date(botUptime * 1000).toISOString().substr(11, 8);

    const statsMessage = `
<b>📊 Статистика бота:</b>

👥 <b>Всего пользователей:</b> ${totalUsers}
💬 <b>Всего сообщений:</b> ${totalMessages}
⏳ <b>Время работы:</b> ${uptime}
    `;

    await ctx.replyWithHTML(statsMessage);
  } catch (error) {
    console.error('Error fetching stats:', error);
    await ctx.reply('Произошла ошибка при получении статистики.');
  }
});

bot.start(async (ctx) => {
  const ref = ctx.startPayload;
  const userId = ctx.from.id;
  let user = await User.findOne({ telegram_id: userId }) || new User({ telegram_id: userId }).save();

  if (ref) {
    ctx.session.payload = ref;
    const message = await Message.findOne({ uuid: ref });
    if (message) {
      const owner = await User.findOne({ uuid: message.ownuuid });
      await bot.telegram.sendMessage(owner.telegram_id, `Пользователь присоединился по вашей ссылке.`);
    }
    await ctx.scene.enter('msg');
  } else {
    await ctx.scene.enter('start');
  }
});

async function sendOrEditMessage(ctx, newText, options = {}) {
  if (ctx.session.previousMessageId) {
    try {
      await bot.telegram.editMessageText(ctx.chat.id, ctx.session.previousMessageId, null, newText, options);
    } catch {
      ctx.session.previousMessageId = (await ctx.reply(newText, options)).message_id;
    }
  } else {
    ctx.session.previousMessageId = (await ctx.reply(newText, options)).message_id;
  }
}

async function sendMessageAndGetLink(CHANNEL_ID, userMessage, uid) {
  const user = await User.findOne({ telegram_id: uid });
  const msg = new Message({ uuid: uuidv4(), ownuuid: user.uuid, message: userMessage }).save();
  const message = await bot.telegram.sendMessage(CHANNEL_ID, `${userMessage}\n\n🥀 • <a href="https://t.me/${bot.botInfo.username}?start=${msg.uuid}">${bot.botInfo.first_name}</a>`, { parse_mode: 'HTML' });
  msg.id = message.message_id;
  await msg.save();
  return msg;
}

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  bot.launch();
});

async function shortenUrl(longUrl) {
  try {
    return (await axios.get(`https://clck.ru/--?url=${encodeURIComponent(longUrl)}`)).data;
  } catch {
    return longUrl;
  }
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));