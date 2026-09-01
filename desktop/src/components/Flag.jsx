// Small inline SVG country flags for a printing's language. We can't use flag emoji here: Windows
// (Electron) renders 🇩🇪/🇬🇧/🇯🇵 as bare "DE/GB/JP" letters because Segoe UI Emoji has no flag glyphs.
// SVG renders identically everywhere.
export default function Flag({ lang, className = "" }) {
    const common = { width: 18, height: 12, className: `inline-block rounded-[2px] shrink-0 ${className}` };
    switch (lang) {
        case 'DE':
            return (
                <svg {...common} viewBox="0 0 5 3">
                    <rect width="5" height="3" fill="#000" />
                    <rect width="5" height="2" y="1" fill="#D00" />
                    <rect width="5" height="1" y="2" fill="#FFCE00" />
                </svg>
            );
        case 'JP':
            return (
                <svg {...common} viewBox="0 0 9 6">
                    <rect width="9" height="6" fill="#fff" />
                    <circle cx="4.5" cy="3" r="1.8" fill="#BC002D" />
                </svg>
            );
        case 'EN':
            return (
                <svg {...common} viewBox="0 0 60 30">
                    <rect width="60" height="30" fill="#012169" />
                    <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
                    <path d="M0,0 L60,30 M60,0 L0,30" stroke="#C8102E" strokeWidth="2" />
                    <rect x="25" width="10" height="30" fill="#fff" />
                    <rect y="10" width="60" height="10" fill="#fff" />
                    <rect x="27" width="6" height="30" fill="#C8102E" />
                    <rect y="12" width="60" height="6" fill="#C8102E" />
                </svg>
            );
        default:
            return null;
    }
}
