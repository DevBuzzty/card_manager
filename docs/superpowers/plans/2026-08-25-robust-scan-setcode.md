# Robust Set-Code Scan + Rarity Preselect + Fast Staging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make scanned set-codes resolve to the correct printing (and thus rarity) far more often by fuzzy-matching noisy OCR candidates against the card's real printing list, and make committing scans fast (keyboard + batch).

**Architecture:** OCR stays noisy but a card's true set list is small and known (YGOPRODeck `card_sets` + Yugipedia `de_sets`). The phone emits the top OCR set-code *candidates*; the desktop picks the real printing via a confusion-aware Levenshtein match. No ML model. Additive and backward-compatible — old phone (single `setCode`) and old desktop (ignores candidates) both keep working.

**Tech Stack:** Kotlin/Jetpack Compose + CameraX 1.3.1 + ML Kit (Android); React (Vite) renderer + Socket.io (desktop). Tests: `node --test` (built-in, project is ESM).

## Global Constraints

- Desktop renderer is ESM; Electron main is CommonJS `.cjs` — do not convert either. This plan touches only renderer `.jsx`/`.js`.
- Card identity is the composite key `(id, set_code, language)`; do not change DB schema — no migration in this plan.
- Socket protocol stays backward-compatible: `passcode` and `setCode` fields remain; `setCodeCandidates` is purely additive.
- CameraX version is 1.3.1 (`ImageProxy.toBitmap()` available). minSdk 26.
- German-first: default language `'DE'`.

---

### Task 1: Confusion-aware set-code matcher (pure util + tests)

**Files:**
- Create: `desktop/src/utils/setCodeMatch.js`
- Test: `desktop/src/utils/setCodeMatch.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `normalize(code: string): string`
  - `confusionDistance(a: string, b: string): number`
  - `matchCandidates(candidates: string[], sets: Array<{set_code: string}>): { set: object|null, score: number, confidence: 'exact'|'fuzzy'|'none' }`

- [ ] **Step 1: Write the failing test**

Create `desktop/src/utils/setCodeMatch.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, confusionDistance, matchCandidates } from './setCodeMatch.js';

const sets = [
  { set_code: 'DOOD-DE038', set_rarity: 'Secret Rare' },
  { set_code: 'LOB-EN001', set_rarity: 'Ultra Rare' },
  { set_code: 'SDK-DE050', set_rarity: 'Common' },
];

test('normalize uppercases and strips whitespace', () => {
  assert.equal(normalize(' dood-de038 '), 'DOOD-DE038');
  assert.equal(normalize(null), '');
});

test('confusion substitutions are cheap (0.5), real edits cost 1', () => {
  assert.equal(confusionDistance('DOOD-DE038', 'DOOD-DE038'), 0);
  assert.equal(confusionDistance('DOOO-DE038', 'DOOD-DE038'), 0.5); // O<->D
  assert.ok(confusionDistance('DXXD-DE038', 'DOOD-DE038') >= 2);    // real edits
});

test('exact candidate wins with confidence exact', () => {
  const r = matchCandidates(['LOB-EN001'], sets);
  assert.equal(r.set.set_code, 'LOB-EN001');
  assert.equal(r.confidence, 'exact');
});

test('OCR-mangled candidate corrects to the right printing (fuzzy)', () => {
  const r = matchCandidates(['DOOO-DE038'], sets); // O misread for D
  assert.equal(r.set.set_code, 'DOOD-DE038');
  assert.equal(r.confidence, 'fuzzy');
});

test('multiple confusions within threshold still match', () => {
  const r = matchCandidates(['LO8-EN00I'], sets); // 8->B, I->1  => distance 1.0
  assert.equal(r.set.set_code, 'LOB-EN001');
  assert.equal(r.confidence, 'fuzzy');
});

test('best candidate is chosen when several are given', () => {
  const r = matchCandidates(['ZZZZ-ZZ999', 'DOOD-DE038'], sets);
  assert.equal(r.set.set_code, 'DOOD-DE038');
  assert.equal(r.confidence, 'exact');
});

test('no plausible match => confidence none, set null', () => {
  const r = matchCandidates(['ZZZZ-ZZ999'], sets);
  assert.equal(r.set, null);
  assert.equal(r.confidence, 'none');
});

test('empty candidates or empty sets => none', () => {
  assert.equal(matchCandidates([], sets).confidence, 'none');
  assert.equal(matchCandidates(['LOB-EN001'], []).confidence, 'none');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `desktop/`): `node --test src/utils/setCodeMatch.test.js`
Expected: FAIL — `Cannot find module './setCodeMatch.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `desktop/src/utils/setCodeMatch.js`:

```js
// Confusion-aware fuzzy matching of OCR'd set-code candidates against a card's
// known printings. OCR is noisy, but a card's true set list is small and known,
// so we recover the correct printing by matching candidates against ground truth.

const CONFUSION_PAIRS = [
  ['O', '0'], ['I', '1'], ['S', '5'], ['B', '8'], ['Z', '2'], ['D', 'O'],
];
const CONFUSION = new Set(CONFUSION_PAIRS.flatMap(([a, b]) => [a + b, b + a]));

const FUZZY_THRESHOLD = 1.5;

export function normalize(code) {
  return (code || '').toString().toUpperCase().replace(/\s+/g, '');
}

// 0 identical, 0.5 for a known OCR confusion, 1 otherwise.
function subCost(a, b) {
  if (a === b) return 0;
  return CONFUSION.has(a + b) ? 0.5 : 1;
}

// Levenshtein with weighted substitutions.
export function confusionDistance(a, b) {
  a = normalize(a); b = normalize(b);
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + subCost(a[i - 1], b[j - 1])
      );
    }
  }
  return dp[m][n];
}

// Match candidate codes against `sets` (each with `.set_code`).
export function matchCandidates(candidates, sets) {
  const cands = (candidates || []).map(normalize).filter(Boolean);
  if (!sets || sets.length === 0 || cands.length === 0) {
    return { set: null, score: Infinity, confidence: 'none' };
  }
  // Exact match wins outright.
  for (const c of cands) {
    const hit = sets.find(s => normalize(s.set_code) === c);
    if (hit) return { set: hit, score: 0, confidence: 'exact' };
  }
  // Otherwise smallest weighted distance across all candidate x set pairs.
  let best = null, bestScore = Infinity;
  for (const s of sets) {
    for (const c of cands) {
      const d = confusionDistance(c, s.set_code);
      if (d < bestScore) { bestScore = d; best = s; }
    }
  }
  if (best && bestScore <= FUZZY_THRESHOLD) {
    return { set: best, score: bestScore, confidence: 'fuzzy' };
  }
  return { set: null, score: bestScore, confidence: 'none' };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `desktop/`): `node --test src/utils/setCodeMatch.test.js`
Expected: PASS (all 8 tests).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/utils/setCodeMatch.js desktop/src/utils/setCodeMatch.test.js
git commit -m "feat(scan): confusion-aware set-code matcher with tests"
```

---

### Task 2: Wire candidates + fuzzy match + confidence into staging

**Files:**
- Modify: `desktop/src/App.jsx:37` (carry candidates into staging object)
- Modify: `desktop/src/components/StagingArea.jsx` (import matcher; replace `matchSet`; set `setMatchConfidence`; badge)

**Interfaces:**
- Consumes: `matchCandidates` from Task 1.
- Produces: each staging card gains `scannedSetCandidates: string[]` and `setMatchConfidence: 'exact'|'fuzzy'|'none'`; `setAutoDetected` stays truthy for exact **and** fuzzy.

- [ ] **Step 1: Carry candidates from the scan event**

In `desktop/src/App.jsx`, in the `onCardScanned` handler object (currently around line 34-40), add the candidates field right after `scannedSetCode`:

```jsx
            return [{
                tempId: Date.now() + Math.random(),
                passcode: data.passcode,
                scannedSetCode: data.setCode || null,
                scannedSetCandidates: data.setCodeCandidates || (data.setCode ? [data.setCode] : []),
                status: 'pending',
                data: null
            }, ...prev];
```

- [ ] **Step 2: Import the matcher and drop the exact-only helper**

In `desktop/src/components/StagingArea.jsx`, add the import near the top (after the existing imports):

```jsx
import { matchCandidates } from '../utils/setCodeMatch';
```

Delete the old exact helper (lines 9-10):

```jsx
// Find a set entry whose set_code matches the OCR-detected code (case-insensitive).
const matchSet = (sets, code) => (code && sets) ? sets.find(s => s.set_code && s.set_code.toUpperCase() === code.toUpperCase()) : null;
```

- [ ] **Step 3: Use fuzzy match on first load**

In `fetchCard`, replace the `selectedSet` / `setAutoDetected` lines in the first `setScannedCards(... status:'loaded' ...)` mapping (currently lines 55-56) with a computed match. Change the mapping callback so it computes the match, i.e. replace:

```jsx
        setScannedCards(prev => prev.map(c => c.tempId === tempId ? {
            ...c,
            status: 'loaded',
            data,
            germanSets: [],
            loadingSets: true,
            inCollection: result.exists,
            ownedQuantity: result.quantity,
            language: c.language || 'DE',
            selectedSet: c.selectedSet || matchSet(data.card_sets, c.scannedSetCode) || (data.card_sets ? data.card_sets[0] : null),
            setAutoDetected: !!(c.scannedSetCode && matchSet(data.card_sets, c.scannedSetCode))
        } : c));
```

with:

```jsx
        setScannedCards(prev => prev.map(c => {
            if (c.tempId !== tempId) return c;
            const apiMatch = matchCandidates(c.scannedSetCandidates, data.card_sets);
            return {
                ...c,
                status: 'loaded',
                data,
                germanSets: [],
                loadingSets: true,
                inCollection: result.exists,
                ownedQuantity: result.quantity,
                language: c.language || 'DE',
                selectedSet: c.selectedSet || apiMatch.set || (data.card_sets ? data.card_sets[0] : null),
                setAutoDetected: apiMatch.confidence !== 'none',
                setMatchConfidence: apiMatch.confidence
            };
        }));
```

- [ ] **Step 4: Use fuzzy match in the Yugipedia (German) follow-up**

In the `fetchYugipediaSets(...).then(...)` block, replace the scanned-match line (currently line 68) and the branch that sets `chosen`/`auto` so it uses `matchCandidates` and records confidence. Replace:

```jsx
                const scanned = applyDE ? matchSet(germanSets, c.scannedSetCode) : null;
                let chosen = c.selectedSet;
                let auto = c.setAutoDetected;
                if (applyDE) {
                    if (scanned) {
                        // Prefer the localized German printing when the scanned code matches it.
                        chosen = { ...scanned, isYugipedia: true };
                        auto = true;
                    } else if (c.setAutoDetected) {
                        // The API path already validated the scanned code — keep it, don't clobber.
                        chosen = c.selectedSet;
                        auto = true;
                    } else {
                        chosen = { ...germanSets[0], isYugipedia: true };
                        auto = false;
                    }
                }
                return {
                    ...c,
                    loadingSets: false,
                    germanSets: hasSets ? germanSets : [],
                    selectedSet: chosen,
                    setAutoDetected: auto
                };
```

with:

```jsx
                const deMatch = applyDE ? matchCandidates(c.scannedSetCandidates, germanSets) : null;
                let chosen = c.selectedSet;
                let auto = c.setAutoDetected;
                let confidence = c.setMatchConfidence;
                if (applyDE) {
                    if (deMatch && deMatch.set) {
                        // Prefer the localized German printing when a candidate matches it.
                        chosen = { ...deMatch.set, isYugipedia: true };
                        auto = true;
                        confidence = deMatch.confidence;
                    } else if (c.setAutoDetected) {
                        // The API path already matched the scanned code — keep it, don't clobber.
                        chosen = c.selectedSet;
                        auto = true;
                    } else {
                        chosen = { ...germanSets[0], isYugipedia: true };
                        auto = false;
                        confidence = 'none';
                    }
                }
                return {
                    ...c,
                    loadingSets: false,
                    germanSets: hasSets ? germanSets : [],
                    selectedSet: chosen,
                    setAutoDetected: auto,
                    setMatchConfidence: confidence
                };
```

- [ ] **Step 5: Show a confidence badge**

Replace the existing `Auto` badge block (currently lines 425-429) with confidence-aware styling:

```jsx
                                        {card.setMatchConfidence === 'exact' && !card.isManualEntry && (
                                            <span className="self-center shrink-0 text-[9px] font-bold uppercase tracking-wide text-good bg-good/10 border border-good/30 rounded px-1.5 py-1" title="Set code read from the card">
                                                Erkannt
                                            </span>
                                        )}
                                        {card.setMatchConfidence === 'fuzzy' && !card.isManualEntry && (
                                            <span className="self-center shrink-0 text-[9px] font-bold uppercase tracking-wide text-yellow-400 bg-yellow-400/10 border border-yellow-400/30 rounded px-1.5 py-1" title="Set code recovered from an imperfect scan — please verify">
                                                Prüfen?
                                            </span>
                                        )}
```

- [ ] **Step 6: Verify in the app**

Run (from `desktop/`): `npm run lint`
Expected: no new errors.
Then `npm run electron:dev`, scan/emit a card whose set code is slightly misread and confirm the correct German printing + rarity is preselected with a yellow "Prüfen?" badge; an exact read shows green "Erkannt".

- [ ] **Step 7: Commit**

```bash
git add desktop/src/App.jsx desktop/src/components/StagingArea.jsx
git commit -m "feat(staging): fuzzy-match set-code candidates, preselect rarity, confidence badge"
```

---

### Task 3: Fast committing — Enter key + "Add All Detected"

**Files:**
- Modify: `desktop/src/components/StagingArea.jsx` (keydown effect; header button)

**Interfaces:**
- Consumes: `handleAdd(tempId)`, `scannedCards`, `card.status`, `card.setMatchConfidence` from Task 2.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Add an Enter-to-commit-topmost effect**

In `StagingArea.jsx`, add this effect after the existing pending-processing `useEffect` (the one ending around line 115). It commits the topmost loaded card, but never while the user is typing in a field:

```jsx
  // Enter commits the topmost loaded card (bulk scanning without the mouse).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Enter') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const top = scannedCards.find(c => c.status === 'loaded');
      if (top) { e.preventDefault(); handleAdd(top.tempId); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scannedCards]);
```

- [ ] **Step 2: Add an "Add All Detected" header button**

In the header button row, immediately before the existing `Add All` button (currently starting line 220 with `{scannedCards.some(c => c.status === 'loaded') && (`), insert a button that commits only exact-confidence cards:

```jsx
                {scannedCards.some(c => c.status === 'loaded' && c.setMatchConfidence === 'exact') && (
                     <button
                        onClick={() => {
                            scannedCards
                                .filter(c => c.status === 'loaded' && c.setMatchConfidence === 'exact')
                                .forEach(c => handleAdd(c.tempId));
                        }}
                        disabled={isUpdating}
                        className="flex items-center px-4 py-2 bg-good/20 hover:bg-good/30 text-good rounded-lg transition-colors text-sm border border-good/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Check className="w-4 h-4 mr-2" />
                        Add All Detected
                    </button>
                )}
```

- [ ] **Step 3: Verify in the app**

Run (from `desktop/`): `npm run lint`
Expected: no new errors.
Then `npm run electron:dev`: with several staged cards, press Enter → topmost is committed and removed; typing in a set-code field and pressing Enter does **not** commit. "Add All Detected" commits only the green ones, leaving yellow/manual behind.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/components/StagingArea.jsx
git commit -m "feat(staging): Enter commits topmost, Add All Detected batch button"
```

---

### Task 4: Android — center-crop ROI + emit top-3 set-code candidates

**Files:**
- Modify: `android/app/src/main/java/com/example/yugiohscanner/MainActivity.kt` (imports; `CardAnalyzer`; `ScannerScreen.onDetected`)

**Interfaces:**
- Consumes: nothing from other tasks (separate build).
- Produces: `card_scanned` JSON gains `setCodeCandidates: [..]` (top-3 by frequency); `setCode` still set to the best single (Task 2's desktop already consumes both).

- [ ] **Step 1: Add imports**

At the top of `MainActivity.kt`, add:

```kotlin
import android.graphics.Bitmap
import androidx.camera.core.ImageProxy
```

(`ImageProxy` may already be imported — keep a single import.)

- [ ] **Step 2: Center-crop the frame before OCR**

In `CardAnalyzer.analyze`, replace the body that builds `InputImage` (currently the `mediaImage`/`InputImage.fromMediaImage` lines) with a center-crop. Center is rotation-invariant, so this trims peripheral background text without any coordinate math:

```kotlin
    @OptIn(ExperimentalGetImage::class)
    override fun analyze(imageProxy: ImageProxy) {
        val mediaImage = imageProxy.image
        if (mediaImage == null) {
            imageProxy.close()
            return
        }
        val rotation = imageProxy.imageInfo.rotationDegrees
        val full = imageProxy.toBitmap()
        // Keep the central band where the framed card sits; drop edge/background text.
        val cropW = (full.width * 0.85f).toInt()
        val cropH = (full.height * 0.95f).toInt()
        val x = (full.width - cropW) / 2
        val y = (full.height - cropH) / 2
        val cropped = Bitmap.createBitmap(full, x, y, cropW, cropH)
        val image = InputImage.fromBitmap(cropped, rotation)

        recognizer.process(image)
            .addOnSuccessListener { visionText ->
                val passcodes = HashSet<String>()
                val setCodes = HashSet<String>()
                for (block in visionText.textBlocks) {
                    val text = block.text.uppercase(Locale.ROOT)
                    val pm = passcodePattern.matcher(text)
                    while (pm.find()) passcodes.add(pm.group())
                    val sm = setCodePattern.matcher(text)
                    while (sm.find()) setCodes.add(sm.group())
                }
                registerFrame(passcodes, setCodes)
            }
            .addOnFailureListener { e ->
                Log.e("Analyzer", "Text recognition failed", e)
            }
            .addOnCompleteListener {
                imageProxy.close()
            }
    }
```

- [ ] **Step 3: Collect the top-N set-code candidates**

In `CardAnalyzer`, add a helper next to `bestSetCode()`:

```kotlin
    // Most frequent set codes across the current window, highest first (up to `limit`).
    private fun topSetCodes(limit: Int): List<String> {
        val counts = HashMap<String, Int>()
        for (frame in setWindow) for (code in frame) counts[code] = (counts[code] ?: 0) + 1
        return counts.entries.sortedByDescending { it.value }.take(limit).map { it.key }
    }
```

- [ ] **Step 4: Emit candidates on confirmation**

Change the analyzer's result callback type to pass the list, and send the best single via `first()`.

In the `CardAnalyzer` constructor, change:

```kotlin
    private val onResultDetected: (String, String?) -> Unit,
```

to:

```kotlin
    private val onResultDetected: (String, List<String>) -> Unit,
```

In `registerFrame`, change the confirmation call from `onResultDetected(best.key, bestSetCode())` to:

```kotlin
                confirmed = best.key
                onResultDetected(best.key, topSetCodes(3))
```

(`bestSetCode()` is now unused — remove it to avoid an orphan.)

- [ ] **Step 5: Update the ScannerScreen handler to build the JSON**

In `ScannerScreen`, update `onDetected` (currently `(code, setCode)`) to accept the list and emit both fields:

```kotlin
    val onDetected = rememberUpdatedState<(String, List<String>) -> Unit> { code, setCodes ->
        if (code != lastScannedCode) {
            lastScannedCode = code
            val best = setCodes.firstOrNull()
            scanStatus = if (best != null) "Detected: $code ($best)" else "Detected: $code"
            triggerFeedback()
            onAddHistory(scanStatus)
            val data = JSONObject()
            data.put("passcode", code)
            if (best != null) {
                data.put("setCode", best)
                data.put("setCodeCandidates", JSONArray(setCodes))
            }
            socket?.emit("card_scanned", data)
        }
    }
```

And update the `CardAnalyzer(...)` construction in `ScannerScreen` so the `onResultDetected` lambda passes the list through:

```kotlin
    val analyzer = remember {
        CardAnalyzer(
            onResultDetected = { code, setCodes -> onDetected.value(code, setCodes) },
            onProgress = { code, hits, required -> onProgress.value(code, hits, required) }
        )
    }
```

- [ ] **Step 6: Build & manual verify**

Build the APK in Android Studio (or `./gradlew assembleDebug` from `android/`), install, connect to the desktop, and scan a few cards:
- Confirm cards still detect (passcode + set code) and the status shows the best set code.
- With the desktop running Task 2, confirm a slightly-misread set code now preselects the correct German printing/rarity ("Prüfen?" badge).
- Confirm the center-crop does not cut off the printed set code (bottom-left of the card) — if it does, widen `cropW`/`cropH` (e.g. 0.9/0.98) and rebuild.

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main/java/com/example/yugiohscanner/MainActivity.kt
git commit -m "feat(android): center-crop ROI + emit top-3 set-code candidates"
```

---

## Self-Review

**Spec coverage:**
- Teil A (Android ROI crop, looser candidate collection, `setCodeCandidates`, back-compat `setCode`) → Task 4. ✓ (Regex "loosening" is intentionally left as-is plus higher recall via top-N candidates + desktop fuzzy match; the existing pattern already captures the common shapes and the fuzzy match absorbs the rest. If field testing shows missed formats, widening `setCodePattern` is a one-line follow-up — noted, not a blocker.)
- Teil B (App.jsx candidates, `setCodeMatch.js`, confusion-aware match, confidence, badge) → Tasks 1 + 2. ✓
- Teil C (Enter key, batch button, existing parallel fetch unchanged) → Task 3. ✓
- Nicht-Ziel (no foil model, no auto-commit, no art-matching) → nothing added. ✓
- Verifikation (unit tests for the pure matcher; manual Android/desktop) → Task 1 tests + Task 2/3/4 manual steps. ✓
- Rollout (additive, no migration) → Global Constraints + back-compat fields. ✓

**Placeholder scan:** No TBD/TODO. The one deferred item (widening `setCodePattern`) is explicitly optional with concrete fallback values, not a required-but-unspecified step.

**Type consistency:** `matchCandidates` returns `{set, score, confidence}` in Task 1 and is consumed as `.set`/`.confidence` in Task 2. `setMatchConfidence` values `'exact'|'fuzzy'|'none'` are produced in Task 2 and read in Tasks 2 (badge) and 3 (button filter). Android `onResultDetected: (String, List<String>)` is defined in Task 4 Step 4 and consumed in Step 5 consistently. `scannedSetCandidates` set in App.jsx (Task 2 Step 1) and read by `matchCandidates` (Task 2 Steps 3-4). ✓
