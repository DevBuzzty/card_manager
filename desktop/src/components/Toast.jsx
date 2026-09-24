import { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { showToast, pauseToast, resumeToast, isExpired } from '../utils/toastQueue';
import { ToastContext } from './toastContext';

// Spec I §5.2 Punkt 4 -- Hinweis-/Rueckgaengig-Leiste: unten mittig, eine zur Zeit, laeuft nach sechs
// Sekunden ab, pausiert bei Maus/Fokus. Kein Dialog, nichts zum Wegklicken noetig. Liegt `fixed`, damit
// die Liste darunter beim Erscheinen nicht springt.
export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const [visible, setVisible] = useState(false);

  const show = useCallback((t) => { setToast((prev) => showToast(prev, t, Date.now())); setVisible(true); }, []);
  const dismiss = useCallback(() => setVisible(false), []);

  useEffect(() => {
    if (!toast || toast.paused || !visible) return undefined;
    const id = setTimeout(() => { if (isExpired(toast, Date.now())) setVisible(false); }, Math.max(0, toast.deadline - Date.now()));
    return () => clearTimeout(id);
  }, [toast, visible]);

  const value = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  const pause = () => setToast((t) => pauseToast(t, Date.now()));
  const resume = () => setToast((t) => resumeToast(t, Date.now()));

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed inset-x-0 bottom-6 z-[60] flex justify-center pointer-events-none" aria-live="polite">
        {toast && (
          <div
            key={toast.id}
            role="status"
            onMouseEnter={pause} onMouseLeave={resume} onFocus={pause} onBlur={resume}
            className={`pointer-events-auto flex items-center gap-3 pl-4 pr-2 py-2 rounded-xl border border-line bg-surface text-text text-sm shadow-sm transition-opacity duration-150 ${visible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          >
            <span>{toast.text}</span>
            {toast.action && (
              <button type="button"
                onClick={async () => { setVisible(false); await toast.action.run(); }}
                className="px-2 py-1 rounded-md text-accent font-medium hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                {toast.action.label}
              </button>
            )}
            <button type="button" onClick={dismiss} aria-label="Hinweis schließen"
              className="p-1 rounded-md text-muted hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
