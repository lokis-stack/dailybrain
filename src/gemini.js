// Gemini API klient — generování factů, kvízů a rozšíření

import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from './config.js';

const genAI = new GoogleGenerativeAI(config.geminiApiKey);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

/**
 * Robustní JSON parser — Gemini občas obalí JSON do ```json ... ```
 */
function parseJSON(text) {
  let cleaned = text.trim();
  // Odstraň markdown code block obal
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
  }
  return JSON.parse(cleaned);
}

/**
 * Vygeneruje nový fact.
 * @param {object} preferences - {category: {avg_rating, count}}
 * @param {string[]} recentFacts - posledních 10 factů (zkrácené)
 * @param {string} forcedCategory - kategorie vybraná pickCategory()
 * @returns {{ content: string, category: string, length: string }}
 */
export async function generateFact(preferences, recentFacts, forcedCategory) {
  const recentStr = recentFacts.map(f => f.substring(0, 100)).join('\n- ');

  const systemPrompt = `Jsi kurátor denních zajímavostí pro zvídavého člověka. Píšeš česky, stručně, konkrétně, bez vaty. Vyhýbáš se obecným floskulím a všeobecně známým věcem. Preferuješ překvapivé, ověřené, konkrétní informace s čísly, jmény nebo daty.`;

  const userPrompt = `Vygeneruj zajímavý fact PŘÍMO z kategorie: ${forcedCategory}. Téma musí být z této kategorie, nepodvádět.

Posledních 10 factů které už dostal (NEOPAKUJ tyto ani hodně podobné):
- ${recentStr || 'žádné zatím'}

Pravidla:
- Jazyk: čeština
- Délka: vyber sám — "short" (1-2 věty) pro jednoduché fakty, "medium" (3-4 věty) pro většinu, "long" (5-7 vět) pro fakty co potřebují kontext
- Musí být konkrétní, ne obecný ("Mozek má 86 miliard neuronů a spotřebuje 20% energie těla" ANO; "Mozek je složitý orgán" NE)
- Ne klišé, ne všeobecně známé věci

Vrať POUZE validní JSON (žádný markdown, žádné \`\`\`), ve formátu:
{"content": "text factu", "category": "${forcedCategory}", "length": "short|medium|long"}`;

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
  });

  const text = result.response.text();
  console.log('Gemini fact response:', text.substring(0, 200));
  const parsed = parseJSON(text);
  // Pro jistotu přepiš kategorii na tu co jsme chtěli
  parsed.category = forcedCategory;
  return parsed;
}

/**
 * Vygeneruje kvíz z daného factu.
 * @param {string} factContent
 * @returns {{ question: string, options: string[], correct_index: number }}
 */
export async function generateQuiz(factContent) {
  const prompt = `Z tohoto factu vytvoř kvízovou otázku s 4 možnostmi (A, B, C, D). 1 správná odpověď, 3 lákavé ale jednoznačně špatné distraktory. Otázka musí být zodpověditelná jen ze znalosti toho factu. Čeština.

Fact: "${factContent}"

Vrať POUZE validní JSON:
{"question": "otázka", "options": ["možnost A", "možnost B", "možnost C", "možnost D"], "correct_index": 0}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  console.log('Gemini quiz response:', text.substring(0, 200));
  return parseJSON(text);
}

/**
 * Rozšíří fact o další kontext (tlačítko "Víc").
 * @param {string} factContent
 * @returns {string} rozšířený text
 */
export async function expandFact(factContent) {
  const prompt = `Rozveď tento fact do 5-7 vět s dalším kontextem, zajímavostmi a souvislostmi. Česky, bez vaty, konkrétně.

Fact: "${factContent}"`;

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}
