import { useEffect, useRef, useState } from 'react';
import { Grid } from 'react-window';
import CardTile from './CardTile';
import { formatCopyLocation } from '../utils/copyLocation';
import { forSaleSuffix } from '../utils/duplicates';

// Spec I §10 -- aus CollectionList.jsx verschoben (reine Verschiebung): das virtualisierte Kartengitter.
// items: gefilterte Kartengruppen; containers/filterContainers: fuer den Standort-Chip unter der Kachel;
// forSaleByCard: Map card_id -> Anzahl vorgemerkter Exemplare; onOpen(card): Kartendetail oeffnen.

// Simple AutoSizer replacement
const AutoSizer = ({ children }) => {
    const ref = useRef(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    useEffect(() => {
        if (!ref.current) return;
        const resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
            }
        });
        resizeObserver.observe(ref.current);
        return () => resizeObserver.disconnect();
    }, []);

    return (
        <div ref={ref} style={{ width: '100%', height: '100%' }}>
            {size.width > 0 && size.height > 0 && children(size)}
        </div>
    );
};

// Width of a scrollbar in this build, measured once. index.css styles it (8px today), so
// reading it off the page beats repeating the number here.
let sbWidth = null;
const scrollbarWidth = () => {
    if (sbWidth == null) {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow-y:scroll';
        document.body.appendChild(probe);
        sbWidth = probe.offsetWidth - probe.clientWidth;
        probe.remove();
    }
    return sbWidth;
};

// Virtualized Grid Cell Renderer
const Cell = ({ columnIndex, rowIndex, style, ...props }) => {
    // In this version of react-window, data is passed via props merged from cellProps?
    // Wait, .d.ts says: cellComponent receives (props: { ... } & CellProps)
    // So items and columnCount should be in props directly if I pass them in cellProps.

    const { items, columnCount, containers, filterContainers, forSaleByCard, onOpen, selectMode, selected } = props;
    // Note: columnIndex and rowIndex are also in props.

    const index = rowIndex * columnCount + columnIndex;
    if (index >= items.length) return null;
    const card = items[index];
    // Spec B1 §7.4: der Chip gehoert zum EXEMPLAR, das den aktiven Behaelterfilter erfuellt hat
    // (card._locationCopy, siehe CollectionList.jsx: filtered), nicht zum Printing -- deshalb hier und nicht
    // in CardTile.jsx (das kennt keine Exemplare, nur aggregierte Printing-Zeilen).
    const locationCopy = card._locationCopy;
    const locationContainer = locationCopy ? containers.find(ct => ct.container_id === locationCopy.container_id) : null;

    return (
        <div style={{ ...style, padding: 8 }}>
            <CardTile card={card} onClick={(e) => onOpen(card, e)} saleNote={forSaleSuffix(forSaleByCard.get(String(card.id)) || 0)}
                selectMode={selectMode} selected={!!selected && selected.has(String(card.id))} />
            {filterContainers.length > 0 && locationCopy && (
                <div className="mt-1 px-0.5">
                    <span className="inline-flex items-center font-mono text-klein text-muted bg-surface border border-line rounded px-1.5 py-0.5 truncate max-w-full">
                        {formatCopyLocation(locationCopy, locationContainer)}
                    </span>
                </div>
            )}
        </div>
    );
};


export default function CollectionGrid({ items, containers, filterContainers, forSaleByCard, onOpen, selectMode = false, selected = null }) {
  return (
    <AutoSizer>
        {({ height, width }) => {
            // The Grid's own vertical scrollbar sits inside the width AutoSizer
            // measured. Columns spread across the full width would push the last one
            // underneath it and make the Grid scroll sideways, so lay them out
            // across what the scrollbar leaves over.
            const inner = Math.max(width - scrollbarWidth(), 0);
            // Responsive Column Count
            const columnWidth = 180;
            const columnCount = Math.floor(inner / columnWidth) || 1;
            const rowCount = Math.ceil(items.length / columnCount);

            return (
                <Grid
                    columnCount={columnCount}
                    columnWidth={inner / columnCount}
                    defaultHeight={height}
                    rowCount={rowCount}
                    rowHeight={300}
                    width={width}
                    height={height} // Also pass height for Grid style
                    cellProps={{ items, columnCount, containers, filterContainers, forSaleByCard, onOpen, selectMode, selected }}
                    cellComponent={Cell}
                />
            );
        }}
    </AutoSizer>
  );
}
