// Telegram API helpery přes grammy — reply keyboard verze

import { Api } from 'grammy';
import { config } from './config.js';

const api = new Api(config.telegramBotToken);

const CHAT_ID = config.telegramChatId;

/** Pošle textovou zprávu s volitelnou reply klávesnicí */
export async function sendMessage(text, replyKeyboard = null) {
  const options = { parse_mode: 'HTML' };
  if (replyKeyboard) {
    options.reply_markup = replyKeyboard;
  }
  const msg = await api.sendMessage(CHAT_ID, text, options);
  return msg.message_id;
}

/** Pošle zprávu a explicitně odstraní reply klávesnici */
export async function sendMessageRemoveKeyboard(text) {
  const options = {
    parse_mode: 'HTML',
    reply_markup: { remove_keyboard: true },
  };
  const msg = await api.sendMessage(CHAT_ID, text, options);
  return msg.message_id;
}

/** Odpověď na callback query (legacy — jen aby neblokoval UI) */
export async function answerCallbackQuery(callbackQueryId, text = '') {
  try {
    await api.answerCallbackQuery(callbackQueryId, { text });
  } catch (err) {
    console.log(`Nelze odpovědět na callback query: ${err.message}`);
  }
}

/** Načte čekající updaty z Telegramu (long polling bez čekání) */
export async function getUpdates(offset) {
  const updates = await api.getUpdates({
    offset,
    limit: 100,
    timeout: 0,
    allowed_updates: ['message', 'callback_query'],
  });
  return updates;
}

/** Reply klávesnice pro fact — rating 1-10, Víc, Už znám */
export function factReplyKeyboard() {
  return {
    keyboard: [
      [{ text: '1' }, { text: '2' }, { text: '3' }, { text: '4' }, { text: '5' }],
      [{ text: '6' }, { text: '7' }, { text: '8' }, { text: '9' }, { text: '10' }],
      [{ text: '📖 Víc' }],
      [{ text: '✓ Už znám' }],
    ],
    one_time_keyboard: true,
    resize_keyboard: true,
    selective: false,
  };
}

/** Reply klávesnice pro kvíz — A B C D */
export function quizReplyKeyboard() {
  return {
    keyboard: [
      [{ text: 'A' }, { text: 'B' }, { text: 'C' }, { text: 'D' }],
    ],
    one_time_keyboard: true,
    resize_keyboard: true,
    selective: false,
  };
}

/** Kontrola jestli je chat ID autorizovaný */
export function isAuthorized(chatId) {
  return Number(chatId) === CHAT_ID;
}
