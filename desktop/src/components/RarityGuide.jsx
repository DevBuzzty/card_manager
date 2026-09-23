import { X } from 'lucide-react';

// Farbwerte hier sind echter Karteninhalt (wie real bedruckte Rarities aussehen), keine
// Oberflaechenflaeche -- darum als Hex-Literale statt Tailwind-Klassen (Fixrunde 1, Punkt 4/5:
// der Waechter-Test verbietet Tailwind-Farbklassen, nicht beliebige Hex-Werte in style={{}}).
export default function RarityGuide({ onClose }) {
  const rarities = [
    {
      name: "Common",
      description: "No foil, no special lettering. The most basic rarity.",
      color: "#9ca3af"
    },
    {
      name: "Rare",
      description: "Silver lettering for the name, but no foil on the artwork.",
      color: "#d1d5db"
    },
    {
      name: "Super Rare",
      description: "No special lettering, but the artwork is holographic.",
      color: "#d8b4fe"
    },
    {
      name: "Ultra Rare",
      description: "Gold lettering for the name, and the artwork is holographic.",
      color: "#facc15"
    },
    {
      name: "Secret Rare",
      description: "Silver sparkling lettering, and the artwork has a diagonal sparkling foil pattern.",
      color: "#f9a8d4"
    },
    {
      name: "Ultimate Rare",
      description: "Gold lettering, with an embossed foil texture on the artwork, level stars, and attribute icon.",
      color: "#fb923c"
    },
    {
      name: "Ghost Rare",
      description: "Silver lettering, and the artwork is a pale, 3D-like holographic image that disappears at certain angles.",
      color: "#ffffff"
    },
    {
        name: "Prismatic Secret Rare",
        description: "Similar to Secret Rare but with a horizontal/vertical grid foil pattern instead of diagonal.",
        color: "#f472b6"
    },
    {
        name: "Starlight Rare",
        description: "Entire card face has a holographic foil, name is gold or red foil.",
        color: "#67e8f9"
    },
    {
        name: "Quarter Century Secret Rare",
        description: "25th Anniversary watermark in text box, gold/holographic sparkling finish, gold name.",
        color: "#fef08a"
    },
    {
        name: "Collector's Rare",
        description: "Rainbow-colored reflection on the artwork and card border, with a textured surface.",
        color: "#a5b4fc"
    },
    {
        name: "Gold Rare",
        description: "Gold borders and frames, with foil on the artwork.",
        color: "#ca8a04"
    },
    {
        name: "Platinum Rare",
        description: "Platinum-colored foil over the entire card surface.",
        color: "#e5e7eb"
    }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-surface w-full max-w-2xl max-h-[80vh] rounded-2xl border border-line shadow-sm overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-line flex justify-between items-center bg-surface-2">
          <h2 className="text-2xl font-bold text-text">Rarity Guide</h2>
          <button onClick={onClose} className="p-2 hover:bg-surface rounded-full text-muted hover:text-text transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-4">
          <p className="text-muted text-sm mb-4">
              Identifying card rarities can be tricky. Use this guide to help determine which version of a card you have.
              <br/>
              <span className="text-xs italic opacity-70">* Note: Colors here are representative. Actual foil patterns vary by lighting.</span>
          </p>

          <div className="grid grid-cols-1 gap-4">
            {rarities.map((r, idx) => (
              <div key={idx} className="flex gap-4 p-4 bg-bg/30 rounded-xl border border-line hover:border-accent/50 transition-colors group">
                {/* Visual Representation (Placeholder) */}
                <div className="w-16 h-24 rounded border border-line flex-shrink-0 relative overflow-hidden shadow-sm bg-surface-2">
                    {/* Simulated Foil Effect -- normale Deckkraft statt mix-blend-screen: auf hellem Grund
                        machte der Mischmodus die Farbfelder fast weiss und damit ununterscheidbar. */}
                    <div className="absolute inset-2 rounded-sm border border-line" style={{ backgroundColor: r.color }}></div>
                    <div className="absolute top-2 left-2 right-2 h-2 bg-surface-2 rounded-sm opacity-50"></div> {/* Name Area */}
                    <div className="absolute top-6 left-2 right-2 bottom-8 bg-surface-2 rounded-sm border border-line flex items-center justify-center">
                        <span className="text-[8px] text-muted font-mono">ART</span>
                    </div>
                </div>

                <div className="flex-1">
                  <h3 className="text-lg font-bold text-text mb-1">{r.name}</h3>
                  <p className="text-sm text-muted leading-relaxed">{r.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
