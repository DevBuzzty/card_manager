import { fmtDayDE } from './priceSteps.js';

// Spec G1 §4.8 — Leertexte der Bewegungen. Das Handy (ui/MoversSection.kt) zeigt dieselben Saetze.
export function moversMessage(result, days) {
  if (result.status === 'no_reference') {
    return result.firstDay ? `Noch nicht genug Verlauf — Bewegungen erscheinen ab ${fmtDayDE(result.firstDay)}` : 'Noch nicht genug Verlauf';
  }
  if (result.winners.length === 0 && result.losers.length === 0) return `Keine Bewegungen in ${days} Tagen`;
  return null;
}
