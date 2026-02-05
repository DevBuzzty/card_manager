import { X } from 'lucide-react';

export default function CardDetailModal({ card, onClose }) {
  if (!card) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-[#1E1E1E] w-full max-w-4xl max-h-[90vh] rounded-2xl border border-gray-700 shadow-2xl overflow-hidden flex flex-col md:flex-row" onClick={e => e.stopPropagation()}>

        {/* Left: Image */}
        <div className="w-full md:w-1/3 bg-black flex items-center justify-center p-6 border-b md:border-b-0 md:border-r border-gray-700">
           <img
             src={card.image_url}
             alt={card.name}
             className="max-w-full max-h-[60vh] object-contain shadow-[0_0_30px_rgba(157,0,255,0.2)] rounded-lg"
           />
        </div>

        {/* Right: Details */}
        <div className="flex-1 p-8 overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-start mb-6">
                <div>
                    <h2 className="text-3xl font-bold text-space-white mb-2">{card.name}</h2>
                    <div className="flex flex-wrap gap-2">
                        <span className="px-3 py-1 bg-space-violet/20 text-space-violet rounded-full text-sm font-medium border border-space-violet/30">
                            {card.type}
                        </span>
                        {card.race && (
                             <span className="px-3 py-1 bg-gray-800 text-gray-300 rounded-full text-sm font-medium border border-gray-700">
                                {card.race}
                             </span>
                        )}
                        {card.attribute && (
                             <span className="px-3 py-1 bg-gray-800 text-gray-300 rounded-full text-sm font-medium border border-gray-700 font-mono">
                                {card.attribute}
                             </span>
                        )}
                    </div>
                </div>
                <button onClick={onClose} className="p-2 bg-gray-800 hover:bg-red-500/20 text-gray-400 hover:text-red-400 rounded-full transition-colors">
                    <X className="w-6 h-6" />
                </button>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-8">
                {/* Level / Rank */}
                {card.level != null && (
                    <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-800">
                        <span className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Level / Rank</span>
                        <span className="text-xl font-bold text-yellow-500">★ {card.level}</span>
                    </div>
                )}

                {/* ATK */}
                {card.atk != null && (
                    <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-800">
                        <span className="text-xs text-gray-500 uppercase tracking-wider block mb-1">ATK</span>
                        <span className="text-xl font-bold text-red-400">{card.atk}</span>
                    </div>
                )}

                 {/* DEF */}
                 {card.def != null && (
                    <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-800">
                        <span className="text-xs text-gray-500 uppercase tracking-wider block mb-1">DEF</span>
                        <span className="text-xl font-bold text-blue-400">{card.def}</span>
                    </div>
                )}

                 {/* Passcode */}
                <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-800">
                    <span className="text-xs text-gray-500 uppercase tracking-wider block mb-1">Passcode</span>
                    <span className="text-xl font-mono text-gray-300">{card.id}</span>
                </div>
            </div>

            <div className="prose prose-invert max-w-none">
                <h3 className="text-lg font-semibold text-gray-300 mb-2">Description</h3>
                <p className="text-gray-400 leading-relaxed whitespace-pre-wrap font-serif text-lg bg-black/20 p-4 rounded-lg border border-gray-800">
                    {card.desc}
                </p>
            </div>
        </div>
      </div>
    </div>
  );
}
