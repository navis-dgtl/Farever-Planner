# Farever Planner

Standalone static website for the Farever gear planner.

## Run Locally

```sh
npm run dev
```

The planner must be served over HTTP because it loads JSON and CDB data with `fetch`.

## Test And Audit

```sh
npm test
npm run audit:data
```

`npm test` runs item-stat parity checks plus core planner regressions for portable build payloads, snapshot compaction, talent budgets, and GitHub Pages-safe runtime URLs.

`npm run audit:data` checks deployable generated data files and reports `TODO_*` identifiers that may surface as internal fallback labels.

## Deploy To GitHub Pages

Publish this folder as its own GitHub repository, then enable GitHub Pages from the repository settings. Use the repository root as the Pages source.

The site entry point is `index.html`, so no build step is required.

## Deploy To Vercel

The repository also deploys as-is to Vercel (no build step, output = repository root). `vercel.json` adds Vercel-specific response headers:

- `Content-Type: application/json` for `data.cdb` so the edge compresses it (as `application/octet-stream` it would ship uncompressed, ~4 MB instead of ~700 KB).
- `Cache-Control: public, max-age=600` for game data, mirroring GitHub Pages' cache window.
- Longer caching for icons and static image assets.

GitHub Pages ignores `vercel.json`, so the file is safe to keep for both hosts.

Keep the planner compatible with GitHub Pages constraints:

- Use relative asset and `fetch` URLs so both `https://owner.github.io/` and `https://owner.github.io/repo/` deployments work.
- Do not rely on server rewrites, a backend, custom MIME configuration, or custom response headers.
- Do not rely on `serve.json` for production behavior; it is local tooling only.
- For cache-sensitive generated data, prefer filename/version changes or a documented query-string bump because GitHub Pages does not provide project-level cache header controls.
- Keep `.nojekyll` so underscored or generated asset paths are served as static files.

Before publishing:

1. Run `npm test`.
2. Run `npm run audit:data` and review any `TODO_*` output.
3. Serve locally over HTTP and confirm the planner loads all runtime data.
4. Publish to GitHub Pages and verify the live URL loads `data.cdb`, foe defenses, dungeon regions, loot tables, icons, and shared `#b=` links.
5. Test copied build links in at least two browsers.
6. Verify saved builds survive reload in the same browser.
7. Keyboard-test the class picker, item picker, settings, save/discard dialogs, and foe picker with Tab, Shift+Tab, Escape, Enter, and Space.

## Static-Site Hardening

GitHub Pages cannot enforce project-specific response headers. Use static HTML policies where practical and document anything that requires hosting outside GitHub Pages.

- `index.html` sets a conservative referrer policy with a meta tag.
- External links should keep `rel="noopener noreferrer"`.
- A full Content Security Policy is better enforced with response headers; if a meta CSP is added later, test it against inline SVG, local scripts, and generated image assets before publishing.
- The planner stores saved builds only in the visitor's browser `localStorage`; there is no server-side account or build storage.

## Runtime Files

- `planner-static-config.js` contains GitHub Pages-safe runtime URL and asset prefix configuration.
- `gear-planner.js` and `gear-planner.css` contain the planner UI and behavior.
- `game-data/extracted/res.light/data.cdb` is the main game data source.
- `game-data/foe_defenses.json`, `game-data/dungeon_regions.json`, and `game-data/loot_tables.json` power combat previews and boss drop hints.
- `game-data/wiki/item_sources.json` powers the **Find items** tab and the "where to get it" hints in the item picker. Regenerate it with `npm run build:item-sources` after updating the wiki exports.
- `game-data/wiki/` also holds the raw community wiki exports (`farever_wiki_drops.json`, `farever_data.json`, unit names, talents, bestiary, maps, and item card art under `cards/`). Only `item_sources.json` is fetched at runtime.
- `game-data/generated/cdb_pngs/` contains generated item, skill, unit, and UI icons.
- `game-data/extracted/res/UI/` contains the few original UI atlas images still referenced directly.

Keep reverse-engineering tools, raw extraction folders, and large intermediate files outside this deployable project unless the runtime starts fetching them directly.

## Saves And Sharing

Saved builds are stored in the user's browser with `localStorage`.

The current build is also encoded into the URL hash as a compact portable payload (`#b=f3...`), so copied planner URLs can be opened by another browser or user without a backend.
