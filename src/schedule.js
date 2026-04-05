// Plánovač — rozhoduje co poslat v aktuálním ticku

import { detectSlot, slotKey } from './time.js';
import {
  isSlotDone,
  markSlotDone,
  insertFact,
  markFactDelivered,
  getRecentFacts,
  getUnratedFactsNeedingReminder,
  getExpiredPendingFacts,
  getUnratedQuizzesNeedingReminder,
  getExpiredPendingQuizzes,
  setFactReminderSent,
  setQuizReminderSent,
  markFactMissed,
  markQuizMissed,
  getDueQuizzes,
  getFactsForNewQuiz,
  getFactById,
  insertQuiz,
  markQuizDelivered,
  incrementProfileCounter,
} from './db.js';
import { sendMessage, factKeyboard, quizKeyboard } from './telegram.js';
import { generateFact, generateQuiz } from './gemini.js';
import { getPreferences } from './profile.js';
import { generateWeeklyStats } from './stats.js';

/** Hlavní funkce — spouští se každý tick */
export async function processSchedule() {
  // 1. Označ expired (3h+) fakty/kvízy jako missed
  await expireOldItems();

  // 2. Pošli remindery (30min+ bez odpovědi)
  await sendReminders();

  // 3. Detekuj aktuální slot a pošli obsah
  const slot = detectSlot();
  if (!slot) {
    console.log('Žádný aktivní slot.');
    return;
  }

  const key = slotKey(slot);
  if (await isSlotDone(key)) {
    console.log(`Slot ${key} už byl odeslán.`);
    return;
  }

  console.log(`Aktivní slot: ${slot} (${key})`);

  if (slot === 'weekly') {
    await sendWeeklyStats(key);
  } else if (slot === 'quiz') {
    await sendQuizOrFact(key);
  } else {
    // morning, noon, afternoon — nový fact
    await sendNewFact(key);
  }
}

/** Pošle nový fact vygenerovaný Gemini */
async function sendNewFact(key) {
  const preferences = await getPreferences();
  const recent = await getRecentFacts(10);

  console.log('Generuji nový fact...');
  const factData = await generateFact(preferences, recent);

  // Ulož do DB
  const factId = await insertFact(factData.content, factData.category, factData.length);

  // Pošli přes Telegram
  const text = `💡 ${factData.category}\n\n${factData.content}`;
  const msgId = await sendMessage(text, factKeyboard(factId));

  // Označ jako doručený
  await markFactDelivered(factId, msgId);
  await incrementProfileCounter('total_facts_delivered');
  await markSlotDone(key);

  console.log(`Fact #${factId} odeslán (${factData.category}).`);
}

/** Ve 20:00 — pošle kvíz nebo fallback na nový fact */
async function sendQuizOrFact(key) {
  // Priorita 1: Existující kvízy k opakování (spaced repetition)
  const dueQuizzes = await getDueQuizzes();
  if (dueQuizzes.length > 0) {
    const due = dueQuizzes[0];
    console.log(`Regeneruji kvíz pro fact #${due.source_fact_id}...`);
    const quizData = await generateQuiz(due.fact_content);
    const quizId = await insertQuiz(
      due.source_fact_id,
      quizData.question,
      quizData.options,
      quizData.correct_index
    );
    await sendQuizMessage(quizId, quizData);
    await markSlotDone(key);
    return;
  }

  // Priorita 2: Nový kvíz z nekvízovaného factu
  const factForQuiz = await getFactsForNewQuiz();
  if (factForQuiz) {
    console.log(`Generuji nový kvíz z fact #${factForQuiz.id}...`);
    const quizData = await generateQuiz(factForQuiz.content);
    const quizId = await insertQuiz(
      factForQuiz.id,
      quizData.question,
      quizData.options,
      quizData.correct_index
    );
    await sendQuizMessage(quizId, quizData);
    await markSlotDone(key);
    return;
  }

  // Priorita 3: Fallback — pošli nový fact místo kvízu
  console.log('Není z čeho dělat kvíz, posílám fact.');
  await sendNewFact(key);
}

/** Pošle kvíz zprávu */
async function sendQuizMessage(quizId, quizData) {
  const letters = ['A', 'B', 'C', 'D'];
  const optionsText = quizData.options
    .map((opt, i) => `${letters[i]}) ${opt}`)
    .join('\n');

  const text = `🧠 Kvíz: pamatuješ si tohle?\n\n${quizData.question}\n\n${optionsText}`;
  const msgId = await sendMessage(text, quizKeyboard(quizId));

  await markQuizDelivered(quizId, msgId);
  await incrementProfileCounter('total_quizzes_delivered');

  console.log(`Kvíz #${quizId} odeslán.`);
}

/** Pošle týdenní statistiku */
async function sendWeeklyStats(key) {
  const statsText = await generateWeeklyStats();
  await sendMessage(statsText);
  await markSlotDone(key);
  console.log('Týdenní statistika odeslána.');
}

/** Pošle remindery pro nehodnocené fakty a nezodpovězené kvízy */
async function sendReminders() {
  // Remindery pro fakty
  const unratedFacts = await getUnratedFactsNeedingReminder();
  for (const fact of unratedFacts) {
    await sendMessage('⏰ Ještě jsi nehodnotil poslední zprávu');
    await setFactReminderSent(fact.id);
    console.log(`Reminder odeslán pro fact #${fact.id}`);
  }

  // Remindery pro kvízy
  const unratedQuizzes = await getUnratedQuizzesNeedingReminder();
  for (const quiz of unratedQuizzes) {
    await sendMessage('⏰ Ještě jsi neodpověděl na kvíz');
    await setQuizReminderSent(quiz.id);
    console.log(`Reminder odeslán pro kvíz #${quiz.id}`);
  }
}

/** Označ staré nehodnocené položky jako missed */
async function expireOldItems() {
  const expiredFacts = await getExpiredPendingFacts();
  for (const fact of expiredFacts) {
    await markFactMissed(fact.id);
    console.log(`Fact #${fact.id} označen jako missed.`);
  }

  const expiredQuizzes = await getExpiredPendingQuizzes();
  for (const quiz of expiredQuizzes) {
    await markQuizMissed(quiz.id);
    console.log(`Kvíz #${quiz.id} označen jako missed.`);
  }
}
