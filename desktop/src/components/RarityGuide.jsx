import { X } from 'lucide-react';

export default function RarityGuide({ onClose }) {
  const rarities = [
    {
      name: "Common",
      description: "No foil, no special lettering. The most basic rarity.",
      color: "bg-gray-400"
    },
    {
      name: "Rare",
      description: "Silver lettering for the name, but no foil on the artwork.",
      color: "bg-gray-300"
    },
    {
      name: "Super Rare",
      description: "No special lettering, but the artwork is holographic.",
      color: "bg-purple-300"
    },
    {
      name: "Ultra Rare",
      description: "Gold lettering for the name, and the artwork is holographic.",
      color: "bg-yellow-400"
    },
    {
      name: "Secret Rare",
      description: "Silver sparkling lettering, and the artwork has a diagonal sparkling foil pattern.",
      color: "bg-pink-300"
    },
    {
      name: "Ultimate Rare",
      description: "Gold lettering, with an embossed foil texture on the artwork, level stars, and attribute icon.",
      color: "bg-orange-400"
    },
    {
      name: "Ghost Rare",
      description: "Silver lettering, and the artwork is a pale, 3D-like holographic image that disappears at certain angles.",
      color: "bg-white"
    },
    {
        name: "Prismatic Secret Rare",
        description: "Similar to Secret Rare but with a horizontal/vertical grid foil pattern instead of diagonal.",
        color: "bg-pink-400"
    },
    {
        name: "Starlight Rare",
        description: "Entire card face has a holographic foil, name is gold or red foil.",
        color: "bg-cyan-300"
    }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-[#1E1E1E] w-full max-w-2xl max-h-[80vh] rounded-2xl border border-gray-700 shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-gray-700 flex justify-between items-center bg-[#252525]">
          <h2 className="text-2xl font-bold text-white">Rarity Guide</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-700 rounded-full text-gray-400 hover:text-white transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-4">
          <p className="text-gray-400 text-sm mb-4">
              Identifying card rarities can be tricky. Use this guide to help determine which version of a card you have.
              <br/>
              <span className="text-xs italic opacity-70">* Note: Colors here are representative. Actual foil patterns vary by lighting.</span>
          </p>

          <div className="grid grid-cols-1 gap-4">
            {rarities.map((r, idx) => (
              <div key={idx} className="flex gap-4 p-4 bg-black/30 rounded-xl border border-gray-800 hover:border-space-violet/50 transition-colors group">
                {/* Visual Representation (Placeholder) */}
                <div className={`w-16 h-24 rounded border border-gray-600 flex-shrink-0 relative overflow-hidden shadow-lg ${r.color === 'bg-white' ? 'bg-gray-800' : 'bg-black'}`}>
                    {/* Simulated Foil Effect */}
                    <div className={`absolute inset-0 opacity-30 ${r.color} mix-blend-screen`}></div>
                    <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/10 to-transparent opacity-0 group-hover:opacity-50 transition-opacity duration-700"></div>
                    <div className="absolute top-2 left-2 right-2 h-2 bg-gray-700 rounded-sm opacity-50"></div> {/* Name Area */}
                    <div className="absolute top-6 left-2 right-2 bottom-8 bg-gray-800 rounded-sm border border-gray-700 flex items-center justify-center">
                        <span className="text-[8px] text-gray-500 font-mono">ART</span>
                    </div>
                </div>

                <div className="flex-1">
                  <h3 className="text-lg font-bold text-white mb-1">{r.name}</h3>
                  <p className="text-sm text-gray-400 leading-relaxed">{r.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
