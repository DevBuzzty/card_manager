# Set-Code Auto-Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Read the printed set code (e.g. `DOOD-DE038`, any language) via the phone's OCR alongside the passcode, and have the desktop auto-select the matching set + rarity in the Staging Area (validated against the fetched set list; manual fallback when no match).

**Architecture:** Phone `CardAnalyzer` gains a set-code pattern, votes over the same frame window, and emits `{passcode, setCode}`. `main.cjs` forwards the socket payload verbatim (no change). Desktop `App.jsx` stores the scanned set code on the staged card; `StagingArea` matches it against the API `card_sets` (immediate) and the Yugipedia German sets (background) to preselect set+rarity, marking it auto-detected.

**Tech Stack:** Kotlin/Compose + ML Kit + CameraX (Android); React (desktop). Rarity is NOT OCR-able (visual only) — it is derived from the matched set code.

## Global Constraints
- Android: only `android/app/src/main/java/com/example/yugiohscanner/MainActivity.kt`. Desktop: only `desktop/src/App.jsx` + `desktop/src/components/StagingArea.jsx`. No backend/IPC change (socket forward is transparent).
- No test framework. Android verify = Gradle `:app:assembleDebug` compiles. Desktop verify = `npm run build` (from `desktop/`) passes + `npm run lint` no new errors.
- Match existing style. Work on branch `feat-setcode` from `main`; commit per task.

Android build command (no wrapper; use the existing gradle dist):
```bash
cd android && ANDROID_HOME="C:/Users/Buzzty/AppData/Local/Android/Sdk" JAVA_HOME="C:/Program Files/Eclipse Adoptium/jdk-17.0.19.10-hotspot" \
"/c/Users/Buzzty/.gradle/wrapper/dists/gradle-8.14.3-bin/cv11ve7ro1n3o1j4so8xd9n66/gradle-8.14.3/bin/gradle" :app:assembleDebug --no-daemon --console=plain
```

---

### Task 1: Android — detect & emit the set code

**Files:** Modify `android/app/src/main/java/com/example/yugiohscanner/MainActivity.kt`

**Interfaces:** `CardAnalyzer.onResultDetected` becomes `(String, String?) -> Unit` (passcode, setCode-or-null). Emits socket `{passcode, setCode?}`.

- [ ] **Step 1: Add the Locale import**

After the line `import java.util.regex.Pattern`, add:
```kotlin
import java.util.Locale
```

- [ ] **Step 2: Replace the `onDetected` handler** (currently `rememberUpdatedState<(String) -> Unit> { code -> ... }`) with:
```kotlin
    val onDetected = rememberUpdatedState<(String, String?) -> Unit> { code, setCode ->
        if (code != lastScannedCode) {
            lastScannedCode = code
            scanStatus = if (setCode != null) "Detected: $code ($setCode)" else "Detected: $code"
            triggerFeedback()
            onAddHistory(scanStatus)
            val data = JSONObject()
            data.put("passcode", code)
            if (setCode != null) data.put("setCode", setCode)
            socket?.emit("card_scanned", data)
        }
    }
```

- [ ] **Step 3: Update the analyzer construction** — change the `onResultDetected` line inside `remember { CardAnalyzer( ... ) }` from
```kotlin
            onResultDetected = { code -> onDetected.value(code) },
```
to
```kotlin
            onResultDetected = { code, setCode -> onDetected.value(code, setCode) },
```

- [ ] **Step 4: Replace the entire `CardAnalyzer` class** (from `class CardAnalyzer(` to its closing brace) with:
```kotlin
class CardAnalyzer(
    private val onResultDetected: (String, String?) -> Unit,
    private val onProgress: (String, Int, Int) -> Unit = { _, _, _ -> }
) : ImageAnalysis.Analyzer {
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    // Passcode: 8 digits. Set code: PREFIX-<2-letter region><digits>, e.g. LOB-EN001, DOOD-DE038.
    private val passcodePattern = Pattern.compile("\\b\\d{8}\\b")
    private val setCodePattern = Pattern.compile("\\b[A-Z0-9]{2,5}-[A-Z]{2}\\d{2,4}\\b")

    // Multi-frame confirmation for the passcode (the identity we key on); the set code is
    // detected opportunistically over the same window and attached when a passcode confirms.
    private val window = ArrayDeque<Set<String>>()
    private val setWindow = ArrayDeque<Set<String>>()
    private val WINDOW = 6
    private val REQUIRED_HITS = 3
    private var confirmed: String? = null

    @OptIn(ExperimentalGetImage::class)
    override fun analyze(imageProxy: ImageProxy) {
        val mediaImage = imageProxy.image
        if (mediaImage == null) {
            imageProxy.close()
            return
        }
        val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)

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

    private fun registerFrame(passcodes: Set<String>, setCodes: Set<String>) {
        window.addLast(passcodes)
        while (window.size > WINDOW) window.removeFirst()
        setWindow.addLast(setCodes)
        while (setWindow.size > WINDOW) setWindow.removeFirst()

        val counts = HashMap<String, Int>()
        for (frame in window) for (code in frame) counts[code] = (counts[code] ?: 0) + 1

        // Clear the confirmation once that card has left the view, so re-scanning works.
        confirmed?.let { if (counts[it] == null) confirmed = null }

        val best = counts.maxByOrNull { it.value } ?: return
        if (best.key != confirmed) {
            onProgress(best.key, best.value.coerceAtMost(REQUIRED_HITS), REQUIRED_HITS)
            if (best.value >= REQUIRED_HITS) {
                confirmed = best.key
                onResultDetected(best.key, bestSetCode())
            }
        }
    }

    // Most frequently seen set code across the current window (null if none seen).
    private fun bestSetCode(): String? {
        val counts = HashMap<String, Int>()
        for (frame in setWindow) for (code in frame) counts[code] = (counts[code] ?: 0) + 1
        return counts.maxByOrNull { it.value }?.key
    }

    // Release the ML Kit recognizer; call when the scanner is torn down.
    fun close() {
        recognizer.close()
    }
}
```

- [ ] **Step 5: Build** with the Android build command from Global Constraints. Expected: `BUILD SUCCESSFUL`, `:app:compileDebugKotlin` passes.

- [ ] **Step 6: Commit**
```bash
git add android/app/src/main/java/com/example/yugiohscanner/MainActivity.kt
git commit -m "feat(android): OCR the set code alongside the passcode, emit both"
```

---

### Task 2: Desktop — auto-select the scanned set + rarity

**Files:** Modify `desktop/src/App.jsx`, `desktop/src/components/StagingArea.jsx`

**Interfaces:** staged card gains `scannedSetCode` (from socket) and `setAutoDetected` (bool, set when a match is chosen).

- [ ] **Step 1: `App.jsx` — carry the scanned set code onto the staged card**

In the `onCardScanned` handler, the new-card object literal:
```jsx
            return [{
                tempId: Date.now() + Math.random(),
                passcode: data.passcode,
                status: 'pending',
                data: null
            }, ...prev];
```
becomes:
```jsx
            return [{
                tempId: Date.now() + Math.random(),
                passcode: data.passcode,
                scannedSetCode: data.setCode || null,
                status: 'pending',
                data: null
            }, ...prev];
```

- [ ] **Step 2: `StagingArea.jsx` — add a match helper**

Near the top of the file, after the imports, add:
```jsx
// Find a set entry whose set_code matches the OCR-detected code (case-insensitive).
const matchSet = (sets, code) => (code && sets) ? sets.find(s => s.set_code && s.set_code.toUpperCase() === code.toUpperCase()) : null;
```

- [ ] **Step 3: `StagingArea.jsx` — immediate preselect from API sets**

In `fetchCard`, the loaded-state object currently ends with:
```jsx
            language: c.language || 'DE',
            selectedSet: c.selectedSet || (data.card_sets ? data.card_sets[0] : null)
        } : c));
```
Replace those two lines with:
```jsx
            language: c.language || 'DE',
            selectedSet: c.selectedSet || matchSet(data.card_sets, c.scannedSetCode) || (data.card_sets ? data.card_sets[0] : null),
            setAutoDetected: !!(c.scannedSetCode && matchSet(data.card_sets, c.scannedSetCode))
        } : c));
```

- [ ] **Step 4: `StagingArea.jsx` — prefer the scanned code among German sets**

In the background Yugipedia `.then` handler, replace this block:
```jsx
                const hasSets = germanSets && germanSets.length > 0;
                // Don't clobber a set the user already picked or a manual entry.
                const keepSelection = c.setTouched || c.isManualEntry;
                return {
                    ...c,
                    loadingSets: false,
                    germanSets: hasSets ? germanSets : [],
                    selectedSet: (hasSets && !keepSelection && (c.language || 'DE') === 'DE')
                        ? { ...germanSets[0], isYugipedia: true }
                        : c.selectedSet
                };
```
with:
```jsx
                const hasSets = germanSets && germanSets.length > 0;
                // Don't clobber a set the user already picked or a manual entry.
                const keepSelection = c.setTouched || c.isManualEntry;
                const applyDE = hasSets && !keepSelection && (c.language || 'DE') === 'DE';
                const scanned = applyDE ? matchSet(germanSets, c.scannedSetCode) : null;
                const chosen = applyDE ? { ...(scanned || germanSets[0]), isYugipedia: true } : c.selectedSet;
                return {
                    ...c,
                    loadingSets: false,
                    germanSets: hasSets ? germanSets : [],
                    selectedSet: chosen,
                    setAutoDetected: applyDE ? !!scanned : c.setAutoDetected
                };
```

- [ ] **Step 5: `StagingArea.jsx` — show an "auto" badge when detected**

In the rarity/set selection area, inside the `<div className="flex-1 flex gap-2">` that holds the set dropdown and the manual-entry toggle button, add — immediately BEFORE the manual-entry toggle `<button ...>` (the one with `title="Toggle Manual Entry"`):
```jsx
                                        {card.setAutoDetected && !card.isManualEntry && (
                                            <span className="self-center shrink-0 text-[9px] font-bold uppercase tracking-wide text-good bg-good/10 border border-good/30 rounded px-1.5 py-1" title="Set code read from the card">
                                                Auto
                                            </span>
                                        )}
```

- [ ] **Step 6: Verify** from `desktop/`: `npm run build` (passes) + `npm run lint` (no new errors).

- [ ] **Step 7: Commit**
```bash
git add desktop/src/App.jsx desktop/src/components/StagingArea.jsx
git commit -m "feat(ui): auto-select scanned set code + rarity in Staging (validated, manual fallback)"
```

---

## Self-Review
- Set code OCR + emit → Task 1. Rarity derived from matched set (not OCR'd) — documented. ✔
- Desktop stores scanned code, matches API sets immediately + German sets in background, marks auto-detected, manual/first-set fallback when no match → Task 2. ✔
- No backend/IPC change (socket forwards payload verbatim). ✔
- `matchSet` defined once, used in Steps 3 & 4 with identical semantics; `scannedSetCode`/`setAutoDetected` names consistent across App.jsx and StagingArea.jsx. ✔
- Verification: Android Gradle assembleDebug; desktop build+lint (no test framework). ✔
