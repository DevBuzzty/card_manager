// Spec I §5.2 Punkt 6 -- Fehlermeldung als Zeile an der Stelle, an der sie entsteht, mit einer Handlung,
// die sie behebt (saleFlow.validateSale/validateListing liefern Text und Abhilfe).
export default function FieldErrors({ errors, onFix }) {
  if (!errors?.length) return null;
  return (
    <div className="space-y-1" role="alert">
      {errors.map((e) => (
        <p key={e.field + e.text} className="text-xs text-bad flex flex-wrap items-center gap-x-2">
          <span>{e.text}</span>
          {e.fix && (
            <button type="button" onClick={() => onFix(e.fix)}
              className="text-accent hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              {e.fix.label}
            </button>
          )}
        </p>
      ))}
    </div>
  );
}
