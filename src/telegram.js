// Telegram API helpery přes grammy

import { Api } from 'grammy';
import { config } from './config.js';

const api = new Api(config.telegramBotToken);

const CHAT_ID = config.telegramChatId;

/** Pošle textovou zprávu s volitelnou inline klávesnicí */
export async function sendMessage(text, inlineKeyboard = null) {
  const options = { parse_mode: 'HTML' };
  if (inlineKeyboard) {
    options.reply_markup = { inline_keyboard: inlineKeyboard };
  }
  const msg = await api.sendMessage(CHAT_ID, text, options);
  return msg.message_id;
}

/** Odstraní inline klávesnici ze zprávy */
export async function removeKeyboard(messageId) {
  try {
    await api.editMessageReplyMarkup(CHAT_ID, messageId, { reply_markup: { inline_keyboard: [] } });
  } catch (err) {
    // Zpráva mohla být smazána nebo klávesnice už neexistuje — ignoruj
    console.log(`Nelze odebrat klávesnici z msg ${messageId}: ${err.message}`);
  }
}

/** Odpověď na callback query (potvrzení kliknutí na tlačítko) */
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
    timeout: 0, // nečekej, vrať co je
    allowed_updates: ['message', 'callback_query'],
  });
  return updates;
}

/** Inline klávesnice pro fact — řady: 1-5, 6-10, Víc|Už znám */
export function factKeyboard(factId) {
  return [
    // Řada 1: tlačítka 1-5
    [1, 2, 3, 4, 5].map(n => ({
      text: String(n),
      callback_data: `rate:${factId}:${n}`,
    })),
    // Řada 2: tlačítka 6-10
    [6, 7, 8, 9, 10].map(n => ({
      text: String(n),
      callback_data: `rate:${factId}:${n}`,
    })),
    // Řada 3: Víc | Už znám
    [
      { text: '📖 Víc', callback_data: `more:${factId}` },
      { text: '✓ Už znám', callback_data: `known:${factId}` },
    ],
  ];
}

/** Inline klávesnice pro kvíz — A B C D */
export function quizKeyboard(quizId) {
  return [
    ['A', 'B', 'C', 'D'].map((letter, i) => ({
      text: letter,
      callback_data: `quiz:${quizId}:${i}`,
    })),
  ];
}

/** Kontrola jestli je chat ID autorizovaný */
export function isAuthorized(chatId) {
  return Number(chatId) === CHAT_ID;
}
