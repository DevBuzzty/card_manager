// supabase/functions/_shared/condition-factors.ts
// Spec H3b §7.2 -- Zustandsfaktoren fuer den Marktwert. KOPIE von desktop/electron/condition-factors.json:
// der Deploy buendelt nur supabase/functions/, ein Import von dort wuerde brechen. sales-math_test.ts verlangt
// Gleichheit mit der JSON-Datei -- wer die Faktoren aendert, aendert beide.
export const CONDITION_FACTORS: Record<string, number> = { MT: 1, NM: 1, EX: 0.85, GD: 0.7, LP: 0.5, PL: 0.35, PO: 0.2 };
