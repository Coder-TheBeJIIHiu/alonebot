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

app.listen(port, () => {
  console.log(`Server running on port ${port}`);mongoose.connect(process.env.MONGO_URI).then(() => {
    console.log('Connected to MongoDB');
    bot.launch();
    console.log(`Bot Running...`);
  })
});


const startScene = new Scenes.BaseScene('start');
const speakingScene = new Scenes.BaseScene('speaking');
const msgScene = new Scenes.BaseScene('msg');
const broadcastScene = new Scenes.BaseScene('broadcast');

const stage = new Scenes.Stage([startScene, speakingScene, msgScene, broadcastScene]);

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

broadcastScene.enter((ctx) => {
  ctx.reply('✍️ Пожалуйста, введите сообщение, которое хотите отправить всем пользователям:');
});

broadcastScene.on('text', async (ctx) => {
  const messageText = ctx.message.text;

  ctx.reply(
    `📢 *Вы хотите отправить следующее сообщение всем пользователям?*\n\n` +
    `💌 Сообщение: "${messageText}"`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Да', 'confirm')],
        [Markup.button.callback('❌ Отмена', 'cancel')]
      ])
    }
  );

  ctx.scene.state.messageText = messageText;
});

broadcastScene.action('confirm', async (ctx) => {
  const messageText = ctx.scene.state.messageText;
  const users = await User.find();
  const totalUsers = users.length;
  const usersPerBatch = 20
  let successCount = 0;
  let failCount = 0;
  let failedUsers = [];
  const msg = "¡¡¡ ОБЪЯВЛЕНИЕ 📣 !!!\n\n"
  await ctx.telegram.sendMessage(CHANNEL_ID, msg + messageText, { parse_mode: 'Markdown' })
  const sendMessages = async (batch) => {
    for (let user of batch) {
      try {
        await ctx.telegram.sendMessage(user.telegram_id, `${msg}${messageText}`);
        successCount++;
      } catch (error) {
        failCount++;
        failedUsers.push(user.telegram_id);
      }
    }
  };

  const totalBatches = 2 // Math.ceil(totalUsers / usersPerBatch);

  ctx.reply(
    `📢 *Начинаем рассылку сообщений*\n\n` +
    `💌 Сообщение для отправки: "${messageText}"\n` +
    `👥 Всего пользователей: *${totalUsers}*\n` +
    `🔄 Рассылка будет производиться партиями по *${usersPerBatch}* сообщений в минуту.\n\n` +
    `⌛️ Пожалуйста, подождите...`,
    { parse_mode: 'Markdown' }
  );

  for (let i = 0; i < totalBatches; i++) {
    const batch = users.slice(i * usersPerBatch, (i + 1) * usersPerBatch);

    setTimeout(async () => {
      await sendMessages(batch);

      ctx.reply(
        `📊 *Прогресс рассылки:*\n` +
        `✅ Успешно отправлено: *${successCount}/${totalUsers}*\n` +
        `❌ Ошибок при отправке: *${failCount}*\n` +
        `🕐 Следующая партия будет отправлена через минуту...`,
        { parse_mode: 'Markdown' }
      );
    }, i * 60000);
  }

  setTimeout(() => {
    let reportMessage = `📬 <b>Рассылка завершена!</b>\n\n` +
      `✅ Успешно отправлено сообщений: <b>${successCount}/${totalUsers}</b>\n` +
      `❌ Ошибок при отправке: <b>${failCount}</b>`;

    if (failedUsers.length > 0) {
      reportMessage += `\n\n⚠️ <b>Не удалось отправить сообщения следующим пользователям:</b>\n` +
        failedUsers.map(id => `🔸 <a href="tg://user?id=${id}">${id}</a>`).join('\n');
    }

    ctx.reply(reportMessage, { parse_mode: 'HTML' });
  }, totalBatches * 60000 + 5000);

  ctx.scene.leave();
});

broadcastScene.action('cancel', (ctx) => {
  ctx.reply('❌ Рассылка отменена.');
  ctx.scene.enter("start");
});

msgScene.enter(async (ctx) => {
  const ref = ctx.session.payload;
  ctx.state.ref = ctx.state.ref || ""; 
  ctx.state.ref = ref;
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
    Markup.button.callback('😏 Кто писал?', 'author'),
    Markup.button.callback('🔙 Назад', 'back')
  ]));
});

msgScene.action('author', async (ctx) => {
  if (ctx.from.id !== 6153453766) {
    await ctx.reply('А для чего бот? 🤔');
    return ctx.scene.enter('start');
  }

  const message = await Message.findOne({ uuid: ctx.state.ref });
  const authorId = message.ownuuid;
  const author = await User.findOne({ uuid: authorId });

  if (author) {
    await ctx.reply(`Автор сообщения: <a href="tg://user?id=${author.telegram_id}">${author.telegram_id}</a>`, { parse_mode: 'HTML' });
  } else {
    await ctx.reply('Автор не найден.');
  }
  ctx.scene.enter("start")
});

speakingScene.enter(async (ctx) => {
  const messageText = loadFile('work.txt');
  if (messageText) {
    await sendOrEditMessage(ctx, messageText, Markup.inlineKeyboard([Markup.button.callback('🔙 Назад', 'cancel')]));
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
  await ctx.deleteMessage()
  const link = await sendMessageAndGetLink(CHANNEL_ID, ctx.session.usrmsg, ctx.from.id);
  ctx.session.payload = link.uuid;
  await ctx.scene.enter('msg');
});

speakingScene.action('cancel', (ctx) => {
  ctx.scene.enter('start');
}

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
bot.command('broadcast', (ctx) => ctx.scene.enter('broadcast'))
bot.start(async (ctx) => {
  const ref = ctx.startPayload;
  const userId = ctx.from.id;
  let user = await User.findOne({ telegram_id: userId }) || new User({ telegram_id: userId }).save();

  if (ref) {
    ctx.session.payload = ref;
    const message = await Message.findOne({ uuid: ref });
    if (message) {
      const owner = await User.findOne({ uuid: message.ownuuid });
      if(owner.telegram_id !== userId) await bot.telegram.sendMessage(owner.telegram_id, `Пользователь присоединился по вашей ссылке.`);
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
  const msg = new Message({ uuid: uuidv4(), ownuuid: user.uuid, message: userMessage })
    
  const message = await bot.telegram.sendMessage(CHANNEL_ID, `${userMessage}\n\n🥀 • <a href="https://t.me/${bot.botInfo.username}?start=${msg.uuid}">${bot.botInfo.first_name}</a>`, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }});
  msg.id = message.message_id;
  await msg.save();
  return msg;
}

async function shortenUrl(longUrl) {
  try {
    return (await axios.get(`https://clck.ru/--?url=${encodeURIComponent(longUrl)}`)).data;
  } catch {
    return longUrl;
  }
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));