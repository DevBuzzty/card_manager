# Manuell nachgetragene Artworks

Ausschnitte (nur das Bildfenster, wie der Detektor es boxt) aus echten Fotos, für Karten, deren Artwork
YGOPRODeck nicht führt. Dateiname: `<passcode>_<beliebig>.jpg` (Haupt-Passcode, nicht die Artwork-ID).
`ml/build_index.py` hängt sie bei jedem Neubau automatisch an; für ein bestehendes `index.bin`:
`python -m ml.add_manual_artworks --out <ziel>`.

| Passcode | Karte | Quelle |
|---|---|---|
| 63166095 | Himmelsjäger-Ass – Einsatz! (MAMO, neue Illustration) | 3 Fotos des Nutzers, 18.09.2026 |
