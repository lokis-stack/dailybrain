// Zpracování Telegram updates — callback queries a textové příkazy

import {
  getUpdates,
  answerCallbackQuery,
  sendMessage,
  removeKeyboard,
  isAuthorized,
} from './telegram.js';
import {
  getLastUpdateId,
  setLastUpdateId,
  getFactByMessageId,
  getFactById,
  rateFact,
  markFactKnown,
  getQuizByMessageId,
  answerQuiz,
  incrementProfileCounter,
  getUserProfile,
} from './db.js';
import { updatePreferences } from './profile.js';
import { calculateNextReview } from './leitner.js';
import { expandFact } from './gemini.js';
import { generateAllTimeStats } from './stats.js';

/** Hlavní funkce — přečte a zpracuje všechny čekající Telegram updaty */
export async function processPoll() {
  const lastId = await getLastUpdateId();
  const updates = await getUpdates(lastId + 1);

  if (updates.length === 0) {
    console.log('Žádné nové updaty.');
    return;
  }

  console.log(`Zpracovávám ${updates.length} updatů.`);

  for (const update of updates) {
    try {
      if (update.callback_query) {
        await handleCallback(update.callback_query);
      } else if (update.message?.text) {
        await handleMessage(update.message);
      }
    } catch (err) {
      console.error(`Chyba při zpracování update ${update.update_id}:`, err.message);
    }

    // Posun offsetu po každém zpracovaném updatu
    await setLastUpdateId(update.update_id);
  }
}

/** Zpracování textových zpráv (commands) */
async function handleMessage(message) {
  const chatId = message.chat?.id;

  if (!isAuthorized(chatId)) {
    console.log(`Neautorizovaný chat: ${chatId}`);
    return;
  }

  const text = message.text?.trim();

  if (text === '/start') {
    const profile = await getUserProfile();
    // Pokud už profil existuje a má nějaká data, je to opakovaný start
    if (profile && profile.total_facts_delivered > 0) {
      await sendMessage('Už jedeme! 🚀 Fakty chodí automaticky.');
    } else {
      await sendMessage(
        '👋 Ahoj! Jsem DailyBrain — tvůj osobní learning bot.\n\n' +
        'Budu ti posílat zajímavé fakty 3× denně a večer kvíz z toho, co už znáš.\n\n' +
        'Hodnoť fakty 1-10 (💩→🔥) a já se naučím, co tě baví.\n\n' +
        'Příkazy:\n/stats — tvoje statistiky\n\nPrvní fact přijde v nejbližším slotu!'
      );
    }
    return;
  }

  if (text === '/stats') {
    const statsText = await generateAllTimeStats();
    await sendMessage(statsText);
    return;
  }

  // Ostatní zprávy ignoruj (můžeš logovat)
  console.log(`Ignoruji zprávu: "${text?.substring(0, 50)}"`);
}

/** Zpracování callback queries (kliknutí na inline tlačítka) */
async function handleCallback(callback) {
  const chatId = callback.message?.chat?.id;

  if (!isAuthorized(chatId)) {
    console.log(`Neautorizovaný callback chat: ${chatId}`);
    return;
  }

  const data = callback.data;
  const messageId = callback.message?.message_id;
  const callbackId = callback.id;

  if (!data || !messageId) return;

  // Parsování callback dat: "akce:id:hodnota"
  const parts = data.split(':');
  const action = parts[0];

  if (action === 'rate') {
    // Rating factu: rate:factId:rating
    const factId = Number(parts[1]);
    const rating = Number(parts[2]);
    await handleRating(factId, rating, messageId, callbackId);
  } else if (action === 'more') {
    // Rozšíření factu: more:factId
    const factId = Number(parts[1]);
    await handleMore(factId, callbackId);
  } else if (action === 'known') {
    // Už znám: known:factId
    const factId = Number(parts[1]);
    await handleKnown(factId, messageId, callbackId);
  } else if (action === 'quiz') {
    // Odpověď na kvíz: quiz:quizId:answerIndex
    const quizId = Number(parts[1]);
    const answerIndex = Number(parts[2]);
    await handleQuizAnswer(quizId, answerIndex, messageId, callbackId);
  }
}

/** Zpracování ratingu factu */
async function handleRating(factId, rating, messageId, callbackId) {
  const fact = await getFactById(factId);
  if (!fact) {
    await answerCallbackQuery(callbackId, 'Fact nenalezen.');
    return;
  }

  // Pokud už byl ohodnocen, ignoruj
  if (fact.status === 'rated') {
    await answerCallbackQuery(callbackId, 'Už ohodnoceno.');
    return;
  }

  await rateFact(factId, rating);
  await updatePreferences(fact.category, rating);
  await removeKeyboard(messageId);
  await answerCallbackQuery(callbackId, 'Díky, zapsáno ✓');
}

/** Zpracování tlačítka "Víc" — rozšíří fact přes Gemini */
async function handleMore(factId, callbackId) {
  const fact = await getFactById(factId);
  if (!fact) {
    await answerCallbackQuery(callbackId, 'Fact nenalezen.');
    return;
  }

  await answerCallbackQuery(callbackId, 'Generuji rozšíření...');

  try {
    const expanded = await expandFact(fact.content);
    await sendMessage(`📖 Víc k tématu:\n\n${expanded}`);
  } catch (err) {
    console.error('Chyba při generování rozšíření:', err.message);
    await sendMessage('Omlouvám se, nepodařilo se vygenerovat rozšíření.');
  }
}

/** Zpracování tlačítka "Už znám" */
async function handleKnown(factId, messageId, callbackId) {
  const fact = await getFactById(factId);
  if (!fact) {
    await answerCallbackQuery(callbackId, 'Fact nenalezen.');
    return;
  }

  await markFactKnown(factId);
  await removeKeyboard(messageId);
  await answerCallbackQuery(callbackId, 'OK, přeskakuji ✓');
}

/** Zpracování odpovědi na kvíz */
async function handleQuizAnswer(quizId, answerIndex, messageId, callbackId) {
  const quiz = await getQuizByMessageId(messageId);
  if (!quiz) {
    await answerCallbackQuery(callbackId, 'Kvíz nenalezen.');
    return;
  }

  // Pokud už byl zodpovězen, ignoruj
  if (quiz.status === 'answered') {
    await answerCallbackQuery(callbackId, 'Už zodpovězeno.');
    return;
  }

  const isCorrect = answerIndex === quiz.correct_index;
  const { newBox, nextReviewAt } = calculateNextReview(quiz.leitner_box, isCorrect);

  await answerQuiz(quizId, answerIndex, isCorrect, newBox, nextReviewAt);
  await removeKeyboard(messageId);

  if (isCorrect) {
    await incrementProfileCounter('total_quizzes_correct');
  }

  // Načti zdrojový fact pro recap
  const fact = await getFactById(quiz.source_fact_id);
  const recap = fact ? fact.content.substring(0, 150) : '';
  const options = JSON.parse(quiz.options_json);
  const correctLetter = ['A', 'B', 'C', 'D'][quiz.correct_index];

  if (isCorrect) {
    await answerCallbackQuery(callbackId, '✅ Správně!');
    await sendMessage(`✅ Správně! Připomenutí: ${recap}`);
  } else {
    await answerCallbackQuery(callbackId, `❌ Bylo to ${correctLetter}`);
    await sendMessage(
      `❌ Bylo to ${correctLetter}) ${options[quiz.correct_index]}.\n\nPřipomenutí: ${recap}`
    );
  }
}
