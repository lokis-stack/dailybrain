// Správa uživatelského profilu, preferencí a výběru kategorií

import { getUserProfile, updateUserProfile, incrementProfileCounter, getRecentCategories } from './db.js';

/** Kanonický seznam kategorií (vždy s velkým písmenem) */
export const CATEGORIES = ['Psychologie', 'Filozofie', 'Ekonomie', 'Příroda', 'Věda', 'Historie'];

/**
 * Normalizuje kategorii na kanonický tvar (velké první písmeno).
 * "ekonomie" → "Ekonomie", "příroda" → "Příroda" atd.
 */
export function normalizeCategory(str) {
  if (!str) return str;
  const lower = str.toLowerCase();
  const match = CATEGORIES.find(c => c.toLowerCase() === lower);
  if (match) return match;
  // Fallback: první písmeno velké
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Aktualizuje preference po novém ratingu.
 * Počítá klouzavý průměr hodnocení per kategorie.
 */
export async function updatePreferences(category, rating) {
  const normalized = normalizeCategory(category);
  const profile = await getUserProfile();
  const prefs = JSON.parse(profile.preferences_json || '{}');

  // Normalizuj existující klíče v prefs (zpětná kompatibilita)
  const normalizedPrefs = normalizePrefsKeys(prefs);

  const existing = normalizedPrefs[normalized] || { avg_rating: 0, count: 0 };
  const newCount = existing.count + 1;
  const newAvg = (existing.avg_rating * existing.count + rating) / newCount;

  normalizedPrefs[normalized] = {
    avg_rating: Math.round(newAvg * 10) / 10,
    count: newCount,
  };

  await updateUserProfile(normalizedPrefs);
  await incrementProfileCounter('total_facts_rated');
}

/** Vrátí aktuální preference jako objekt (s normalizovanými klíči) */
export async function getPreferences() {
  const profile = await getUserProfile();
  const prefs = JSON.parse(profile.preferences_json || '{}');
  return normalizePrefsKeys(prefs);
}

/** Normalizuje klíče v preferences objektu */
function normalizePrefsKeys(prefs) {
  const result = {};
  for (const [key, value] of Object.entries(prefs)) {
    result[normalizeCategory(key)] = value;
  }
  return result;
}

/**
 * Vybere kategorii váženým náhodným výběrem.
 * Oblíbenější kategorie přicházejí častěji, ale žádná není vyloučená.
 */
export async function pickCategory() {
  const prefs = await getPreferences();
  const recentCats = await getRecentCategories(5);

  const weights = [];

  for (const cat of CATEGORIES) {
    const pref = prefs[cat];
    const avgRating = pref ? pref.avg_rating : 5.0;

    const base = 1.0;
    const ratingBonus = avgRating * 0.3;
    const recencyCount = recentCats.filter(c => normalizeCategory(c) === cat).length;
    const recencyPenalty = recencyCount * 0.5;
    const weight = Math.max(0.3, base + ratingBonus - recencyPenalty);

    weights.push({ category: cat, weight });
  }

  // Weighted random selection
  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
  let random = Math.random() * totalWeight;

  for (const w of weights) {
    random -= w.weight;
    if (random <= 0) {
      const pct = ((w.weight / totalWeight) * 100).toFixed(1);
      console.log(`Vybraná kategorie: ${w.category} (váha ${w.weight.toFixed(2)}, šance ${pct}%)`);
      return w.category;
    }
  }

  // Fallback (nemělo by nastat)
  return weights[weights.length - 1].category;
}
