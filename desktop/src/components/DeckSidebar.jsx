import { useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, BarChart, Bar, XAxis, YAxis } from 'recharts';
import { LOADING } from '../utils/deckCoverage';
import { NO_MAIN, drawHand, oddsTexts } from '../utils/deckOdds';
import { banlistDateText } from '../utils/deckLegality';

const TABS = [['stats', 'Statistik'], ['simulation', 'Simulation'], ['violations', 'Verstöße']];

// Spec E3 §7 — Seitenleiste neben dem Editor: Statistik (wie bisher), Simulation (§6), Verstöße (§4 plus Banlist-Stand).
// Alles aus dem ungespeicherten Editor-Stand. legality null = Katalog-Index noch nicht geladen.
export default function DeckSidebar({ mainDeck, extraDeck, sideDeck, legality, builtAt }) {
  const [tab, setTab] = useState('stats');
  return (
    <div className="w-80 flex-shrink-0 bg-[#1E1E1E] p-4 rounded-2xl border border-gray-800 flex flex-col min-h-0">
      <div className="flex gap-1 mb-4">
        {TABS.map(([value, label]) => (
          <button key={value} type="button" onClick={() => setTab(value)}
            className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium ${tab === value ? 'bg-space-violet text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {tab === 'stats' && <DeckStats mainDeck={mainDeck} extraDeck={extraDeck} sideDeck={sideDeck} />}
        {tab === 'simulation' && <DeckSimulation mainDeck={mainDeck} />}
        {tab === 'violations' && <DeckViolations legality={legality} builtAt={builtAt} />}
      </div>
    </div>
  );
}

function DeckSimulation({ mainDeck }) {
  const [hand, setHand] = useState(null);
  const odds = oddsTexts(mainDeck);
  const draw = (size) => setHand(drawHand(mainDeck, size));
  return (
    <div className="space-y-4">
      {odds.message ? (
        <p className="text-sm text-gray-400">{odds.message}</p>
      ) : (
        odds.lines.map((line) => (
          <div key={line.size} className="p-3 bg-black/30 rounded-xl border border-gray-800">
            <div className="text-sm text-white">{line.atLeastOne}</div>
            <div className="text-xs font-mono text-gray-400 mt-1">{line.distribution}</div>
          </div>
        ))
      )}
      <div className="flex gap-2">
        {[5, 6].map((size) => (
          <button key={size} type="button" onClick={() => draw(size)}
            className="flex-1 px-2 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs border border-gray-700">
            Testhand ziehen ({size})
          </button>
        ))}
      </div>
      {hand && hand.length === 0 && <p className="text-sm text-gray-400">{NO_MAIN}</p>}
      {hand && hand.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {hand.map((card, idx) => (
            <div key={idx} className={`aspect-[2/3] rounded overflow-hidden border-2 ${card.role === 'starter' ? 'border-warn' : 'border-gray-700'}`}>
              <img src={card.image_url} alt={card.name || ''} className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DeckViolations({ legality, builtAt }) {
  if (!legality) return <p className="text-sm text-gray-400">{LOADING}</p>;
  const date = banlistDateText(builtAt);
  return (
    <div className="space-y-2">
      {legality.violations.length === 0 && legality.warnings.length === 0 && <p className="text-sm text-gray-400">Keine Verstöße</p>}
      {legality.violations.map((v, i) => <p key={`v${i}`} className="text-sm text-crit">{v.text}</p>)}
      {legality.warnings.map((w, i) => <p key={`w${i}`} className="text-sm text-warn">{w.text}</p>)}
      {date && <p className="pt-2 text-xs text-gray-500">{date}</p>}
    </div>
  );
}

const DeckStats = ({ mainDeck, extraDeck, sideDeck }) => {
    const allCards = [...mainDeck, ...extraDeck, ...sideDeck];
    // Type breakdown (Monster, Spell, Trap) - Main Deck Only usually matters for ratios
    let monsters = 0, spells = 0, traps = 0;
    mainDeck.forEach(c => {
        if (c.type && c.type.includes('Monster')) monsters += c.quantity;
        else if (c.type && c.type.includes('Spell')) spells += c.quantity;
        else if (c.type && c.type.includes('Trap')) traps += c.quantity;
    });

    const typeData = [
        { name: 'Monster', value: monsters, color: '#A68349' }, // Orange/Brown
        { name: 'Spell', value: spells, color: '#1D9E74' },   // Green
        { name: 'Trap', value: traps, color: '#BC5A84' }     // Pink
    ].filter(d => d.value > 0);

    // Attribute breakdown (All cards)
    const attrCounts = {};
    allCards.forEach(c => {
        if (c.attribute) {
            attrCounts[c.attribute] = (attrCounts[c.attribute] || 0) + c.quantity;
        }
    });
    const attrData = Object.keys(attrCounts).map(k => ({ name: k, value: attrCounts[k] }));

    return (
        <div className="grid grid-cols-1 gap-4">
            <div className="bg-black/30 p-4 rounded-xl border border-gray-800 h-56">
                <h4 className="text-xs font-bold uppercase text-gray-500 mb-2">Card Types (Main)</h4>
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie data={typeData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={60}>
                            {typeData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                            ))}
                        </Pie>
                        <RechartsTooltip contentStyle={{ backgroundColor: '#1E1E1E', borderColor: '#333' }} itemStyle={{ color: '#fff' }} />
                    </PieChart>
                </ResponsiveContainer>
            </div>
            <div className="bg-black/30 p-4 rounded-xl border border-gray-800 h-56">
                <h4 className="text-xs font-bold uppercase text-gray-500 mb-2">Attributes</h4>
                 <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={attrData}>
                        <XAxis dataKey="name" stroke="#666" fontSize={10} />
                        <YAxis stroke="#666" fontSize={10} />
                        <RechartsTooltip cursor={{fill: 'transparent'}} contentStyle={{ backgroundColor: '#1E1E1E', borderColor: '#333' }} itemStyle={{ color: '#fff' }} />
                        <Bar dataKey="value" fill="#9D00FF" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
