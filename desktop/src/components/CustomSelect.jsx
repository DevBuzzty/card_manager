import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import clsx from 'clsx';

export default function CustomSelect({ value, onChange, options, placeholder = "Select...", className }) {
  const [isOpen, setIsOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const containerRef = useRef(null);
  const menuRef = useRef(null);

  const updateRect = () => {
    if (containerRef.current) setRect(containerRef.current.getBoundingClientRect());
  };

  // Track the trigger's position while open so the portalled menu follows it on scroll/resize.
  useLayoutEffect(() => {
    if (!isOpen) return;
    updateRect();
    const onMove = () => updateRect();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [isOpen]);

  // Close on outside click (the menu lives in a portal, so check it too).
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && containerRef.current.contains(event.target)) return;
      if (menuRef.current && menuRef.current.contains(event.target)) return;
      setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedOption = options.find(opt => opt.value === value);

  // Position the menu with fixed coords (escapes any overflow/clipping ancestor), flipping
  // upward when there's more room above, and sizing its height to the available space.
  let menuStyle = null, listMaxH = 288;
  if (isOpen && rect) {
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const openUp = spaceBelow < 200 && spaceAbove > spaceBelow;
    listMaxH = Math.max(140, Math.min(360, openUp ? spaceAbove : spaceBelow));
    menuStyle = {
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    };
  }

  return (
    <div className={clsx("relative", className)} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(o => !o)}
        className="w-full flex items-center justify-between bg-bg border border-line text-text rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent hover:bg-surface-2 transition-colors"
      >
        <span className={clsx("truncate mr-2", !selectedOption && "text-muted")}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className={clsx("w-4 h-4 text-muted transition-transform duration-200", isOpen && "rotate-180")} />
      </button>

      {isOpen && rect && createPortal(
        <div
          ref={menuRef}
          style={menuStyle}
          className="z-[100] bg-surface border border-line rounded-xl shadow-sm overflow-hidden min-w-[150px]"
        >
          <ul className="overflow-auto custom-scrollbar p-1" style={{ maxHeight: listMaxH }}>
            {options.map((option) => (
              <li key={option.value} className={option.divider ? "mt-1 pt-1 border-t border-line/70" : ""}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={clsx(
                    "w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between transition-colors",
                    value === option.value
                      ? "bg-accent text-accent-fg font-medium"
                      : "text-text hover:bg-surface-2 hover:text-text"
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  {value === option.value && <Check className="w-3 h-3 ml-2 shrink-0" />}
                </button>
              </li>
            ))}
          </ul>
        </div>,
        document.body
      )}
    </div>
  );
}
