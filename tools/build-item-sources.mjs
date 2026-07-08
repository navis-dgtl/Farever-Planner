/**
 * Builds `game-data/wiki/item_sources.json` — a compact "where to get it" index keyed by
 * planner item id — from the community wiki exports in `game-data/wiki/`:
 *
 * - `farever_wiki_drops.json`  → armor drops per dungeon / class / slot / difficulty,
 *   plus world (Crimson faction) drop activities.
 * - `farever_data.json`        → weapon drops per zone / dungeon.
 *
 * Item names in the wiki exports are display names; this tool resolves them against the
 * planner's CDB item names so the runtime needs no fuzzy matching. Unresolved names are
 * kept in the payload under `unresolvedNames` for auditing.
 *
 * Run: node tools/build-item-sources.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

vm.runInThisContext(fs.readFileSync(path.join(rootDir, "planner-static-config.js"), "utf8"), {
  filename: "planner-static-config.js",
});
vm.runInThisContext(fs.readFileSync(path.join(rootDir, "gear-planner.js"), "utf8"), {
  filename: "gear-planner.js",
});
const api = globalThis.__GEAR_PLANNER_TEST__;
api.hydratePlannerFromCdb(
  JSON.parse(fs.readFileSync(path.join(rootDir, "game-data/extracted/res.light/data.cdb"), "utf8"))
);
const itemById = api.itemByIdRef;

const normName = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const idsByName = new Map();
for (const id of Object.keys(itemById)) {
  const it = itemById[id];
  const n = it && it.texts && it.texts.name;
  const raw = typeof n === "string" ? n : n && typeof n === "object" && n.v != null ? String(n.v) : "";
  const key = normName(raw);
  if (!key) continue;
  if (!idsByName.has(key)) idsByName.set(key, []);
  idsByName.get(key).push(id);
}

/** Split a wiki cell that may hold several item names separated by 2+ spaces or newlines. */
function splitNames(cell) {
  const raw = String(cell || "").trim();
  if (!raw || raw === "—" || raw === "-" || raw.toLowerCase() === "x") return [];
  return raw
    .split(/\n|\s{2,}/)
    .map((s) => s.replace(/\s*\([^)]*\)\s*$/, "").trim())
    .filter(Boolean);
}

const sourcesByName = new Map();
function entryFor(name) {
  const key = normName(name);
  if (!sourcesByName.has(key)) {
    sourcesByName.set(key, { display: name.trim(), dungeons: new Map(), world: [], weaponTypes: new Set() });
  }
  return sourcesByName.get(key);
}

// ---------------------------------------------------------------------------
// 1. Armor drops per dungeon / class / slot / difficulty
// ---------------------------------------------------------------------------
const wikiDrops = JSON.parse(
  fs.readFileSync(path.join(rootDir, "game-data/wiki/farever_wiki_drops.json"), "utf8")
);
for (const [dungeonName, byClass] of Object.entries(wikiDrops.dungeon || {})) {
  for (const [cls, rows] of Object.entries(byClass || {})) {
    for (const row of rows || []) {
      for (const diff of ["normal", "hard"]) {
        for (const itemName of splitNames(row[diff])) {
          const e = entryFor(itemName);
          if (!e.dungeons.has(dungeonName)) {
            e.dungeons.set(dungeonName, { difficulties: new Set(), classes: new Set() });
          }
          const d = e.dungeons.get(dungeonName);
          d.difficulties.add(diff);
          d.classes.add(cls);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. World (faction) drops with source activities
// ---------------------------------------------------------------------------
const world = wikiDrops.world || {};
const worldWeaponRows = world.table0 || [];
for (const row of worldWeaponRows) {
  const faction = String(row[""] || "").replace(/\s+/g, " ").trim() || "World";
  const activities = splitNames(row["Source Drop Activities"]);
  for (const weaponName of splitNames(row.Weapons)) {
    entryFor(weaponName).world.push({ faction, activities });
  }
}
const crimsonRows = world.table1 || [];
const crimsonActivities = splitNames((crimsonRows[0] || {})["Source Drop Activities"]);
for (const row of crimsonRows) {
  for (const cls of ["Warrior", "Mage", "Rogue", "Priest"]) {
    for (const itemName of splitNames(row[cls])) {
      const e = entryFor(itemName);
      let w = e.world.find((x) => x.faction === "Crimson faction");
      if (!w) {
        w = { faction: "Crimson faction", activities: crimsonActivities, classes: new Set() };
        e.world.push(w);
      }
      if (w.classes) w.classes.add(cls);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Weapon drops per zone / dungeon (farever_data.json)
// ---------------------------------------------------------------------------
const fareverData = JSON.parse(
  fs.readFileSync(path.join(rootDir, "game-data/wiki/farever_data.json"), "utf8")
);
for (const zone of fareverData.zones || []) {
  const zoneName = (zone.name && zone.name.en) || "";
  for (const dungeon of zone.dungeons || []) {
    const rawDungeon = (dungeon.name && dungeon.name.en) || "";
    const dungeonName = rawDungeon.split("·")[0].replace(/\s+/g, " ").trim();
    const lvMatch = rawDungeon.match(/Lv\s*(\d+)/i);
    for (const loot of dungeon.loot || []) {
      const names = splitNames((loot.name && loot.name.en) || "");
      for (const itemName of names) {
        const e = entryFor(itemName);
        if (!e.dungeons.has(dungeonName)) {
          e.dungeons.set(dungeonName, { difficulties: new Set(), classes: new Set() });
        }
        const d = e.dungeons.get(dungeonName);
        if (lvMatch) d.lv = parseInt(lvMatch[1], 10);
        if (zoneName) d.zone = zoneName;
        for (const c of loot.classes || []) {
          d.classes.add(c.charAt(0).toUpperCase() + c.slice(1));
        }
        for (const t of loot.types || []) e.weaponTypes.add(t);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Resolve names → planner item ids and emit
// ---------------------------------------------------------------------------
const byItemId = {};
const unresolvedNames = [];
let resolved = 0;
for (const [key, e] of sourcesByName) {
  const dungeons = [...e.dungeons.entries()].map(([name, d]) => {
    const difficulties = [...d.difficulties];
    const out = {
      name,
      difficulty: difficulties.length === 2 ? "both" : difficulties[0] || "both",
    };
    if (d.classes.size) out.classes = [...d.classes].sort();
    if (d.lv) out.lv = d.lv;
    if (d.zone) out.zone = d.zone;
    return out;
  });
  const worldOut = e.world.map((w) => ({
    faction: w.faction,
    activities: w.activities || [],
    ...(w.classes && w.classes.size ? { classes: [...w.classes].sort() } : {}),
  }));
  const payload = {};
  if (dungeons.length) payload.dungeons = dungeons;
  if (worldOut.length) payload.world = worldOut;
  if (e.weaponTypes.size) payload.weaponTypes = [...e.weaponTypes].sort();
  if (!Object.keys(payload).length) continue;

  const ids = idsByName.get(key);
  if (!ids) {
    unresolvedNames.push(e.display);
    continue;
  }
  resolved++;
  for (const id of ids) {
    byItemId[id] = payload;
  }
}

const out = {
  version: 1,
  generatedBy: "tools/build-item-sources.mjs",
  itemCount: Object.keys(byItemId).length,
  byItemId,
  unresolvedNames: unresolvedNames.sort(),
};
const outPath = path.join(rootDir, "game-data/wiki/item_sources.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 1) + "\n");
console.log(
  `item_sources.json: ${resolved} wiki names resolved → ${out.itemCount} item ids; ${unresolvedNames.length} unresolved`
);
if (unresolvedNames.length) console.log("unresolved:", unresolvedNames.join(" | "));
