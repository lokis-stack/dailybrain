// Turso databázový klient a CRUD operace

import { createClient } from '@libsql/client';
import { config } from './config.js';

const client = createClient({
  url: config.tursoDatabaseUrl,
  authToken: config.tursoAuthToken,
});

// ── Schéma ──────────────────────────────────────────────

export async function ensureSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      category TEXT NOT NULL,
      length TEXT NOT NULL,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      telegram_message_id INTEGER,
      rating INTEGER,
      rated_at TEXT,
      reminder_sent INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending'
    )`,
    `CREATE TABLE IF NOT EXISTS quizzes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_fact_id INTEGER NOT NULL,
      question TEXT NOT NULL,
      options_json TEXT NOT NULL,
      correct_index INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      telegram_message_id INTEGER,
      user_answer_index INTEGER,
      is_correct INTEGER,
      answered_at TEXT,
      reminder_sent INTEGER DEFAULT 0,
      leitner_box INTEGER DEFAULT 1,
      next_review_at TEXT,
      status TEXT DEFAULT 'pending',
      FOREIGN KEY (source_fact_id) REFERENCES facts(id)
    )`,
    `CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      preferences_json TEXT NOT NULL DEFAULT '{}',
      total_facts_delivered INTEGER DEFAULT 0,
      total_facts_rated INTEGER DEFAULT 0,
      total_quizzes_delivered INTEGER DEFAULT 0,
      total_quizzes_correct INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS schedule_log (
      slot_key TEXT PRIMARY KEY,
      sent_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS telegram_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_update_id INTEGER DEFAULT 0
    )`,
  ];

  for (const sql of statements) {
    await client.execute(sql);
  }

  // Výchozí řádky (ignoruj pokud existují)
  await client.execute({
    sql: `INSERT OR IGNORE INTO user_profile (id, preferences_json, created_at, updated_at)
          VALUES (1, '{}', ?, ?)`,
    args: [new Date().toISOString(), new Date().toISOString()],
  });
  await client.execute({
    sql: `INSERT OR IGNORE INTO telegram_state (id, last_update_id) VALUES (1, 0)`,
    args: [],
  });

  // Migrace: přidej sloupce pro /new command (bezpečné opakovat)
  const alterColumns = [
    `ALTER TABLE telegram_state ADD COLUMN manual_fact_requested INTEGER DEFAULT 0`,
    `ALTER TABLE telegram_state ADD COLUMN manual_fact_last_sent TEXT`,
  ];
  for (const sql of alterColumns) {
    try {
      await client.execute(sql);
    } catch (err) {
      // Sloupec už existuje — ignoruj
      if (!err.message.includes('duplicate column')) {
        console.log(`ALTER ignorován: ${err.message}`);
      }
    }
  }

  // Migrace: normalizuj kategorie na velké první písmeno
  const categoryMap = [
    ['psychologie', 'Psychologie'],
    ['filozofie', 'Filozofie'],
    ['ekonomie', 'Ekonomie'],
    ['příroda', 'Příroda'],
    ['věda', 'Věda'],
    ['historie', 'Historie'],
  ];
  for (const [lower, proper] of categoryMap) {
    await client.execute({
      sql: `UPDATE facts SET category = ? WHERE category = ?`,
      args: [proper, lower],
    });
  }

  // Normalizuj klíče v user_profile.preferences_json
  try {
    const profileResult = await client.execute('SELECT preferences_json FROM user_profile WHERE id = 1');
    const row = profileResult.rows[0];
    if (row && row.preferences_json) {
      const prefs = JSON.parse(row.preferences_json);
      const normalized = {};
      let changed = false;
      for (const [key, value] of Object.entries(prefs)) {
        const match = categoryMap.find(([l]) => l === key.toLowerCase());
        const properKey = match ? match[1] : key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
        if (properKey !== key) changed = true;
        normalized[properKey] = value;
      }
      if (changed) {
        await client.execute({
          sql: 'UPDATE user_profile SET preferences_json = ? WHERE id = 1',
          args: [JSON.stringify(normalized)],
        });
      }
    }
  } catch (err) {
    console.log(`Normalizace preferencí: ${err.message}`);
  }

  console.log('Schéma inicializováno.');
}

// ── Telegram state ──────────────────────────────────────

export async function getLastUpdateId() {
  const result = await client.execute('SELECT last_update_id FROM telegram_state WHERE id = 1');
  return result.rows[0]?.last_update_id ?? 0;
}

export async function setLastUpdateId(updateId) {
  await client.execute({
    sql: 'UPDATE telegram_state SET last_update_id = ? WHERE id = 1',
    args: [updateId],
  });
}

/** Vrátí stav manuálního fact requestu */
export async function getManualFactState() {
  const result = await client.execute('SELECT manual_fact_requested, manual_fact_last_sent FROM telegram_state WHERE id = 1');
  const row = result.rows[0];
  return {
    requested: Number(row?.manual_fact_requested) === 1,
    lastSent: row?.manual_fact_last_sent ?? null,
  };
}

export async function setManualFactRequested(value) {
  await client.execute({
    sql: 'UPDATE telegram_state SET manual_fact_requested = ? WHERE id = 1',
    args: [value ? 1 : 0],
  });
}

export async function setManualFactSent() {
  await client.execute({
    sql: 'UPDATE telegram_state SET manual_fact_requested = 0, manual_fact_last_sent = ? WHERE id = 1',
    args: [new Date().toISOString()],
  });
}

// ── Facts ───────────────────────────────────────────────

export async function insertFact(content, category, length) {
  const result = await client.execute({
    sql: `INSERT INTO facts (content, category, length, created_at, status)
          VALUES (?, ?, ?, ?, 'pending')`,
    args: [content, category, length, new Date().toISOString()],
  });
  return Number(result.lastInsertRowid);
}

export async function markFactDelivered(factId, telegramMessageId) {
  await client.execute({
    sql: `UPDATE facts SET delivered_at = ?, telegram_message_id = ?, status = 'delivered'
          WHERE id = ?`,
    args: [new Date().toISOString(), telegramMessageId, factId],
  });
}

export async function rateFact(factId, rating) {
  await client.execute({
    sql: `UPDATE facts SET rating = ?, rated_at = ?, status = 'rated' WHERE id = ?`,
    args: [rating, new Date().toISOString(), factId],
  });
}

export async function markFactKnown(factId) {
  await client.execute({
    sql: `UPDATE facts SET status = 'known', rated_at = ? WHERE id = ?`,
    args: [new Date().toISOString(), factId],
  });
}

export async function markFactMissed(factId) {
  await client.execute({
    sql: `UPDATE facts SET status = 'missed' WHERE id = ?`,
    args: [factId],
  });
}

export async function setFactReminderSent(factId) {
  await client.execute({
    sql: 'UPDATE facts SET reminder_sent = 1 WHERE id = ?',
    args: [factId],
  });
}

export async function getFactByMessageId(messageId) {
  const result = await client.execute({
    sql: 'SELECT * FROM facts WHERE telegram_message_id = ?',
    args: [messageId],
  });
  return result.rows[0] ?? null;
}

export async function getFactById(factId) {
  const result = await client.execute({
    sql: 'SELECT * FROM facts WHERE id = ?',
    args: [factId],
  });
  return result.rows[0] ?? null;
}

export async function getRecentFacts(limit = 10) {
  const result = await client.execute({
    sql: 'SELECT content FROM facts ORDER BY id DESC LIMIT ?',
    args: [limit],
  });
  return result.rows.map(r => r.content);
}

/** Vrátí kategorie posledních N doručených factů (pro recency penalty) */
export async function getRecentCategories(limit = 5) {
  const result = await client.execute({
    sql: 'SELECT category FROM facts WHERE delivered_at IS NOT NULL ORDER BY delivered_at DESC LIMIT ?',
    args: [limit],
  });
  return result.rows.map(r => r.category);
}

/** Fakty doručené před víc než 1 hodinu bez ratingu a bez reminderu */
export async function getUnratedFactsNeedingReminder() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const result = await client.execute({
    sql: `SELECT * FROM facts
          WHERE status = 'delivered' AND rating IS NULL
            AND reminder_sent = 0 AND delivered_at < ?`,
    args: [oneHourAgo],
  });
  return result.rows;
}

/** Fakty doručené před víc než 3 hod stále bez ratingu → missed */
export async function getExpiredPendingFacts() {
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const result = await client.execute({
    sql: `SELECT * FROM facts
          WHERE status = 'delivered' AND rating IS NULL AND delivered_at < ?`,
    args: [threeHoursAgo],
  });
  return result.rows;
}

// ── Quizzes ─────────────────────────────────────────────

export async function insertQuiz(sourceFactId, question, options, correctIndex) {
  const result = await client.execute({
    sql: `INSERT INTO quizzes (source_fact_id, question, options_json, correct_index, created_at, status)
          VALUES (?, ?, ?, ?, ?, 'pending')`,
    args: [sourceFactId, question, JSON.stringify(options), correctIndex, new Date().toISOString()],
  });
  return Number(result.lastInsertRowid);
}

export async function markQuizDelivered(quizId, telegramMessageId) {
  await client.execute({
    sql: `UPDATE quizzes SET delivered_at = ?, telegram_message_id = ?, status = 'delivered'
          WHERE id = ?`,
    args: [new Date().toISOString(), telegramMessageId, quizId],
  });
}

export async function answerQuiz(quizId, answerIndex, isCorrect, newBox, nextReviewAt) {
  await client.execute({
    sql: `UPDATE quizzes SET user_answer_index = ?, is_correct = ?, answered_at = ?,
          leitner_box = ?, next_review_at = ?, status = 'answered'
          WHERE id = ?`,
    args: [answerIndex, isCorrect ? 1 : 0, new Date().toISOString(), newBox, nextReviewAt, quizId],
  });
}

export async function getQuizByMessageId(messageId) {
  const result = await client.execute({
    sql: 'SELECT * FROM quizzes WHERE telegram_message_id = ?',
    args: [messageId],
  });
  return result.rows[0] ?? null;
}

export async function setQuizReminderSent(quizId) {
  await client.execute({
    sql: 'UPDATE quizzes SET reminder_sent = 1 WHERE id = ?',
    args: [quizId],
  });
}

export async function getUnratedQuizzesNeedingReminder() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const result = await client.execute({
    sql: `SELECT * FROM quizzes
          WHERE status = 'delivered' AND user_answer_index IS NULL
            AND reminder_sent = 0 AND delivered_at < ?`,
    args: [oneHourAgo],
  });
  return result.rows;
}

export async function getExpiredPendingQuizzes() {
  const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const result = await client.execute({
    sql: `SELECT * FROM quizzes
          WHERE status = 'delivered' AND user_answer_index IS NULL AND delivered_at < ?`,
    args: [threeHoursAgo],
  });
  return result.rows;
}

export async function markQuizMissed(quizId) {
  await client.execute({
    sql: `UPDATE quizzes SET status = 'missed' WHERE id = ?`,
    args: [quizId],
  });
}

/** Kvízy s next_review_at <= teď (pro spaced repetition) */
export async function getDueQuizzes() {
  const now = new Date().toISOString();
  const result = await client.execute({
    sql: `SELECT q.*, f.content as fact_content FROM quizzes q
          JOIN facts f ON f.id = q.source_fact_id
          WHERE q.status = 'answered' AND q.next_review_at <= ?
          ORDER BY q.next_review_at ASC LIMIT 5`,
    args: [now],
  });
  return result.rows;
}

/**
 * Vybere fact pro nový kvíz — ohodnocený, starší 2 dny,
 * vyloučí source_fact_id posledních N kvízů aby se neopakovaly.
 */
export async function getFactForQuiz() {
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  // Nejdřív zkus vyloučit posledních 5 source_fact_id
  let result = await client.execute({
    sql: `SELECT f.* FROM facts f
          WHERE f.rating IS NOT NULL AND f.status = 'rated' AND f.created_at < ?
            AND f.id NOT IN (
              SELECT DISTINCT source_fact_id FROM quizzes
              ORDER BY created_at DESC LIMIT 5
            )
          ORDER BY RANDOM() LIMIT 1`,
    args: [twoDaysAgo],
  });

  if (result.rows.length > 0) return result.rows[0];

  // Fallback: vyloučit jen posledních 3
  result = await client.execute({
    sql: `SELECT f.* FROM facts f
          WHERE f.rating IS NOT NULL AND f.status = 'rated' AND f.created_at < ?
            AND f.id NOT IN (
              SELECT DISTINCT source_fact_id FROM quizzes
              ORDER BY created_at DESC LIMIT 3
            )
          ORDER BY RANDOM() LIMIT 1`,
    args: [twoDaysAgo],
  });

  return result.rows[0] ?? null;
}

/** Vrátí předchozí kvízové otázky pro daný source fact (pro dedup v Gemini) */
export async function getPreviousQuizQuestions(sourceFactId) {
  const result = await client.execute({
    sql: 'SELECT question FROM quizzes WHERE source_fact_id = ? ORDER BY created_at DESC LIMIT 5',
    args: [sourceFactId],
  });
  return result.rows.map(r => r.question);
}

/** Vrátí všechny content stringy z tabulky facts (pro similarity check) */
export async function getAllFactContents() {
  const result = await client.execute({
    sql: 'SELECT content FROM facts',
    args: [],
  });
  return result.rows.map(r => r.content);
}

// ── Pending items (pro text-based poll) ─────────────────

/** Nejnovější doručený fact čekající na rating */
export async function getLatestPendingFact() {
  const result = await client.execute({
    sql: `SELECT * FROM facts
          WHERE status = 'delivered' AND rating IS NULL
          ORDER BY delivered_at DESC LIMIT 1`,
    args: [],
  });
  return result.rows[0] ?? null;
}

/** Nejnovější doručený kvíz čekající na odpověď */
export async function getLatestPendingQuiz() {
  const result = await client.execute({
    sql: `SELECT * FROM quizzes
          WHERE status = 'delivered' AND user_answer_index IS NULL
          ORDER BY delivered_at DESC LIMIT 1`,
    args: [],
  });
  return result.rows[0] ?? null;
}

// ── User profile ────────────────────────────────────────

export async function getUserProfile() {
  const result = await client.execute('SELECT * FROM user_profile WHERE id = 1');
  return result.rows[0] ?? null;
}

export async function updateUserProfile(preferencesJson, updates = {}) {
  const sets = ['preferences_json = ?', 'updated_at = ?'];
  const args = [JSON.stringify(preferencesJson), new Date().toISOString()];

  for (const [key, value] of Object.entries(updates)) {
    sets.push(`${key} = ?`);
    args.push(value);
  }

  args.push(1); // WHERE id = 1
  await client.execute({
    sql: `UPDATE user_profile SET ${sets.join(', ')} WHERE id = ?`,
    args,
  });
}

export async function incrementProfileCounter(column) {
  await client.execute({
    sql: `UPDATE user_profile SET ${column} = ${column} + 1, updated_at = ? WHERE id = 1`,
    args: [new Date().toISOString()],
  });
}

// ── Schedule log ────────────────────────────────────────

export async function isSlotDone(key) {
  const result = await client.execute({
    sql: 'SELECT slot_key FROM schedule_log WHERE slot_key = ?',
    args: [key],
  });
  return result.rows.length > 0;
}

export async function markSlotDone(key) {
  await client.execute({
    sql: `INSERT OR IGNORE INTO schedule_log (slot_key, sent_at) VALUES (?, ?)`,
    args: [key, new Date().toISOString()],
  });
}

// ── Statistiky (pro stats modul) ────────────────────────

export async function getWeeklyFactStats() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = await client.execute({
    sql: `SELECT
            COUNT(*) as total,
            SUM(CASE WHEN rating IS NOT NULL THEN 1 ELSE 0 END) as rated,
            AVG(CASE WHEN rating IS NOT NULL THEN rating END) as avg_rating
          FROM facts WHERE delivered_at >= ?`,
    args: [weekAgo],
  });
  return result.rows[0];
}

export async function getWeeklyQuizStats() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = await client.execute({
    sql: `SELECT
            SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as correct,
            SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) as wrong
          FROM quizzes WHERE answered_at >= ?`,
    args: [weekAgo],
  });
  return result.rows[0];
}

export async function getWeeklyTopCategories() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = await client.execute({
    sql: `SELECT category, AVG(rating) as avg_rating
          FROM facts
          WHERE delivered_at >= ? AND rating IS NOT NULL
          GROUP BY category
          ORDER BY avg_rating DESC
          LIMIT 3`,
    args: [weekAgo],
  });
  return result.rows;
}

export async function getAllTimeTopCategories() {
  const result = await client.execute({
    sql: `SELECT category, AVG(rating) as avg_rating
          FROM facts WHERE rating IS NOT NULL
          GROUP BY category
          ORDER BY avg_rating DESC
          LIMIT 3`,
    args: [],
  });
  return result.rows;
}
