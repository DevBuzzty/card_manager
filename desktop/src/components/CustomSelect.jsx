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
        className="w-full flex items-center justify-between bg-[#1a1a1a] border border-gray-800 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-space-violet hover:bg-[#252525] transition-colors"
      >
        <span className={clsx("truncate mr-2", !selectedOption && "text-gray-500")}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className={clsx("w-4 h-4 text-gray-500 transition-transform duration-200", isOpen && "rotate-180")} />
      </button>

      {isOpen && rect && createPortal(
        <div
          ref={menuRef}
          style={menuStyle}
          className="z-[100] bg-[#1E1E1E] border border-gray-700 rounded-xl shadow-2xl overflow-hidden min-w-[150px]"
        >
          <ul className="overflow-auto custom-scrollbar p-1" style={{ maxHeight: listMaxH }}>
            {options.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={clsx(
                    "w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between transition-colors",
                    value === option.value
                      ? "bg-space-violet text-white font-medium"
                      : "text-gray-300 hover:bg-[#2a2a2a] hover:text-white"
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
