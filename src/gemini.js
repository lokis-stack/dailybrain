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
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
  }
  return JSON.parse(cleaned);
}

/**
 * Vygeneruje nový fact.
 * @param {object} preferences - {category: {avg_rating, count}}
 * @param {string[]} recentFacts - posledních 50 factů (plný text)
 * @param {string} forcedCategory - kategorie vybraná pickCategory()
 * @param {string} forcedLength - 'short' | 'medium' | 'long'
 * @param {string} [excludeContent] - konkrétní fact co se NESMÍ opakovat (retry po duplicitě)
 * @returns {{ content: string, category: string, length: string }}
 */
export async function generateFact(preferences, recentFacts, forcedCategory, forcedLength, excludeContent = null) {
  const recentStr = recentFacts.map((f, i) => `${i + 1}. ${f}`).join('\n');

  const systemPrompt = `Jsi kurátor denních zajímavostí pro zvídavého člověka. Píšeš česky, stručně, konkrétně, bez vaty. Vyhýbáš se obecným floskulím a všeobecně známým věcem. Preferuješ překvapivé, ověřené, konkrétní informace s čísly, jmény nebo daty.

KRITICKÉ: Nesmíš opakovat ani parafrázovat žádný z uvedených factů. Každý fact musí být o ÚPLNĚ JINÉM tématu, události nebo jevu. Pokud ti dojdou nápady v dané kategorii, zvol úplně jinou podoblast.`;

  let excludeNote = '';
  if (excludeContent) {
    excludeNote = `\n\nTento fact NESMÍŠ generovat (je duplicitní): "${excludeContent}"\nVygeneruj KOMPLETNĚ JINÝ fact o jiném tématu/jevu.`;
  }

  const lengthInstruction = {
    short: 'PŘESNĚ 1-2 věty. Stručný, hutný, bez rozvíjení.',
    medium: 'PŘESNĚ 3-4 věty. Fact plus krátký kontext.',
    long: 'PŘESNĚ 5-7 vět. Fact plus širší kontext, souvislosti, konkrétní detaily.',
  }[forcedLength];

  const userPrompt = `Vygeneruj zajímavý fact PŘÍMO z kategorie: ${forcedCategory}. Téma musí být z této kategorie, nepodvádět.

Všechny dosud poslané facty (NEOPAKUJ žádný z nich, ani podobný):
${recentStr || 'žádné zatím'}${excludeNote}

Pravidla:
- Jazyk: čeština
- DÉLKA (povinné): ${forcedLength} — ${lengthInstruction}
- Musí být konkrétní, ne obecný ("Mozek má 86 miliard neuronů a spotřebuje 20% energie těla" ANO; "Mozek je složitý orgán" NE)
- Ne klišé, ne všeobecně známé věci
- Musí být o JINÉM tématu než jakýkoliv z výše uvedených factů

Vrať POUZE validní JSON (žádný markdown, žádné \`\`\`), ve formátu:
{"content": "text factu", "category": "${forcedCategory}", "length": "${forcedLength}"}`;

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
  });

  const text = result.response.text();
  console.log('Gemini fact response:', text.substring(0, 200));
  const parsed = parseJSON(text);
  parsed.category = forcedCategory;
  parsed.length = forcedLength; // force i délku pro jistotu
  return parsed;
}

/**
 * Vygeneruje kvíz z daného factu.
 * @param {string} factContent
 * @param {string[]} previousQuestions - předchozí otázky ze stejného factu (pro dedup)
 * @returns {{ question: string, options: string[], correct_index: number }}
 */
export async function generateQuiz(factContent, previousQuestions = []) {
  let prevNote = '';
  if (previousQuestions.length > 0) {
    const prevStr = previousQuestions.map((q, i) => `${i + 1}. "${q}"`).join('\n');
    prevNote = `\n\nTyto otázky už byly použity — vygeneruj ODLIŠNOU otázku (jiná formulace, jiný úhel pohledu, jiné distraktory):\n${prevStr}`;
  }

  const prompt = `Z tohoto factu vytvoř kvízovou otázku s 4 možnostmi (A, B, C, D). 1 správná odpověď, 3 lákavé ale jednoznačně špatné distraktory. Otázka musí být zodpověditelná jen ze znalosti toho factu. Čeština.

Fact: "${factContent}"${prevNote}

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
