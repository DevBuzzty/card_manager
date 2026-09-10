/**
 * Die drei Behaelterarten dieses Projekts mit ihren deutschen Beschriftungen.
 *
 * EINE Stelle im Renderer, absichtlich: die Beschriftungen standen bis zum Abschlussreview von
 * Spec B2 viermal da (Binders.jsx zweimal -- als Auswahlliste und als Nachschlagetabelle --,
 * BinderView.jsx, CopySheet.jsx), alle vier im selben JavaScript. Wer "Ordner" umbenannte,
 * benannte zwei von vier Stellen um. Am Handy hat Spec B2 Task 4 denselben Fund schon einmal
 * eingesammelt (CONTAINER_KIND_OPTIONS).
 *
 * KIND_OPTIONS wird aus KIND_LABELS abgeleitet und nicht zweitgeschrieben: die Reihenfolge des
 * Auswahlfeldes ist die Reihenfolge dieses Objekts (Ordner, Box, Deckbox), und eine neue Art
 * kommt damit an genau einer Stelle dazu. Kotlin macht es andersherum -- dort ist die Liste das
 * Original und die Tabelle die Ableitung (`CONTAINER_KIND_OPTIONS.toMap()`), weil ein Kotlin-Map
 * seine Reihenfolge nicht so selbstverstaendlich behaelt wie ein JS-Objektliteral mit
 * Zeichenketten-Schluesseln.
 *
 * Die Kotlin-Fassung derselben Beschriftungen steht in
 * android/app/src/main/java/com/example/yugiohscanner/cloud/ContainersRepository.kt.
 * Dass es sie zweimal gibt, ist Absicht (Sprachgrenze) -- beide Geraete zeigen dieselben
 * Behaelter. Wer hier etwas aendert, aendert dort mit; die Schluessel ('binder', 'box',
 * 'deckbox') sind ausserdem die Werte in der Spalte containers.kind und werden in
 * electron/copies.cjs#saveContainer geprueft.
 */
export const KIND_LABELS = { binder: 'Ordner', box: 'Box', deckbox: 'Deckbox' };

export const KIND_OPTIONS = Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }));
