// Generování statistik — týdenních i celkových

import {
  getUserProfile,
  getWeeklyFactStats,
  getWeeklyQuizStats,
  getWeeklyTopCategories,
  getAllTimeTopCategories,
} from './db.js';
import { normalizeCategory } from './profile.js';

/** Formátuje top kategorie do textu */
function formatTopCategories(categories) {
  if (!categories || categories.length === 0) return 'Zatím nedostatek dat.';
  return categories
    .map((c, i) => `${i + 1}. ${normalizeCategory(c.category)} (${Number(c.avg_rating).toFixed(1)})`)
    .join('\n');
}

/** Vygeneruje týdenní statistiku (neděle 20:30) */
export async function generateWeeklyStats() {
  const factStats = await getWeeklyFactStats();
  const quizStats = await getWeeklyQuizStats();
  const topCats = await getWeeklyTopCategories();

  const total = Number(factStats.total) || 0;
  const rated = Number(factStats.rated) || 0;
  const avgRating = factStats.avg_rating ? Number(factStats.avg_rating).toFixed(1) : '-';
  const ratedPct = total > 0 ? Math.round((rated / total) * 100) : 0;
  const correct = Number(quizStats.correct) || 0;
  const wrong = Number(quizStats.wrong) || 0;

  return `📊 Týdenní shrnutí

Fakty poslané: ${total}
Ohodnocené: ${rated} (${ratedPct}%)
Průměrné hodnocení: ${avgRating}

Top 3 témata podle průměru:
${formatTopCategories(topCats)}

Kvízy: ${correct} správně / ${wrong} špatně`;
}

/** Vygeneruje celkovou statistiku (command /stats) */
export async function generateAllTimeStats() {
  const profile = await getUserProfile();
  const topCats = await getAllTimeTopCategories();

  const totalDelivered = Number(profile.total_facts_delivered) || 0;
  const totalRated = Number(profile.total_facts_rated) || 0;
  const ratedPct = totalDelivered > 0 ? Math.round((totalRated / totalDelivered) * 100) : 0;
  const totalQuizzes = Number(profile.total_quizzes_delivered) || 0;
  const totalCorrect = Number(profile.total_quizzes_correct) || 0;
  const totalWrong = totalQuizzes - totalCorrect;

  // Průměrné hodnocení ze všech preferencí
  const prefs = JSON.parse(profile.preferences_json || '{}');
  let totalSum = 0;
  let totalCount = 0;
  for (const cat of Object.values(prefs)) {
    totalSum += cat.avg_rating * cat.count;
    totalCount += cat.count;
  }
  const avgRating = totalCount > 0 ? (totalSum / totalCount).toFixed(1) : '-';

  return `📊 Celkové statistiky

Fakty poslané: ${totalDelivered}
Ohodnocené: ${totalRated} (${ratedPct}%)
Průměrné hodnocení: ${avgRating}

Top 3 témata podle průměru:
${formatTopCategories(topCats)}

Kvízy: ${totalCorrect} správně / ${totalWrong} špatně`;
}
