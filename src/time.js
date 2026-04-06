// Helpery pro práci s Europe/Prague timezone

const PRAGUE_TZ = 'Europe/Prague';

/** Vrátí aktuální hodinu a minutu v Prague timezone */
export function pragueNow() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: PRAGUE_TZ,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const hour = Number(parts.find(p => p.type === 'hour').value);
  const minute = Number(parts.find(p => p.type === 'minute').value);
  return { hour, minute, date: now };
}

/** Vrátí datum v Prague timezone jako YYYY-MM-DD */
export function pragueDateStr(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: PRAGUE_TZ }).format(date);
}

/** Vrátí den v týdnu v Prague TZ (0 = neděle, 6 = sobota) */
export function pragueDayOfWeek(date = new Date()) {
  const dayStr = new Intl.DateTimeFormat('en-US', {
    timeZone: PRAGUE_TZ,
    weekday: 'short',
  }).format(date);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[dayStr];
}

/** Vrátí ISO week číslo pro Prague TZ */
export function pragueWeekKey(date = new Date()) {
  const dateStr = pragueDateStr(date);
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Definice slotů — širší catch-up okna pro nespolehlivý GH Actions cron.
 * Každý slot je aktivní od startH:startM do endH:endM (včetně).
 */
const SLOT_WINDOWS = [
  { name: 'morning',   startH: 9,  startM: 0,  endH: 11, endM: 59 },
  { name: 'noon',      startH: 12, startM: 0,  endH: 14, endM: 59 },
  { name: 'afternoon', startH: 15, startM: 0,  endH: 19, endM: 59 },
  { name: 'quiz',      startH: 20, startM: 0,  endH: 23, endM: 59 },
  { name: 'weekly',    startH: 20, startM: 30, endH: 23, endM: 59 },
];

/**
 * Vrátí pole názvů slotů aktivních právě teď (Prague TZ).
 * Seřazené v pořadí morning → noon → afternoon → quiz → weekly.
 * Weekly se vrací jen v neděli.
 */
export function getActiveSlots() {
  const { hour, minute } = pragueNow();
  const nowMins = hour * 60 + minute;
  const isSunday = pragueDayOfWeek() === 0;

  const active = [];
  for (const slot of SLOT_WINDOWS) {
    if (slot.name === 'weekly' && !isSunday) continue;
    const startMins = slot.startH * 60 + slot.startM;
    const endMins = slot.endH * 60 + slot.endM;
    if (nowMins >= startMins && nowMins <= endMins) {
      active.push(slot.name);
    }
  }
  return active;
}

/**
 * Pro danou Prague hodinu a minutu vrátí název slotu, ve kterém se ten čas nachází.
 * Slouží ke kontrole, jestli je doručená zpráva stále ve "svém" slotu (pro remindery).
 * Vrací první odpovídající content slot (ne weekly).
 */
export function getSlotForTime(hour, minute) {
  const mins = hour * 60 + minute;
  for (const slot of SLOT_WINDOWS) {
    if (slot.name === 'weekly') continue; // weekly není content slot
    const startMins = slot.startH * 60 + slot.startM;
    const endMins = slot.endH * 60 + slot.endM;
    if (mins >= startMins && mins <= endMins) {
      return slot.name;
    }
  }
  return null;
}

/**
 * Vrátí aktuální content slot (bez weekly) — pro porovnání s delivery slotem.
 */
export function getCurrentContentSlot() {
  const { hour, minute } = pragueNow();
  return getSlotForTime(hour, minute);
}

/** Vrátí slot key pro dedup — např. "2026-04-06-morning" */
export function slotKey(slotName) {
  const dateStr = pragueDateStr();
  if (slotName === 'weekly') {
    return `${pragueWeekKey()}-weekly`;
  }
  return `${dateStr}-${slotName}`;
}
