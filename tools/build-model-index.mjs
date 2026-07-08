/**
 * Builds `game-data/models/` — the referenced subset of in-game GLB models — plus
 * `game-data/models/model_index.json`, a compact item-id → model-path index consumed by the
 * runtime "View in 3D" viewer (`planner-3d-viewer.js`).
 *
 * Models are exported from the game and live in the sibling repo `navis-dgtl/farever` under
 * `public/model-library/`. This tool resolves each planner item's cdb prefab path to a GLB in
 * that library, copies only the referenced files (deduped) into this repo preserving their
 * relative paths, and records unresolved ids for auditing.
 *
 * Requires a local clone of `navis-dgtl/farever` (~950 MB). Point at it with FAREVER_REPO;
 * defaults to /workspace/farever.
 *
 *   git clone --depth 1 https://github.com/navis-dgtl/farever /workspace/farever
 *   FAREVER_REPO=/workspace/farever node tools/build-model-index.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fareverRepo = process.env.FAREVER_REPO || "/workspace/farever";
const libRoot = path.join(fareverRepo, "public", "model-library");
const cdbPath = path.join(rootDir, "game-data/extracted/res.light/data.cdb");
const modelsDir = path.join(rootDir, "game-data/models");
const indexPath = path.join(modelsDir, "model_index.json");
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

if (!fs.existsSync(libRoot)) {
  console.error(
    `Model library not found at ${libRoot}\n` +
      `Set FAREVER_REPO to a clone of navis-dgtl/farever, e.g.\n` +
      `  git clone --depth 1 https://github.com/navis-dgtl/farever /workspace/farever\n` +
      `  FAREVER_REPO=/workspace/farever node tools/build-model-index.mjs`
  );
  process.exit(1);
}

const cdb = JSON.parse(fs.readFileSync(cdbPath, "utf8"));
const itemSheet = (cdb.sheets || []).find((s) => s.name === "item");
if (!itemSheet || !Array.isArray(itemSheet.lines)) {
  console.error("Could not read the `item` sheet from the cdb.");
  process.exit(1);
}

/** cdb prefab path for an item row — armor uses `visuals.modelPath`, weapons `visuals.models[0].prefab`. */
function prefabPathForItem(row) {
  const v = row && row.visuals;
  if (!v || typeof v !== "object") return "";
  if (typeof v.modelPath === "string" && v.modelPath.trim()) return v.modelPath.trim();
  if (Array.isArray(v.models) && v.models[0] && typeof v.models[0].prefab === "string") {
    const p = v.models[0].prefab.trim();
    if (p) return p;
  }
  return "";
}

/** Directory listings cached per resolve() call sweep — avoids re-reading dirs for shared prefabs. */
const dirCache = new Map();
function listDir(absDir) {
  if (dirCache.has(absDir)) return dirCache.get(absDir);
  let files = [];
  try {
    if (fs.statSync(absDir).isDirectory()) files = fs.readdirSync(absDir);
  } catch {
    files = [];
  }
  dirCache.set(absDir, files);
  return files;
}

/**
 * Resolve a cdb prefab path to a GLB **relative to the model library**, or `null`.
 * Tries: exact `.prefab`→`.glb`, a `_0<digit>`-suffix-stripped basename, `_01`/`_02` appended
 * (both directions), then a case-insensitive match of any of those within the same directory.
 */
function resolveGlbRelativePath(prefabRel) {
  const rel = String(prefabRel || "").replace(/\\/g, "/");
  if (!rel.toLowerCase().endsWith(".prefab")) return null;
  const dir = path.dirname(rel);
  const baseNoExt = path.basename(rel, path.extname(rel));
  const stripped = baseNoExt.replace(/_0\d$/, "");
  const candidates = [];
  const add = (name) => {
    if (!candidates.includes(name)) candidates.push(name);
  };
  add(`${baseNoExt}.glb`); // exact swap
  if (stripped !== baseNoExt) add(`${stripped}.glb`); // drop trailing _0N
  if (!/_0\d$/.test(baseNoExt)) {
    add(`${baseNoExt}_01.glb`); // append _01 / _02
    add(`${baseNoExt}_02.glb`);
  }
  if (stripped !== baseNoExt) {
    add(`${stripped}_01.glb`); // re-number a suffixed base
    add(`${stripped}_02.glb`);
  }
  const absDir = path.join(libRoot, dir);
  for (let i = 0; i < candidates.length; i++) {
    if (fs.existsSync(path.join(absDir, candidates[i]))) {
      return path.posix.join(dir, candidates[i]);
    }
  }
  // Case-insensitive fallback within the same directory.
  const wanted = candidates.map((c) => c.toLowerCase());
  for (const f of listDir(absDir)) {
    if (wanted.includes(f.toLowerCase())) return path.posix.join(dir, f);
  }
  return null;
}

const byItemId = {};
const unresolved = [];
const uniqueGlbs = new Set();
let itemsWithPrefab = 0;

for (const row of itemSheet.lines) {
  if (!row || typeof row.id !== "string" || !row.id) continue;
  const prefab = prefabPathForItem(row);
  if (!prefab) continue;
  itemsWithPrefab++;
  const glbRel = resolveGlbRelativePath(prefab);
  if (!glbRel) {
    unresolved.push(row.id);
    continue;
  }
  byItemId[row.id] = glbRel;
  uniqueGlbs.add(glbRel);
}

// Size guard (invariant: never add more than 200 MB of model files).
let totalBytes = 0;
for (const glbRel of uniqueGlbs) {
  totalBytes += fs.statSync(path.join(libRoot, glbRel)).size;
}
const mb = (n) => (n / (1024 * 1024)).toFixed(1);
if (totalBytes > MAX_TOTAL_BYTES) {
  console.error(
    `Referenced model subset is ${mb(totalBytes)} MB across ${uniqueGlbs.size} files — ` +
      `over the ${mb(MAX_TOTAL_BYTES)} MB limit. Aborting without copying.`
  );
  process.exit(1);
}

// Fresh output dir keeps re-runs byte-identical (idempotent — no stale files linger).
fs.rmSync(modelsDir, { recursive: true, force: true });
fs.mkdirSync(modelsDir, { recursive: true });
for (const glbRel of uniqueGlbs) {
  const dest = path.join(modelsDir, glbRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(libRoot, glbRel), dest);
}

const sortedById = {};
for (const id of Object.keys(byItemId).sort()) sortedById[id] = byItemId[id];
const out = {
  version: 1,
  generatedBy: "tools/build-model-index.mjs",
  itemCount: Object.keys(sortedById).length,
  modelFileCount: uniqueGlbs.size,
  byItemId: sortedById,
  unresolved: unresolved.sort(),
};
fs.writeFileSync(indexPath, JSON.stringify(out, null, 1) + "\n");

console.log(
  `model_index.json: ${out.itemCount} items resolved → ${uniqueGlbs.size} unique GLBs ` +
    `(${mb(totalBytes)} MB); ${unresolved.length} of ${itemsWithPrefab} items with a prefab unresolved.`
);
