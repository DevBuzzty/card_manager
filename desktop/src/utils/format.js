// Shared German-locale number/currency formatting.
// The app is EUR / German-collection-first, so prices render as "1.234,56 €".

const eur = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const eurSigned = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: 'always',
});

const num2 = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Coerce anything (string prices from the API, null, undefined) to a finite number.
const n = (v) => {
  const x = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(x) ? x : 0;
};

export const fmtEUR = (v) => eur.format(n(v));
export const fmtSignedEUR = (v) => eurSigned.format(n(v));
export const fmtNum = (v) => num2.format(n(v));
