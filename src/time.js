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
 * Kontrola jestli je aktuální čas v okně ±5 minut od cílového času.
 * Vrací true pokud ano.
 */
export function isInTimeWindow(targetHour, targetMinute) {
  const { hour, minute } = pragueNow();
  const nowMins = hour * 60 + minute;
  const targetMins = targetHour * 60 + targetMinute;
  return Math.abs(nowMins - targetMins) <= 5;
}

/**
 * Detekuje aktuální slot na základě Prague času.
 * Vrací název slotu nebo null.
 */
export function detectSlot() {
  const { hour, minute } = pragueNow();
  const nowMins = hour * 60 + minute;

  const slots = [
    { name: 'morning', h: 9, m: 0 },
    { name: 'noon', h: 12, m: 0 },
    { name: 'afternoon', h: 15, m: 0 },
    { name: 'quiz', h: 20, m: 0 },
    { name: 'weekly', h: 20, m: 30 },
  ];

  for (const slot of slots) {
    const targetMins = slot.h * 60 + slot.m;
    if (Math.abs(nowMins - targetMins) <= 5) {
      // Weekly slot platí jen v neděli
      if (slot.name === 'weekly' && pragueDayOfWeek() !== 0) continue;
      return slot.name;
    }
  }

  return null;
}

/** Vrátí slot key pro dedup — např. "2026-04-06-morning" */
export function slotKey(slotName) {
  const dateStr = pragueDateStr();
  if (slotName === 'weekly') {
    return `${pragueWeekKey()}-weekly`;
  }
  return `${dateStr}-${slotName}`;
}
