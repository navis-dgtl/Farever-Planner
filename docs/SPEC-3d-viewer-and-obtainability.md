# Spec: 3D Gear Viewer + Full Obtainability for Farever Planner

**Audience:** an implementing agent starting with zero context on this project.
**Goal:** two features, built in two phases, each independently shippable:

1. **Phase 1 — Obtainability depth.** The "Find items" tab and item picker already show *where* items drop. Add *how likely* and *how to make*: drop percentages from the game's loot tables, full crafting recipes with material lists (and a reverse "used to craft" lookup), and gathering hints. **All of this data already exists inside this repo** — no new data sources are needed.
2. **Phase 2 — 3D model viewer.** A "View in 3D" button on gear items (helmets, shoulder pads, weapons, …) that opens the item's actual in-game model in an orbitable three.js modal. The models come from a sibling repo (`navis-dgtl/farever`) and get copied into this repo as a build step (a small referenced subset, not the whole library).

Do Phase 1 completely (including its verification gate) before starting Phase 2. If you run out of budget, a merged Phase 1 alone is valuable.

---

## 1. The project you are working in

- **Repo:** `navis-dgtl/Farever-Planner` — a gear/talent planner for the game Farever.
- **Architecture:** fully static site, **no build step for the site itself**. `index.html` loads `planner-static-config.js` + `gear-planner.js` (one ~19k-line vanilla-JS IIFE) + `gear-planner.css`. Game data is fetched at runtime from `game-data/`.
- **Hosting:** production on Vercel (`farever-planner.vercel.app`) auto-deploys `main`; PR branches get preview deploys. The site must also stay deployable on GitHub Pages, which imposes: **every runtime fetch/asset URL must be relative** (no leading `/`, no absolute origins). This is enforced by `validateRuntimeUrlPolicy()` and by `npm test`.
- **Node tooling** (`tools/*.mjs`, `tests/*.mjs`) runs the planner file in a Node `vm` with **no DOM**. `gear-planner.js` only touches `document` inside functions or behind `typeof document !== "undefined"` guards (see the bottom of the file for the mount guard). **Any module-level DOM access you add will break `npm test`.**
- **Dark theme** design tokens live at the top of `gear-planner.css` (`--gp-bg`, `--gp-panel`, `--gp-panel-raised`, `--gp-border`, `--gp-text`, `--gp-muted`, `--gp-accent`, `--gp-on-accent`, rarity colors). Use tokens, never hardcoded light colors.

### Commands

```sh
npm test                    # gear-item parity + planner regressions; MUST stay green
npm run audit:data          # informational; pre-existing TODO_* output is normal
npm run build:item-sources  # regenerates game-data/wiki/item_sources.json
python3 -m http.server 8765 # local dev server (fetch needs HTTP)
```

Browser verification: Playwright is preinstalled; launch Chromium with
`chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })` and browse
`http://localhost:8765/`. **localhost works; external sites are blocked for the
browser by the sandbox proxy** (curl works for external URLs). Screenshot every
UI change at 1440×900 and 390×844.

### Git

Work on one feature branch off latest `main`, commit per phase, push, open a PR.
`npm test` must pass before every commit.

---

## 2. Invariants — do not violate

1. **No site build step.** Ship plain JS/CSS/JSON. Node scripts under `tools/` are fine (they run at authoring time, committed outputs).
2. **Relative URLs only** for anything fetched at runtime. New URLs go into `planner-static-config.js` (`runtimeUrls` / `assetPrefixes`) and the `RUNTIME_FETCH_URLS` list near the top of `gear-planner.js` so the URL-policy test covers them.
3. **Never edit** `game-data/extracted/**` or `game-data/generated/**` (extraction-pipeline outputs) or `game-data/wiki/farever_*.json` / `game-data/wiki/cards/**` (user-uploaded wiki exports). Generated indexes you own: `game-data/wiki/item_sources.json` (via its tool) and the new files this spec adds.
4. **Escape all dynamic HTML** with the existing `escapeHtml()` before interpolating into `innerHTML`.
5. **New runtime data must be non-fatal**: if a fetch fails, record a diagnostic via `recordPlannerDiagnostic(...)` and degrade gracefully (hide the feature), exactly like the existing `itemSourcesPromise` handling in `main()`.
6. **No runtime CDN dependencies.** three.js gets vendored into the repo (Phase 2 §5.2).
7. Do not add more than **200 MB** of model files. Measure first (§5.1); if the referenced subset exceeds that, stop and ask the user.
8. Match the existing code style: 2-space indent, `/** ... */` doc comments, functions declared inside the IIFE, no classes, no TypeScript syntax.

---

## 3. Verified data facts (trust these — verified 2026-07-08; don't re-derive)

### 3.1 In this repo

`game-data/extracted/res.light/data.cdb` is JSON (`{ sheets: [{ name, lines }] }`). Relevant sheets:

- **`item`** — 877 rows. `visuals.modelPath` present on **705** rows for armor/loot
  (e.g. `Chest_C_BaseClothes` → `"Character/Hero/Outfit/Common/BaseClothes/Chest_ShortSleeves_BaseClothes_Com_01.prefab"`).
  **Weapons use a different field**: `visuals.models[].prefab`
  (e.g. `Staff_Craft` → `visuals: { models: [{ prefab: "Character/Weapon/Staff/Staff_Human_Brasero.prefab" }] }`).
- **`craft`** — **161 recipes** with full material lists:
  ```json
  { "item": "Waist_RManfish_Fig", "level": 1, "job": "Blacksmith",
    "input": [{ "count": 8, "item": "CopperIngot" }, { "count": 15, "item": "Fin_Z1" },
              { "count": 1, "item": "FragmentOfWater" }], "slots": 0, "cost": 75 }
  ```
  **Important:** the existing hydration in `gear-planner.js` (search for `craftRecipeByItemId = {}` and the loop that fills it, ~line 2920) currently stores **only `{ job, level }` and drops `input`/`cost`** — you will extend it.
- **`gatherable`** (22 rows) plus related sub-sheets (`element@props@lootItems`, `types@props@gains@lootTables`) — optional, see §4.4.

`game-data/loot_tables.json` (already fetched at runtime as `lootPromise`) has everything needed for drop percentages:

- `units`: `{ "<unitId>": { unitType, lootTableId, gfx } }`
- `lootTables`: `{ "<tableId>": { entries: [ { proba, item? , lootTable?, minLvl, maxLvl, conds?, name? } ] } }`
  — each entry has a **`proba`** (0..1). An entry either drops an `item` directly or rolls into a nested `lootTable`.
- `itemLootDisplay`: `{ "<itemId>": { gfx, rarity, itemTypeId, itemTypeName } }` (877 entries).

The planner already builds `itemDungeonBossDropsByItemId` from these tables (function `hydrateItemBossDropIndexFromLootTables`, and dungeon labels come via `dungeonBossByUnitId`) — but it discards probabilities. You will add a parallel probability index rather than rewriting that code.

### 3.2 In the sibling repo `navis-dgtl/farever`

Public repo, already cloned in the authoring session at `/workspace/farever`; clone it yourself if absent (`git clone --depth 1 https://github.com/navis-dgtl/farever <dir>` — it is ~950 MB, give the clone a 10-minute timeout).

- `public/model-library/` — **1,704 `.glb` models, 630 MB total**, exported from the game.
  Gear lives under `Character/Hero/Outfit/...` (per faction/rarity/slot, e.g.
  `Character/Hero/Outfit/Faction/Manfish/Rare/Shoulders_Outer_RManfish_Medium.glb`),
  weapons under `Character/Weapon/<Type>/...`.
- **Path mapping rule:** take the cdb prefab path, swap `.prefab` → `.glb`, resolve under
  `public/model-library/`. Measured success rate: **279/372** on a comparable id set. Most misses
  differ only by a numeric suffix (`Trinket_Stone_01.prefab` vs `Trinket_Stone.glb` or vice versa) —
  handle with the fallback probing in §5.1. Some models genuinely don't exist; that's fine (no button).
- Median GLB is ~187 KB; the referenced armor/loot subset measured **~237 files ≈ 60 MB**; weapons will add some more. Expect a final subset around 80–130 MB.
- The wiki's own viewer (`public/model-viewer/viewer-tree-multiprefab-v14.js`) is a working three.js
  reference: three `0.160.0`, `GLTFLoader`, `OrbitControls`, and it registers a `DDSLoader` — if a model
  loads with missing textures, consult how that file handles `.dds` (GLBs normally embed textures, so
  expect this to be rarely needed).

### 3.3 Existing planner integration points (find by grep, line numbers drift)

| What | Grep for |
|---|---|
| Find items tab renderer | `function renderItemFinderPanel` |
| Per-item source lines (Dungeons/World/Craft) | `function itemObtainLines` |
| Craft subtitle ("Level 1 Blacksmith craft") | `function itemCraftRecipeSubtitle` |
| Craft hydration to extend | `craftRecipeByItemId[iid] = { job: jobId, level:` |
| Startup parallel fetches | `const itemSourcesPromise = fetchJsonWithProgress` |
| Runtime URL constants | `const ITEM_SOURCES_URL` |
| Tab bar + panels markup | `id="gp-tab-item-finder"` |
| Item icon mounting (reuse!) | `function mountLootIcon` |
| Rarity name coloring | `function rarityTextClass` |
| Item picker preview pane (right side of picker modal) | `gp-modal-preview__empty` then read surrounding `updatePreview()` |
| Item finder card CSS | `.gp-item-finder__card` (end of `gear-planner.css`) |
| Diagnostics banner | `function recordPlannerDiagnostic` |

---

## 4. Phase 1 — Obtainability depth

No new data files. Three sub-features, one commit.

### 4.1 Crafting recipes with materials

1. **Extend craft hydration.** Where `craftRecipeByItemId[iid] = { job, level }` is set, also keep
   `input` (array of `{ count, item }`), `cost`, and `slots` when present and well-formed
   (validate: `Array.isArray(input)`, each entry has string `item` and finite positive `count`).
2. **Build a reverse index** right after hydration: `craftUsesByMaterialItemId`:
   `{ "<materialItemId>": [{ craftedItemId, count }] }`.
3. **Surface in `itemObtainLines(item)`:**
   - Existing `Craft` line stays ("Level 1 Blacksmith craft"). Append materials:
     `Level 1 Blacksmith craft — 8× Copper Ingot, 15× Fin, 1× Fragment of Water · 75 gold`.
     Resolve material names via `itemById[id]` + `itemDisplayName(...)`; fall back to the raw id.
   - New `Material` line when `craftUsesByMaterialItemId[item.id]` is non-empty:
     `Used to craft: Manfish Waistguard, Manfish Legguards` (dedupe, cap at 6 names + "+N more").
4. **Item picker preview pane:** the craft subtitle shown there should get the same materials suffix.
   Do it inside `itemCraftRecipeSubtitle` so every call site benefits, but keep it short there
   (materials only, no "Used to craft") — the preview pane is narrow.

### 4.2 Drop percentages

1. **New module-level index** `itemDropChancesByItemId` built in a new function
   `hydrateItemDropChancesFromLootTables(lootPayload)` called right next to the existing
   `hydrateItemBossDropIndexFromLootTables(lootPayload)` call in `main()`.
2. **Algorithm:** for every unit in `lootPayload.units` with a `lootTableId`, walk its table:
   - `walk(tableId, multiplier, depth)`: for each entry `e` in `lootTables[tableId].entries`:
     - if `e.item`: accumulate `chance[e.item][unitId] += multiplier * e.proba` (cap each at 1)
     - if `e.lootTable`: recurse with `multiplier * e.proba`, `depth + 1`; **stop at depth 4**; guard
       against cycles with a visited-set per unit.
   - Store per item, per unit: `{ unitId, chance }`. Ignore `conds` (semantics unknown) — chances are
     labeled approximate in the UI.
3. **Aggregate for display:** helper `itemDropChanceLines(item)` returns up to 4 best sources:
   resolve unit display names the same way the foe picker does (grep `foeUnitById` and the
   `dungeonBossByUnitId` label lookup; prefer boss/dungeon labels when the unit is a dungeon boss,
   else the unit id → name from `foe_defenses.json` if present, else skip the unit). Format:
   `~35% from Nepsid Fighter · ~4% from Manfish bosses` (round to whole %, `<1%` for tiny).
4. **Surface:**
   - `itemObtainLines`: new `Drops` line with those chances (only when we have any).
   - Find items cards get it automatically via `itemObtainLines`.
5. **Do not** change the existing `itemDungeonBossDropSubtitle` behavior (picker rows stay compact).

### 4.3 Find items polish that this enables

- In `renderItemFinderPanel`, the search matcher already checks `itemObtainLines` text, so recipes and
  drop lines become searchable for free — verify "copper" now finds items crafted from Copper Ingot.
- Add a `Craftable` option to the type-group dropdown (`ITEM_FINDER_TYPE_GROUPS`): matches items with
  a craft recipe.

### 4.4 Gatherables (best-effort, timebox ~30 min)

The cdb has `gatherable` sheets. If you can find a link from gatherable nodes to dropped items
(inspect `element@props@lootItems` and `types@props@gains@lootTables` sheets), add a `Gathered` line
("Mined from Ore nodes — requires Pickaxe"). If the linkage is unclear, **skip silently** — do not
guess.

### 4.5 Phase 1 tests + gate

- Add to `tests/planner-core-regressions.mjs` (the test API object is `__GEAR_PLANNER_TEST__`; extend
  it with whatever accessors you need, following how `previewRowsForSnapshot` is exposed):
  - after `hydratePlannerFromCdb`, assert `Waist_RManfish_Fig`'s recipe has 3 inputs including
    `{ count: 8, item: "CopperIngot" }`.
  - after hydrating loot data (see `hydrateFoeDefensesForTest` pattern — add an equivalent
    for loot tables if not present), assert `Fin_Z1` has a drop chance > 0.2 from some Manfish unit.
- Gate: `npm test` green; local Playwright pass showing (a) a craftable item's card with materials +
  "Used to craft", (b) a loot item's card with `~%` drops, (c) search "copper ingot" returns its
  consumers. Screenshot desktop + mobile.

---

## 5. Phase 2 — 3D model viewer

### 5.1 Build tool: `tools/build-model-index.mjs`

New Node script (mirror the header-comment + structure style of `tools/build-item-sources.mjs`):

1. **Inputs:** the cdb (loaded via the same `vm` bootstrap the other tools use, or plain
   `JSON.parse` — plain parse is simpler and fine here), and a farever clone path from
   `process.env.FAREVER_REPO || "/workspace/farever"` (document this; error out with a clear message
   and the clone command if the path is missing).
2. **For every item row**, resolve a prefab path: `visuals.modelPath` first, else
   `visuals.models[0].prefab`. Skip items with neither.
3. **Resolve prefab → GLB** under `<farever>/public/model-library/`:
   - exact swap `.prefab` → `.glb`;
   - else try basename without trailing `_0<digit>` and with `_01`/`_02` appended (both directions,
     same directory);
   - else case-insensitive match within the same directory;
   - else unresolved (collect for the report).
4. **Copy** each resolved GLB into `game-data/models/` **preserving its relative path** (e.g.
   `game-data/models/Character/Hero/Outfit/Faction/Manfish/Rare/Shoulders_Outer_RManfish_Medium.glb`).
   Deduplicate (many items share a model). Use streaming copy, create dirs recursively.
5. **Emit `game-data/models/model_index.json`:**
   ```json
   { "version": 1, "generatedBy": "tools/build-model-index.mjs",
     "byItemId": { "<itemId>": "Character/Hero/Outfit/.../file.glb" },
     "unresolved": ["<itemId>", ...] }
   ```
   Paths are relative to `game-data/models/`.
6. **Print a report**: resolved/unresolved counts, total copied bytes. **Abort without copying if the
   subset exceeds 200 MB** (invariant 7).
7. Add `"build:model-index": "node tools/build-model-index.mjs"` to `package.json` scripts, run it,
   and **commit the copied GLBs + index**. Expect ~500 items resolved, ~80–130 MB.

### 5.2 Vendor three.js (pinned 0.160.0)

Create `assets/vendor/three/` with exactly these four files, downloaded via curl (the sandbox proxy
allows curl to external hosts):

```
https://unpkg.com/three@0.160.0/build/three.module.js            -> assets/vendor/three/three.module.js
https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js -> assets/vendor/three/OrbitControls.js
https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js     -> assets/vendor/three/GLTFLoader.js
https://unpkg.com/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js -> assets/vendor/three/BufferGeometryUtils.js
```

- `OrbitControls.js` and `GLTFLoader.js` import from the bare specifier `three`; `GLTFLoader.js` also
  imports `../utils/BufferGeometryUtils.js` — **fix that relative import** to `./BufferGeometryUtils.js`
  after download (one sed), and verify no other relative imports remain (`grep "from '\.\." assets/vendor/three/*.js`).
- Add an **import map to `index.html`** *before* the module script:
  ```html
  <script type="importmap">{"imports":{"three":"./assets/vendor/three/three.module.js"}}</script>
  ```
  (Relative `./` specifier keeps GitHub Pages sub-path deployments working.)

### 5.3 Viewer module: `planner-3d-viewer.js`

New top-level file, loaded from `index.html` with `<script type="module" src="planner-3d-viewer.js" defer></script>` **after** the import map. It must not import three at load time — keep startup cost zero:

```js
// Registers window.FareverPlanner3D = { open({ glbUrl, title }) , canRender() }
// - canRender(): feature-detects WebGL; used to hide buttons on unsupported devices.
// - open(): builds the modal on first use, then lazy-imports three:
//     const THREE = await import("three");
//     const { OrbitControls } = await import("./assets/vendor/three/OrbitControls.js");
//     const { GLTFLoader }   = await import("./assets/vendor/three/GLTFLoader.js");
```

Modal + scene requirements:

- Overlay reusing the planner's modal look: darken backdrop, panel with title + close button.
  Class names `gp-3d-overlay`, `gp-3d-panel`, `gp-3d-canvas-wrap`, `gp-3d-status`; style them in
  `gear-planner.css` with the design tokens (dark panel, `--gp-border`, radius 12px). ESC, close
  button, and backdrop click all close. Return focus to the invoking button on close.
- Scene: `new THREE.Scene()`, background `null` over a panel-colored canvas; lights:
  hemisphere (sky `0xbfd4ff`, ground `0x2a2f3a`, intensity ~1.1) + directional (intensity ~1.6 at
  (2.5, 4, 2)). `renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })`,
  `renderer.outputColorSpace = THREE.SRGBColorSpace`, pixel ratio capped at 2.
- After `GLTFLoader.load`: compute the model's `Box3`, recenter it on origin, position the camera at
  ~1.8× the bounding-sphere radius, `controls.target` at the box center. This auto-frames any model
  regardless of scale.
- `OrbitControls` with damping; auto-rotate ON by default (`controls.autoRotate = true`, speed ~1.6)
  but **respect `prefers-reduced-motion: reduce`** (start it off). Add a small auto-rotate checkbox
  in the panel footer.
- Loading state ("Loading model…") and error state ("Could not load this model.") in `gp-3d-status`.
- **Cleanup on close:** stop the RAF loop, `renderer.dispose()`, dispose geometries/materials/textures
  (traverse the scene), remove the canvas. Re-opening creates a fresh renderer — simplest reliable way
  to avoid GPU memory leaks. Cache the last parsed GLTF per URL is NOT needed; models are ~200 KB.
- Fetch the GLB with a **relative URL** (`game-data/models/<path>` — resolves correctly under sub-path
  deploys because the page URL is the base).

### 5.4 Planner-side integration (inside `gear-planner.js`)

1. **Load the index:** add `MODEL_INDEX_URL` constant (`game-data/models/model_index.json`), add it to
   `RUNTIME_FETCH_URLS` and `planner-static-config.js` `runtimeUrls` (key `modelIndex`), fetch it in
   `main()` exactly like `itemSourcesPromise` (parallel + non-fatal), store `itemModelPathByItemId`.
2. **Helper:** `itemModelViewerUrl(item)` → `"game-data/models/" + path` or `null`; return `null`
   when the 3D module is missing (`!window.FareverPlanner3D`), `canRender()` is false, or the index
   lacks the id.
3. **Buttons** (render only when `itemModelViewerUrl(item)` is truthy), label `View in 3D`,
   class `gp-3d-open-btn`, `type="button"`:
   - **Find items cards:** in `renderItemFinderPanel`'s card head, after the title block.
   - **Item picker preview pane:** in the preview markup built by `updatePreview()` (the pane that
     shows the selected item's stats), near the item name.
   Click → `window.FareverPlanner3D.open({ glbUrl, title: itemDisplayName(it) })`.
4. Style `gp-3d-open-btn` as a small ghost button (border `--gp-border-strong`, accent on hover).

### 5.5 Hosting config

Append to `vercel.json` headers:

```json
{ "source": "/game-data/models/(.*)\\.glb",
  "headers": [
    { "key": "Content-Type", "value": "model/gltf-binary" },
    { "key": "Cache-Control", "value": "public, max-age=86400, stale-while-revalidate=604800" } ] },
{ "source": "/(assets/vendor/.*|planner-3d-viewer\\.js)",
  "headers": [ { "key": "Cache-Control", "value": "public, max-age=86400, stale-while-revalidate=604800" } ] }
```

(GitHub Pages ignores this file; it serves `.glb` fine by extension.)

### 5.6 Phase 2 tests + gate

- `npm test` still green (the new fetch constant is auto-covered by the URL-policy assertion; the
  3D module is never loaded in Node).
- Add one regression: expose the model index size via the test API after a manual hydrate call and
  assert `> 300` entries — this catches an accidentally empty/missing committed index.
- Playwright gate against `http://localhost:8765/`:
  1. Equipment → open Helmet picker → select an item with a model → preview pane shows **View in 3D**.
  2. Click it → modal opens → wait ~2 s → screenshot shows a rendered model (canvas non-blank: read
     pixels via `page.evaluate` on the canvas and assert not all zero, or eyeball the screenshot).
  3. ESC closes; no console errors throughout.
  4. Find items → search "shoulder" → a card shows the button; open one; screenshot.
  5. Mobile 390×844: modal fits, close works.
- Manual sanity list: one helmet, one shoulder, one chest, `Staff_Craft` (weapon path), one item
  with no model (button absent).

---

## 6. Out of scope (do not build now)

- Character "dressing room" (composing equipped items onto the hero body — the GLBs are rigged for
  it, but it's a separate project).
- The interactive world map / waypoints.
- Any use of the farever repo's Astro site code beyond reading `public/model-library/`.

---

## 7. Final checklist before opening the PR

- [ ] `npm test` green; `npm run audit:data` output unchanged in character.
- [ ] `npm run build:item-sources` and `npm run build:model-index` both idempotent (second run = no diff).
- [ ] Playwright sweep: all 7 tabs render, picker + finder + 3D modal, desktop + mobile, zero console errors.
- [ ] Slow-network check (Playwright CDP throttling): startup progress bar still reaches 100%; the model
      index fetch doesn't block interactivity.
- [ ] No absolute URLs introduced (`npm test` covers it — but also grep new code for `https://`).
- [ ] README: add a "3D viewer" bullet under Runtime Files + document both build scripts.
- [ ] PR description: what/why, data provenance (models exported from the game via navis-dgtl/farever),
      byte sizes added, screenshots.

## 8. Known pitfalls

- **The vm test harness has no `document`/`window`.** Never touch them at IIFE top level; follow the
  existing mount-guard pattern at the bottom of `gear-planner.js`.
- `gear-planner.js` is a single IIFE — new planner functions go inside it. The 3D viewer is the one
  exception (separate ES module, communicates via `window.FareverPlanner3D`).
- The startup loader uses `fetchJsonWithProgress` + `createLoadingProgress`; copy the
  `itemSourcesPromise` pattern verbatim for the model index (including the `.catch(() => {})` side
  handler that prevents unhandled rejections on early fatal returns).
- Item icons: always reuse `mountLootIcon(el, it.gfx, "")` — never construct icon URLs by hand.
- Some cdb items share one model (`byItemId` values collide) — that's expected; don't dedupe ids.
- A handful of items have display names only in `texts.desc` (data quirk) and are hidden from pickers
  via `itemHasDisplayName` — keep using that filter in any new item listing.
- GLB textures are embedded; if a specific model renders gray, check the wiki's
  `viewer-tree-multiprefab-v14.js` DDS handling before assuming the model is broken.
- The farever clone is ~950 MB — clone shallow, once, and never inside the planner repo directory.
- Playwright: do not run `playwright install` (browsers are preinstalled at `/opt/pw-browsers`);
  external sites are proxy-blocked for the browser — verify against localhost only.
