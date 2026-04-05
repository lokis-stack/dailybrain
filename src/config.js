// Načtení a validace environment proměnných

const required = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'GEMINI_API_KEY',
  'TURSO_DATABASE_URL',
  'TURSO_AUTH_TOKEN',
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Chybí environment proměnná: ${key}`);
  }
}

export const config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: Number(process.env.TELEGRAM_CHAT_ID),
  geminiApiKey: process.env.GEMINI_API_KEY,
  tursoDatabaseUrl: process.env.TURSO_DATABASE_URL,
  tursoAuthToken: process.env.TURSO_AUTH_TOKEN,
};
