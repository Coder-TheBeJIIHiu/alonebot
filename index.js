const { Telegraf, Markup, Scenes, session } = require('telegraf');
const fs = require('fs');
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const Message = require('./models/Message');
const User = require('./models/User');

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();

mongoose.connect(process.env.MONGO_URI).then(() => {
  console.log('Connected to MongoDB');
})

const port = process.env.PORT || 3000;

const startScene = new Scenes.BaseScene('start');
const speakingScene = new Scenes.BaseScene('speaking');
const msgScene = new Scenes.BaseScene('msg');

const CHANNEL_ID = '@alone_speakchnl';
const stage = new Scenes.Stage([startScene, speakingScene, msgScene]);

app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    status: "run",
    time: new Date().now,
    bot: bot.botInfo
  })
})

startScene.enter(async (ctx) => {
  try {
    if (fs.existsSync('start.txt')) {
      const messageText = fs.readFileSync('start.txt', 'utf8');
      await sendOrEditMessage(ctx, messageText, Markup.inlineKeyboard([
        Markup.button.callback('📚 Правила', 'rules'),
        Markup.button.callback('📜 Политика', 'policy'),
        Markup.button.callback('💔 Высказаться', 'speak'),
      ]));
    }
  } catch (error) {
    console.error('Error sending message:', error);
  }
});

startScene.action('rules', async (ctx) => {
  await ctx.answerCbQuery();
  try {
    if (fs.existsSync('rules.txt')) {
      const messageText = fs.readFileSync('rules.txt', 'utf8');
      await sendOrEditMessage(ctx, messageText, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          Markup.button.callback('🔙 Назад', 'back')
        ])
      });
    }
  } catch (error) {
    console.error('Error editing message:', error);
  }
});

startScene.action('policy', async (ctx) => {
  await ctx.answerCbQuery();
  try {
    if (fs.existsSync('policy.txt')) {
      const messageText = fs.readFileSync('policy.txt', 'utf8');
      await sendOrEditMessage(ctx, messageText, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          Markup.button.callback('🔙 Назад', 'back')
        ])
      });
    }
  } catch (error) {
    console.error('Error editing message:', error);
  }
});

startScene.action('speak', async (ctx) => {
  await ctx.answerCbQuery();
  try {
    ctx.scene.enter('speaking');
  } catch (error) {
    console.error('Error entering speaking scene:', error);
  }
});

startScene.action('back', async (ctx) => {
  await ctx.answerCbQuery();
  try {
    ctx.scene.enter('start');
  } catch (error) {
    console.error('Error returning to start:', error);
  }
});

speakingScene.action('back', async (ctx) => {
  await ctx.answerCbQuery();
  try {
    ctx.scene.enter('start');
  } catch (error) {
    console.error('Error returning to start:', error);
  }
});
msgScene.action('back', async (ctx) => {
  await ctx.answerCbQuery();
  try {
    ctx.scene.enter('start');
  } catch (error) {
    console.error('Error returning to start:', error);
  }
})

msgScene.enter(async (ctx) => {
  const ref = ctx.session.payload;
  ctx.session.payload = null;
  const message = await Message.findOne({ uuid: ref });
  var userMessage = message.message;
  if (userMessage.length > 30) {
    userMessage = userMessage.slice(0, 30) + '...';
  }
  const encodedText = encodeURIComponent(userMessage);
  const uri = await shortenUrl(`https://t.me/${bot.botInfo.username}?start=${message.uuid}`)
  ctx.reply(`Сообщение:\n${userMessage}\n\nВыберите действие:`, Markup.inlineKeyboard([
    Markup.button.url('💬 Поделиться', `https://t.me/share/url?url=${uri}&text=${encodedText}`),
    Markup.button.url('📖 Открыть', `https://t.me/${CHANNEL_ID.replace('@', '')}/${message.id}`),
    Markup.button.callback('🔙 Назад', 'back')
  ]), { parse_mode: 'HTML' })

})

speakingScene.enter(async (ctx) => {
  try {
    if (fs.existsSync('work.txt')) {
      const messageText = fs.readFileSync('work.txt', 'utf8');
      await sendOrEditMessage(ctx, messageText, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          Markup.button.callback('🔙 Назад', 'back')
        ])
      });
    }
  } catch (error) {
    console.error('Error entering speaking scene:', error);
  }
});

speakingScene.on('text', async (ctx) => {
  try {
    if(ctx.message.text.startsWith('/')) return ctx.scene.enter('start');
    ctx.session.usrmsg = ctx.message.text;
    const messageText = "Сообщение получено. Подтвердите отправку или отмените действие.";
    await sendOrEditMessage(ctx, messageText, Markup.inlineKeyboard([
      Markup.button.callback('✅ Да', 'yes'),
      Markup.button.callback('❌ Отмена', 'cancel')
    ]));
  } catch (error) {
    console.error('Error receiving text message:', error);
  }
});

speakingScene.action('yes', async (ctx) => {

  await ctx.answerCbQuery();
  try {
    ctx.deleteMessage();
    const link = await sendMessageAndGetLink(CHANNEL_ID, ctx.session.usrmsg, ctx.from.id);
    ctx.session.payload = ctx.session.payload || "";
    ctx.session.payload = link.uuid;
    ctx.session.previousMessageId = null;
    await ctx.scene.enter("msg");
  } catch (error) {
    await ctx.reply('Произошла ошибка при отправке сообщения. Попробуйте ещё раз позже.');
  }
});

speakingScene.action('cancel', async (ctx) => {
  await ctx.answerCbQuery();
  try {
    const messageText = 'Отправка отменена.';
    await sendOrEditMessage(ctx, messageText);
    ctx.scene.enter('start');
  } catch (error) {
    console.error('Error cancelling message:', error);
  }
});

bot.use(session());
bot.use(stage.middleware());

bot.on("text", async (ctx, next) => {
  const chatId = ctx.chat.id;
  const oldctx = ctx;
  if (chatId === -1002187980979) {
    // ctx.deleteMessage(oldctx.message.message_id)
    // ctx.reply(oldctx.message.text)
    if(oldctx.message.reply_to_message) {
       const thid = oldctx.message.reply_to_message.message_id
       const user = await User.findOne({ telegram_id: oldctx.from.id });
       const message = await Message.findOne({ id: thid });
       if(!message) return
       if(user.uuid === message.ownuuid) return;
       const thown = await User.findOne({ uuid: message.ownuuid });
       ctx.telegram.sendMessage(thown.telegram_id, "Вам ответили:\n" + oldctx.message.text, Markup.inlineKeyboard([
         Markup.button.url('📖 Ответить', `https://t.me/${CHANNEL_ID.replace('@', '')}/${message.id}/`)
       ]))
     }
  }
  next()
})


bot.start(async (ctx) => {
  const ref = ctx.startPayload
  const userId = ctx.from.id;
  var newUsr = false;
  const user = await User.findOne({ telegram_id: userId }); 
  if (!user) {
    var newUser = new User({
      telegram_id: userId
    })
    newUsr = true;
    await newUser.save()
    user = newUser;
  }
  try {
    if(ref) {
      ctx.session.payload = ctx.session.payload || "";
      ctx.session.payload = ref;
      if(newUsr) {
        const userM = await Message.findOne({ uuid: ref });
        userM.joins += 1;

        const ownuser = await User.findOne({ uuid: userM.ownuuid });
        ctx.telegram.sendMessage(ownuser.telegram_id, `Пользователь ??? присоединился по вашей ссылке, но «Он» не знает кто Вы.`)
      userM.save()
      }
      return ctx.scene.enter('msg');
    } else {
      return ctx.scene.enter('start');
    }
  } catch (error) {
    console.error('Error starting bot:', error);
  }
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Function to send or edit previous message
async function sendOrEditMessage(ctx, newText, options = {}) {
  if (ctx.session.previousMessageId) {
    try {
      await ctx.telegram.editMessageText(ctx.chat.id, ctx.session.previousMessageId, null, newText, options);
    } catch (error) {
      const message = await ctx.reply(newText, options);
      ctx.session.previousMessageId = message.message_id;
    }
  } else {
    const message = await ctx.reply(newText, options);
    ctx.session.previousMessageId = message.message_id;
  }
}

// Function to send message to channel and return link
async function sendMessageAndGetLink(CHANNEL_ID, userMessage, uid) {
  try {
    const user = await User.findOne({ telegram_id: uid });

    const msg = await Message({
      uuid: uuidv4(),
      ownuuid: user.uuid,
      message: userMessage
    })

    const message = await bot.telegram.sendMessage(CHANNEL_ID, `${userMessage}\n\n🥀 • <a href="https://t.me/${bot.botInfo.username}?start=${msg.uuid}">${bot.botInfo.first_name}</a>`, {
      parse_mode: 'HTML',
      link_preview_options: {
        is_disabled: true
      }
    });
    msg.id = message.message_id;
    await msg.save()
    return msg;
  } catch (error) {
    throw error;
  }
}

bot.catch((err) => {
  console.error('Error:', err);
})

app.listen(port, () => {
  console.log('Server started on port', port);
  bot.launch()
})

async function shortenUrl(longUrl) {
    try {
        const response = await axios.get(`https://clck.ru/--?url=${encodeURIComponent(longUrl)}`);
        return response.data;
    } catch (error) {
        return longUrl;
    }
}