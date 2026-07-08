/**
 * Static runtime configuration for the GitHub Pages deployment.
 *
 * Keep URLs relative so the planner works both at a domain root and under a
 * project path such as https://owner.github.io/repo/.
 */
(function () {
  globalThis.FareverPlannerStaticConfig = Object.freeze({
    runtimeUrls: Object.freeze({
      cdb: "game-data/extracted/res.light/data.cdb",
      foeDefenses: "game-data/foe_defenses.json",
      dungeonRegions: "game-data/dungeon_regions.json",
      lootTables: "game-data/loot_tables.json",
      itemSources: "game-data/wiki/item_sources.json",
    }),
    assetPrefixes: Object.freeze([
      "game-data/extracted/res/",
      "game-data/extracted/res.light/",
      "game-data/generated/cdb_pngs/files/",
      "game-data/generated/cdb_pngs/slices/",
    ]),
  });
})();
