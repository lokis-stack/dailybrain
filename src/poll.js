// Zpracování Telegram updates — text-based parsing (reply keyboard)

import {
  getUpdates,
  answerCallbackQuery,
  sendMessage,
  sendMessageRemoveKeyboard,
  isAuthorized,
} from './telegram.js';
import {
  getLastUpdateId,
  setLastUpdateId,
  getFactById,
  rateFact,
  markFactKnown,
  answerQuiz,
  incrementProfileCounter,
  getUserProfile,
  getLatestPendingFact,
  getLatestPendingQuiz,
  getManualFactState,
  setManualFactRequested,
} from './db.js';
import { updatePreferences } from './profile.js';
import { calculateNextReview } from './leitner.js';
import { expandFact } from './gemini.js';
import { generateAllTimeStats } from './stats.js';

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

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
        // Legacy callback z inline klávesnic — odpověz aby neblokoval UI
        console.log(`Legacy callback query: ${update.callback_query.data}`);
        await answerCallbackQuery(update.callback_query.id, 'Tato klávesnice už nefunguje. Použij textové odpovědi.');
      } else if (update.message?.text) {
        await handleMessage(update.message);
      } else {
        console.log(`Jiný typ updatu: ${update.update_id}`);
      }
    } catch (err) {
      console.error(`Chyba při zpracování update ${update.update_id}:`, err.message);
    }

    // Posun offsetu po každém zpracovaném updatu
    await setLastUpdateId(update.update_id);
  }
}

/** Zpracování textových zpráv */
async function handleMessage(message) {
  const chatId = message.chat?.id;

  if (!isAuthorized(chatId)) {
    console.log(`Neautorizovaný chat: ${chatId}`);
    return;
  }

  const raw = message.text?.trim() || '';
  const lower = raw.toLowerCase();

  console.log(`Text od uživatele: "${raw}"`);

  // --- Commands ---
  if (raw === '/start') {
    await handleStart();
    return;
  }

  if (raw === '/stats') {
    const statsText = await generateAllTimeStats();
    await sendMessageRemoveKeyboard(statsText);
    console.log('Výsledek: /stats odeslán');
    return;
  }

  if (raw === '/new') {
    await handleNew();
    return;
  }

  // --- Víc ---
  if (lower === '📖 víc' || lower === 'víc' || lower === 'vic') {
    await handleMore();
    return;
  }

  // --- Už znám ---
  if (lower === '✓ už znám' || lower === 'už znám' || lower === 'uz znam') {
    await handleKnown();
    return;
  }

  // --- Rating 1-10 ---
  const num = Number(raw);
  if (Number.isInteger(num) && num >= 1 && num <= 10) {
    await handleRating(num);
    return;
  }

  // --- Kvíz odpověď A-D ---
  const quizMatch = raw.match(/^([A-Da-d])$/);
  if (quizMatch) {
    const letterIndex = quizMatch[1].toUpperCase().charCodeAt(0) - 65; // A=0, B=1, C=2, D=3
    await handleQuizAnswer(letterIndex);
    return;
  }

  // --- Cokoliv jiného ---
  console.log(`Ignoruji zprávu: "${raw.substring(0, 50)}"`);
}

/** /start command */
async function handleStart() {
  const profile = await getUserProfile();
  if (profile && profile.total_facts_delivered > 0) {
    await sendMessageRemoveKeyboard('Už jedeme! 🚀 Fakty chodí automaticky.');
  } else {
    await sendMessageRemoveKeyboard(
      '👋 Ahoj! Jsem DailyBrain — tvůj osobní learning bot.\n\n' +
      'Budu ti posílat zajímavé fakty 3× denně a večer kvíz z toho, co už znáš.\n\n' +
      'Hodnoť fakty 1-10 (💩→🔥) a já se naučím, co tě baví.\n\n' +
      'Příkazy:\n/stats — tvoje statistiky\n/new — vyžádej si nový fact hned\n\nPrvní fact přijde v nejbližším slotu!'
    );
  }
  console.log('Výsledek: /start zpracován');
}

/** /new command — vyžádání manuálního factu */
async function handleNew() {
  const state = await getManualFactState();

  // Rate limit: 10 minut od posledního manuálního factu
  if (state.lastSent) {
    const lastSentTime = new Date(state.lastSent).getTime();
    const elapsed = Date.now() - lastSentTime;
    const tenMinMs = 10 * 60 * 1000;
    if (elapsed < tenMinMs) {
      const remaining = Math.ceil((tenMinMs - elapsed) / 60000);
      await sendMessageRemoveKeyboard(`⏳ Chvilku počkej, před pár minutami jsi jeden dostal. Zkus to za ${remaining} min.`);
      console.log(`Výsledek: /new rate limited (zbývá ${remaining} min)`);
      return;
    }
  }

  await setManualFactRequested(true);
  await sendMessageRemoveKeyboard('✓ Dobře, nový fact ti posílám při nejbližším ticku (do 5 minut)');
  console.log('Výsledek: /new — flag nastaven');
}

/** Rating 1-10 na poslední pending fact */
async function handleRating(rating) {
  const fact = await getLatestPendingFact();

  if (!fact) {
    console.log('Výsledek: rating ignorován (žádný pending fact)');
    return;
  }

  // Kontrola stáří — starší 12h ignoruj
  const deliveredAt = new Date(fact.delivered_at).getTime();
  if (Date.now() - deliveredAt > TWELVE_HOURS_MS) {
    await sendMessageRemoveKeyboard('Tohle už je starý fact, nezapisuji. Další přijde podle rozvrhu.');
    console.log(`Výsledek: rating ignorován (fact #${fact.id} starší 12h)`);
    return;
  }

  await rateFact(fact.id, rating);
  await updatePreferences(fact.category, rating);

  // Zpětná vazba podle ratingu
  let response;
  if (rating >= 9) {
    response = '🔥 Super, tohle si píšu jako top téma!';
  } else if (rating >= 7) {
    response = '✓ Díky, zapsáno';
  } else if (rating >= 4) {
    response = '👌 Ok, zapsáno';
  } else {
    response = '📝 Jasný, tohle tě moc nebralo — budu to brát v potaz';
  }

  await sendMessageRemoveKeyboard(response);
  console.log(`Výsledek: rating ${rating} aplikován na fact #${fact.id}`);
}

/** "Víc" — rozšíří poslední pending fact přes Gemini */
async function handleMore() {
  const fact = await getLatestPendingFact();

  if (!fact) {
    console.log('Výsledek: "Víc" ignorováno (žádný pending fact)');
    return;
  }

  try {
    const expanded = await expandFact(fact.content);
    // Pošli bez klávesnice — fact zůstává pending, uživatel může dál hodnotit
    await sendMessageRemoveKeyboard(`📖 Víc k tématu:\n\n${expanded}`);
    console.log(`Výsledek: rozšíření odesláno pro fact #${fact.id}`);
  } catch (err) {
    console.error('Chyba při generování rozšíření:', err.message);
    await sendMessageRemoveKeyboard('Omlouvám se, nepodařilo se vygenerovat rozšíření.');
  }
}

/** "Už znám" — označí poslední pending fact jako known */
async function handleKnown() {
  const fact = await getLatestPendingFact();

  if (!fact) {
    console.log('Výsledek: "Už znám" ignorováno (žádný pending fact)');
    return;
  }

  // known je finální stav — pokud už je known, neměň
  if (fact.status === 'known') {
    console.log(`Výsledek: fact #${fact.id} už je known`);
    return;
  }

  await markFactKnown(fact.id);
  await sendMessageRemoveKeyboard('✓ Ok, přeskakuji — nezapočítám si to do preferencí');
  console.log(`Výsledek: fact #${fact.id} označen jako known`);
}

/** Kvíz odpověď A-D */
async function handleQuizAnswer(answerIndex) {
  const quiz = await getLatestPendingQuiz();

  if (!quiz) {
    await sendMessageRemoveKeyboard('Nemám pro tebe teď žádný kvíz.');
    console.log('Výsledek: kvíz odpověď ignorována (žádný pending kvíz)');
    return;
  }

  // Pokud už zodpovězen, ignoruj
  if (quiz.status === 'answered') {
    console.log(`Výsledek: kvíz #${quiz.id} už zodpovězen`);
    return;
  }

  const isCorrect = answerIndex === quiz.correct_index;
  const { newBox, nextReviewAt } = calculateNextReview(quiz.leitner_box, isCorrect);

  await answerQuiz(quiz.id, answerIndex, isCorrect, newBox, nextReviewAt);

  if (isCorrect) {
    await incrementProfileCounter('total_quizzes_correct');
  }

  // Recap ze zdrojového factu
  const fact = await getFactById(quiz.source_fact_id);
  const recap = fact ? fact.content.substring(0, 150) : '';
  const options = JSON.parse(quiz.options_json);
  const correctLetter = ['A', 'B', 'C', 'D'][quiz.correct_index];

  if (isCorrect) {
    await sendMessageRemoveKeyboard(`✅ Správně! Připomenutí: ${recap}`);
    console.log(`Výsledek: kvíz #${quiz.id} správně`);
  } else {
    await sendMessageRemoveKeyboard(
      `❌ Bylo to ${correctLetter}) ${options[quiz.correct_index]}.\n\nPřipomenutí: ${recap}`
    );
    console.log(`Výsledek: kvíz #${quiz.id} špatně (odpověď ${['A','B','C','D'][answerIndex]}, správně ${correctLetter})`);
  }
}
