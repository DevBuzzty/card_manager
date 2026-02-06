import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import clsx from 'clsx';

export default function CustomSelect({ value, onChange, options, placeholder = "Select...", className }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedOption = options.find(opt => opt.value === value);

  return (
    <div className={clsx("relative", className)} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between bg-[#1a1a1a] border border-gray-800 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-space-violet hover:bg-[#252525] transition-colors"
      >
        <span className={clsx("truncate mr-2", !selectedOption && "text-gray-500")}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className={clsx("w-4 h-4 text-gray-500 transition-transform duration-200", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-[#1E1E1E] border border-gray-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100 min-w-[150px]">
          <ul className="max-h-60 overflow-auto custom-scrollbar p-1">
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
                  {value === option.value && <Check className="w-3 h-3 ml-2" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
