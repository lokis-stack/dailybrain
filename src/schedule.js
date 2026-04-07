// Plánovač — rozhoduje co poslat v aktuálním ticku

import { getActiveSlots, slotKey, getCurrentContentSlot, getSlotForTime, pragueNow } from './time.js';
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
  insertQuiz,
  markQuizDelivered,
  incrementProfileCounter,
  getManualFactState,
  setManualFactSent,
} from './db.js';
import { sendMessage, factReplyKeyboard, quizReplyKeyboard } from './telegram.js';
import { generateFact, generateQuiz } from './gemini.js';
import { getPreferences, pickCategory, normalizeCategory } from './profile.js';
import { generateWeeklyStats } from './stats.js';

/** Hlavní funkce — spouští se každý tick */
export async function processSchedule() {
  // 1. Označ expired (3h+) fakty/kvízy jako missed
  await expireOldItems();

  // 2. Pošli remindery (1h+ bez odpovědi, jen pokud jsme stále ve stejném slotu)
  await sendReminders();

  // 3. Manuální /new fact — pokud byl vyžádán, pošli a přeskoč slot v tomto ticku
  const manualSent = await processManualFact();

  // 4. Projdi aktivní sloty a pošli co je potřeba (pokud nebyl manuál)
  if (!manualSent) {
    await processActiveSlots();
  } else {
    console.log('Manuální fact odeslán — sloty přeskočeny v tomto ticku.');
  }
}

/**
 * Zkontroluje flag manual_fact_requested, pokud je 1 → vygeneruje a pošle fact.
 * Nezapisuje do schedule_log. Vrací true pokud byl fact odeslán.
 */
async function processManualFact() {
  const state = await getManualFactState();
  if (!state.requested) return false;

  console.log('Zpracovávám manuální /new fact...');

  const category = await pickCategory();
  const preferences = await getPreferences();
  const recent = await getRecentFacts(10);

  const factData = await generateFact(preferences, recent, category);
  const cat = normalizeCategory(factData.category);
  const factId = await insertFact(factData.content, cat, factData.length);

  const text = `💡 ${cat}\n\n${factData.content}`;
  const msgId = await sendMessage(text, factReplyKeyboard());

  await markFactDelivered(factId, msgId);
  await incrementProfileCounter('total_facts_delivered');
  await setManualFactSent();

  console.log(`Manuální fact #${factId} odeslán (${cat}).`);
  return true;
}

/**
 * Catch-up logika: projde všechny právě aktivní sloty v pořadí,
 * pošle max 1 content slot za tick (+ weekly jako výjimka navíc).
 */
async function processActiveSlots() {
  const activeSlots = getActiveSlots();

  if (activeSlots.length === 0) {
    console.log('Žádný aktivní slot.');
    return;
  }

  console.log(`Aktivní sloty: ${activeSlots.join(', ')}`);

  let contentSent = false; // max 1 content zpráva (fact/kvíz) za tick

  for (const slot of activeSlots) {
    const key = slotKey(slot);

    if (await isSlotDone(key)) {
      continue; // už odesláno dneska/tento týden
    }

    // Weekly je výjimka — může přijít spolu s content zprávou
    if (slot === 'weekly') {
      await sendWeeklyStats(key);
      continue;
    }

    // Content sloty: max 1 za tick
    if (contentSent) {
      console.log(`Slot ${slot} odložen na další tick (limit 1 content/tick).`);
      continue;
    }

    console.log(`Zpracovávám slot: ${slot} (${key})`);

    if (slot === 'quiz') {
      await sendQuizOrFact(key);
    } else {
      await sendNewFact(key);
    }

    contentSent = true;
  }

  if (!contentSent && activeSlots.every(s => s === 'weekly')) {
    console.log('Žádný nový content slot k odeslání.');
  }
}

/** Pošle nový fact vygenerovaný Gemini */
async function sendNewFact(key) {
  const category = await pickCategory();
  const preferences = await getPreferences();
  const recent = await getRecentFacts(10);

  console.log('Generuji nový fact...');
  const factData = await generateFact(preferences, recent, category);
  const cat = normalizeCategory(factData.category);

  // Ulož do DB
  const factId = await insertFact(factData.content, cat, factData.length);

  // Pošli přes Telegram
  const text = `💡 ${cat}\n\n${factData.content}`;
  const msgId = await sendMessage(text, factReplyKeyboard());

  // Označ jako doručený
  await markFactDelivered(factId, msgId);
  await incrementProfileCounter('total_facts_delivered');
  await markSlotDone(key);

  console.log(`Fact #${factId} odeslán (${cat}).`);
}

/** Ve quiz slotu — pošle kvíz nebo fallback na nový fact */
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
  const msgId = await sendMessage(text, quizReplyKeyboard());

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

/**
 * Pošle remindery — jen pokud jsme stále ve stejném slotu jako doručení.
 * Zjistí Prague čas doručení, určí v jakém slotu to bylo,
 * a porovná s aktuálním content slotem.
 */
async function sendReminders() {
  const currentSlot = getCurrentContentSlot();

  // Remindery pro fakty
  const unratedFacts = await getUnratedFactsNeedingReminder();
  for (const fact of unratedFacts) {
    if (isStillInDeliverySlot(fact.delivered_at, currentSlot)) {
      await sendMessage('⏰ Ještě jsi nehodnotil poslední zprávu');
      await setFactReminderSent(fact.id);
      console.log(`Reminder odeslán pro fact #${fact.id}`);
    } else {
      console.log(`Fact #${fact.id}: reminder přeskočen (jiný slot).`);
    }
  }

  // Remindery pro kvízy
  const unratedQuizzes = await getUnratedQuizzesNeedingReminder();
  for (const quiz of unratedQuizzes) {
    if (isStillInDeliverySlot(quiz.delivered_at, currentSlot)) {
      await sendMessage('⏰ Ještě jsi neodpověděl na kvíz');
      await setQuizReminderSent(quiz.id);
      console.log(`Reminder odeslán pro kvíz #${quiz.id}`);
    } else {
      console.log(`Kvíz #${quiz.id}: reminder přeskočen (jiný slot).`);
    }
  }
}

/**
 * Kontrola jestli je aktuální content slot stejný jako slot,
 * ve kterém byla zpráva doručena.
 */
function isStillInDeliverySlot(deliveredAtISO, currentSlot) {
  if (!currentSlot) return false; // jsme mimo jakýkoliv slot (např. před 9:00)

  // Převeď delivered_at UTC čas na Prague hodinu a minutu
  const deliveredDate = new Date(deliveredAtISO);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(deliveredDate);

  const deliveredHour = Number(parts.find(p => p.type === 'hour').value);
  const deliveredMinute = Number(parts.find(p => p.type === 'minute').value);
  const deliverySlot = getSlotForTime(deliveredHour, deliveredMinute);

  return deliverySlot === currentSlot;
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
