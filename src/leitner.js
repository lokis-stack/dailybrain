// Leitner spaced-repetition systém pro kvízy

const INTERVALS = {
  1: 1,   // Box 1: +1 den
  2: 3,   // Box 2: +3 dny
  3: 7,   // Box 3: +7 dní
  4: 14,  // Box 4: +14 dní
  5: 30,  // Box 5: +30 dní
};

/**
 * Vypočítá nový box a datum příštího opakování.
 * @param {number} currentBox - aktuální Leitner box (1-5)
 * @param {boolean} isCorrect - jestli uživatel odpověděl správně
 * @returns {{ newBox: number, nextReviewAt: string }}
 */
export function calculateNextReview(currentBox, isCorrect) {
  const newBox = isCorrect ? Math.min(5, currentBox + 1) : 1;
  const daysToAdd = INTERVALS[newBox];

  const next = new Date();
  next.setUTCDate(next.getUTCDate() + daysToAdd);
  // Nastavíme na 18:00 UTC (~20:00 Prague) aby se kvíz nabídl ve správném slotu
  next.setUTCHours(18, 0, 0, 0);

  return {
    newBox,
    nextReviewAt: next.toISOString(),
  };
}
