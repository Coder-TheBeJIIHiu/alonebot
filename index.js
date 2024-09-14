const { Telegraf, Markup, Scenes, session } = require('telegraf');
const fs = require('fs');
const express = require('express');

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
const port = process.env.PORT || 3000;

const startScene = new Scenes.BaseScene('start');
const speakingScene = new Scenes.BaseScene('speaking');
const CHANNEL_ID = '@alone_speakchnl';
const stage = new Scenes.Stage([startScene, speakingScene]);

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
    const link = await sendMessageAndGetLink(CHANNEL_ID, ctx.session.usrmsg);
    const messageText = `Успешно! ✅\n\nСсылка на сообщение: <a href="${link}">ᴄʟɪᴄᴋ</a>.`;
    await ctx.reply(messageText, {
      parse_mode: 'HTML',
    });
    ctx.session.previousMessageId = null;
    await ctx.scene.enter("start");
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

bot.start(async (ctx) => {
  try {
    ctx.scene.enter('start');
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
      console.error('Error editing message:', error);
    }
  } else {
    const message = await ctx.reply(newText, options);
    ctx.session.previousMessageId = message.message_id;
  }
}

// Function to send message to channel and return link
async function sendMessageAndGetLink(CHANNEL_ID, userMessage) {
  try {
    const message = await bot.telegram.sendMessage(CHANNEL_ID, `${userMessage}\n\n🥀 • <a href="tg://user?id=${bot.botInfo.id}">${bot.botInfo.first_name}</a>`, {
      parse_mode: 'HTML'
    });
    const messageId = message.message_id;
    const link = `https://t.me/${CHANNEL_ID.replace('@', '')}/${messageId}`;
    return link;
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