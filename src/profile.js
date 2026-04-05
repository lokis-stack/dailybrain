// Správa uživatelského profilu a preferencí

import { getUserProfile, updateUserProfile, incrementProfileCounter } from './db.js';

/**
 * Aktualizuje preference po novém ratingu.
 * Počítá klouzavý průměr hodnocení per kategorie.
 */
export async function updatePreferences(category, rating) {
  const profile = await getUserProfile();
  const prefs = JSON.parse(profile.preferences_json || '{}');

  const existing = prefs[category] || { avg_rating: 0, count: 0 };
  const newCount = existing.count + 1;
  const newAvg = (existing.avg_rating * existing.count + rating) / newCount;

  prefs[category] = {
    avg_rating: Math.round(newAvg * 10) / 10, // zaokrouhli na 1 desetinné místo
    count: newCount,
  };

  await updateUserProfile(prefs);
  await incrementProfileCounter('total_facts_rated');
}

/** Vrátí aktuální preference jako objekt */
export async function getPreferences() {
  const profile = await getUserProfile();
  return JSON.parse(profile.preferences_json || '{}');
}
