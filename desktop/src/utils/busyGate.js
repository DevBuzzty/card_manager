// Spec H1 §7 -- Ein-Lauf-Gatter fuer Schreibaktionen am PC (Gegenstueck zu android ui/InFlight.kt): solange eine Aktion
// laeuft, wird jeder weitere Start sofort verworfen -- synchron, bevor der erste await laeuft. Ein React-State kaeme
// gegen einen Doppelklick zu spaet. Wirft die Aktion, ist das Gatter trotzdem wieder frei.
export function createBusyGate() {
  let running = false;
  return {
    get running() { return running; },
    // -> true, wenn die Aktion lief; false, wenn schon eine lief (dann wird action gar nicht aufgerufen).
    async run(action) {
      if (running) return false;
      running = true;
      try {
        await action();
        return true;
      } finally {
        running = false;
      }
    },
  };
}

// Review Runde 1 -- Schutz gegen ueberholende Antworten bei sich ueberschneidenden useSaleData()-reload()-Aufrufen:
// ein spaeter gestarteter Lauf gewinnt, auch wenn eine aeltere Antwort spaeter ankommt.
export function createLatestOnly() {
  let seq = 0;
  return {
    // Startet einen neuen Lauf, liefert dessen Token.
    start() { return ++seq; },
    // true, wenn token noch zum zuletzt gestarteten Lauf gehoert (kein neuerer start() ist dazwischengekommen).
    isCurrent(token) { return token === seq; },
  };
}
