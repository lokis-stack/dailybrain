// Entry point — rozparsuje argument a spustí odpovídající modul

import { ensureSchema } from './db.js';
import { processPoll } from './poll.js';
import { processSchedule } from './schedule.js';

const command = process.argv[2];

async function main() {
  // Vždy nejdřív zajistíme že DB schéma existuje
  await ensureSchema();

  switch (command) {
    case 'poll':
      console.log('=== POLL: Zpracovávám Telegram updaty ===');
      await processPoll();
      break;

    case 'schedule':
      console.log('=== SCHEDULE: Kontroluji co poslat ===');
      await processSchedule();
      break;

    case 'seed':
      // Seed jen inicializuje schéma (už hotovo výše)
      console.log('=== SEED: Schéma inicializováno ===');
      break;

    default:
      console.error(`Neznámý příkaz: ${command}`);
      console.error('Použití: node src/index.js [poll|schedule|seed]');
      process.exit(1);
  }
}

main()
  .then(() => {
    console.log(`Příkaz "${command}" dokončen.`);
    process.exit(0);
  })
  .catch(err => {
    console.error(`Fatální chyba v "${command}":`, err);
    process.exit(1);
  });
