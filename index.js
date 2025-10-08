// index.js (Replit)
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Telegraf, Markup } = require('telegraf');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ENCODER_URL = process.env.ENCODER_URL; // set this after you get Colab ngrok URL
const SHARED_SECRET = process.env.SHARED_SECRET || '';

if (!BOT_TOKEN) {
  console.error('Set BOT_TOKEN in Replit Secrets');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Light web server so UptimeRobot can ping and keep the Repl awake
const app = express();
app.get('/', (req, res) => res.send('Telegram encoder bot is alive.'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Web server listening on ${PORT}`));

// store pending jobs by jobId so callback can find fileUrl
const pending = {};

// /start
bot.start(ctx => ctx.reply('Send a video (mp4 or mkv) as video or document. You will be asked for resolution.'));

// Accept video or document (file)
bot.on(['video', 'document'], async ctx => {
  try {
    const media = ctx.message.video || ctx.message.document;
    if (!media) return ctx.reply('Please send a video file (as Video or Document).');

    // get direct download link
    const fileLink = await ctx.telegram.getFileLink(media.file_id);
    const fileUrl = fileLink.href; // direct download URL

    const jobId = `${Date.now()}_${Math.floor(Math.random()*10000)}`;
    pending[jobId] = { fileUrl, chatId: ctx.chat.id };

    // inline keyboard for resolution
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('1080p', `enc:${jobId}:1080`)],
      [Markup.button.callback('720p', `enc:${jobId}:720`)],
      [Markup.button.callback('480p', `enc:${jobId}:480`)],
      [Markup.button.callback('360p', `enc:${jobId}:360`)]
    ]);
    await ctx.reply('Choose output resolution:', keyboard);
  } catch (err) {
    console.error('handle media error', err);
    await ctx.reply('Failed to read file. Try sending again.');
  }
});

bot.on('callback_query', async ctx => {
  const data = ctx.callbackQuery?.data;
  await ctx.answerCbQuery().catch(()=>{});
  if (!data || !data.startsWith('enc:')) return ctx.editMessageText('Invalid action.');

  const [, jobId, res] = data.split(':');
  const job = pending[jobId];
  if (!job) {
    return ctx.editMessageText('Job not found or expired. Please resend the file.');
  }

  if (!ENCODER_URL) {
    return ctx.editMessageText('Encoder URL not configured. Set ENCODER_URL secret and restart bot.');
  }

  // build payload
  const payload = {
    job_id: jobId,
    file_url: job.fileUrl,
    chat_id: job.chatId,
    resolution: res,
    secret: SHARED_SECRET
  };

  try {
    await ctx.editMessageText(`Queued for ${res}p encoding...`);
    const r = await axios.post(`${ENCODER_URL.replace(/\/+$/, '')}/enqueue`, payload, { timeout: 20000 });
    if (r.status === 200) {
      const pos = r.data.position || 'unknown';
      await ctx.reply(`✅ Job queued (position ${pos}). You will receive progress from the encoder.`);
      // remove pending
      delete pending[jobId];
    } else {
      await ctx.reply('❌ Failed to enqueue job on encoder.');
    }
  } catch (err) {
    console.error('enqueue error', err?.message || err);
    await ctx.reply('❌ Could not reach encoder. Make sure ENCODER_URL is correct.');
  }
});

bot.launch({ dropPendingUpdates: true }).then(() => console.log('Bot launched')).catch(console.error);
