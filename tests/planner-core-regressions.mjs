import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

vm.runInThisContext(fs.readFileSync(path.join(rootDir, "planner-static-config.js"), "utf8"), {
  filename: "planner-static-config.js",
});
vm.runInThisContext(fs.readFileSync(path.join(rootDir, "gear-planner.js"), "utf8"), {
  filename: "gear-planner.js",
});

const api = globalThis.__GEAR_PLANNER_TEST__;
assert.equal(typeof api?.hydratePlannerFromCdb, "function", "planner test API must be exposed");

const cdb = JSON.parse(fs.readFileSync(path.join(rootDir, "game-data/extracted/res.light/data.cdb"), "utf8"));
api.hydratePlannerFromCdb(cdb);

const sampleSnapshot = {
  v: 3,
  classId: "Mage",
  charLevel: 18,
  monsterLevel: 17,
  medianMonsterLevel: 16,
  foeUnitId: "median",
  dungeonBossDifficulty: "normal",
  talents: {
    Mage_Talent_Discipline: 2,
  },
  consumables: {
    scrollId: "Scroll_MagicDamage",
    elixirId: null,
    foodId: null,
    potionId: null,
    otherId: null,
  },
  slots: {
    helmet: {
      id: "Head_Z2U2_AssWiz",
      ilvl: 18,
      rarityOverride: null,
      stars: 0,
      enchantId: null,
      augmentId: null,
    },
    mainHand: {
      id: "Staff_Craft",
      ilvl: 18,
      rarityOverride: "Epic",
      stars: 1,
      enchantId: null,
      augmentId: null,
    },
  },
  damagePreview: {
    critMode: "always",
    extraMoreDamageMult: 1.25,
    scriptAssumptionsBySkillId: {
      Mage_Fireball: { targetBurning: true },
    },
    passiveScriptBoostDisabledBySkillId: {},
    passiveScriptGlobalDisabledByPassiveId: {},
    passiveScriptGlobalEnabledByPassiveId: {},
    previewStatusBuffsEnabled: false,
    previewStatusStacksBySkillId: {
      Mage_Burn: 3,
    },
    classSkillMasteryBySkillId: {},
    masteryBuffChoiceBySkillId: {},
    mageConduitSkillIds: [],
    priestPrayerSkillIds: [],
    previewFinisherComboPoints: null,
    previewUrgeFinisherStreak: 0,
    previewSurgeViolenceBoost: false,
  },
};

const compact = api.compactSnapshot(sampleSnapshot);
const expanded = api.expandSnapshot(compact);
assert.equal(expanded.classId, sampleSnapshot.classId);
assert.equal(expanded.charLevel, sampleSnapshot.charLevel);
assert.equal(expanded.damagePreview.critMode, sampleSnapshot.damagePreview.critMode);
assert.equal(expanded.damagePreview.previewStatusBuffsEnabled, false);
assert.equal(expanded.slots.helmet.id, sampleSnapshot.slots.helmet.id);
assert.equal(expanded.slots.mainHand.rarityOverride, "Epic");
assert.equal(expanded.consumables.scrollId, "Scroll_MagicDamage");

const encoded = await api.encodeBuildPayload(sampleSnapshot);
assert.match(encoded, /^f3[abzj]\./, "encoded build payload should use a supported wire prefix");
assert.deepEqual(await api.decodeBuildPayload(encoded), expanded);
assert.equal(await api.decodeBuildPayload("f3j.not-valid-base64"), null);
assert.equal(await api.decodeBuildPayload("#not-a-build"), null);

assert.equal(api.talentPointsBudget(1), 0);
assert.equal(api.talentPointsBudget(9), 0);
assert.equal(api.talentPointsBudget(10), 1);
assert.equal(api.talentPointsBudget(20), 11);

const urlPolicy = api.validateRuntimeUrlPolicy();
assert.equal(urlPolicy.ok, true, `runtime URLs must be relative and GitHub Pages-safe: ${urlPolicy.invalid.join(", ")}`);
assert.equal(api.githubPagesSafeRelativeUrl("game-data/loot_tables.json"), true);
assert.equal(api.githubPagesSafeRelativeUrl("/game-data/loot_tables.json"), false);
assert.equal(api.githubPagesSafeRelativeUrl("https://example.com/data.cdb"), false);
assert.equal(api.githubPagesSafeRelativeUrl("../game-data/data.cdb"), false);

const foePayload = JSON.parse(fs.readFileSync(path.join(rootDir, "game-data/foe_defenses.json"), "utf8"));
assert.deepEqual(api.validateFoeDefensesPayload(foePayload), []);
assert.ok(api.validateFoeDefensesPayload({ units: [{ id: "A" }, { id: "A" }] }).some((msg) => msg.includes("duplicate")));
api.hydrateFoeDefensesForTest(foePayload);

const pyroclasmCoyoteSnapshot = {
  c: 2,
  ml: 14,
  f: "Wolf_Z2W",
  t: [
    ["Mage_Talent_Chaincast", 1],
    ["Mage_Talent_ConduitResidues", 1],
    ["Mage_Talent_Discipline", 1],
    ["Mage_Talent_Reverberate", 1],
    ["Mage_Talent_ConcentratedPower", 2],
    ["Mage_Talent_InfiniteResources", 1],
    ["Mage_Talent_FerventWizard", 2],
    ["Mage_Talent_FlowingVitality", 2],
  ],
  s: [
    [0, "Head_RBee_FigWiz", 20],
    [1, "Necklace_Z2_Fer", 17],
    [2, "Shoulders_RManfish_WizCle", 20],
    [3, "Chest_RCrimson_Wiz", 10, null, 0, null, "MysticCopperPlate"],
    [4, "Back_RManfish_WizCle", 20, null, 0, null, "RunedEmbroidery"],
    [5, "Finger_Z2_Cri", 20],
    [6, "Hands_RManfish_Wiz", 20, null, 0, "FormulaHandsVitality_Z2", null],
    [7, "Waist_RBee_FigWiz", 15],
    [8, "Legs_RKobold_Wiz", 20],
    [9, "Feet_RManfish_Wiz", 20],
    [10, "Trinket_Manfish", 8],
    [11, "Finger_Z2_Cri", 20],
    [12, "Staff_Craft", 18, "Epic", 0, null, null],
    [14, "DS_Z1RBee_AssWiz", 20, "Epic", 0, null, null, "DS_Bladeleaf_Skill2", "DS_Bladeleaf_Passive"],
  ],
  d: { cm: "never", pe: { Staff_Craft_S1: true } },
};

// With default Buffs-tab assumptions, Scorching Embers stacks (max by default) add 1.4x to
// magic weapon-skill damage on staff builds.
const pyroclasmWithEmbersDefault = api.expandSnapshot(pyroclasmCoyoteSnapshot);
assert.equal(api.previewRowsForSnapshot("Staff_Craft_S1", pyroclasmWithEmbersDefault)[0].finalExpectedSum, 196);

// Armor scaling across foes and monster levels, with Scorching Embers stacks zeroed out.
const pyroclasmCoyoteBuild = api.expandSnapshot({
  ...pyroclasmCoyoteSnapshot,
  d: { cm: "never", pe: { Staff_Craft_S1: true }, st: { Staff_Craft_C_Status: 0 } },
});
assert.equal(api.previewRowsForSnapshot("Staff_Craft_S1", pyroclasmCoyoteBuild)[0].finalExpectedSum, 140);
pyroclasmCoyoteBuild.foeUnitId = "Wolf_Z2W_2";
pyroclasmCoyoteBuild.monsterLevel = 17;
assert.equal(api.previewRowsForSnapshot("Staff_Craft_S1", pyroclasmCoyoteBuild)[0].finalExpectedSum, 136);
pyroclasmCoyoteBuild.monsterLevel = 18;
assert.equal(api.previewRowsForSnapshot("Staff_Craft_S1", pyroclasmCoyoteBuild)[0].finalExpectedSum, 135);
pyroclasmCoyoteBuild.foeUnitId = "FaerieBee_Z2W_GreatMace";
pyroclasmCoyoteBuild.monsterLevel = 20;
assert.equal(api.previewRowsForSnapshot("Staff_Craft_S1", pyroclasmCoyoteBuild)[0].finalExpectedSum, 127);

const lootPayload = JSON.parse(fs.readFileSync(path.join(rootDir, "game-data/loot_tables.json"), "utf8"));
assert.deepEqual(api.validateLootTablesPayload(lootPayload), []);

// ---------------------------------------------------------------------------
// Obtainability depth — craft materials (from the CDB `craft` sheet)
// ---------------------------------------------------------------------------
const waistRecipe = api.craftRecipeForItemId("Waist_RManfish_Fig");
assert.ok(waistRecipe, "Waist_RManfish_Fig should have a craft recipe");
assert.equal(waistRecipe.job, "Blacksmith");
assert.ok(Array.isArray(waistRecipe.input) && waistRecipe.input.length === 3, "recipe should keep 3 material inputs");
assert.ok(
  waistRecipe.input.some((m) => m.item === "CopperIngot" && m.count === 8),
  "recipe inputs should include 8× CopperIngot"
);
assert.equal(waistRecipe.cost, 75, "recipe should keep its gold cost");

// Reverse "used to craft" index: CopperIngot feeds the Manfish waistguard recipe.
const copperUses = api.craftUsesForMaterialId("CopperIngot");
assert.ok(
  Array.isArray(copperUses) && copperUses.some((u) => u.craftedItemId === "Waist_RManfish_Fig"),
  "CopperIngot should be listed as a material for Waist_RManfish_Fig"
);

// Obtain lines surface the resolved material names (not raw ids) and the gold cost.
const waistLines = api.itemObtainLinesForItemId("Waist_RManfish_Fig");
const craftLine = waistLines.find((l) => l.label === "Craft");
assert.ok(craftLine, "craftable item should get a Craft obtain line");
assert.match(craftLine.text, /Copper Ingot/, "Craft line should resolve CopperIngot → Copper Ingot");
assert.match(craftLine.text, /75 gold/, "Craft line should include the gold cost");

// ---------------------------------------------------------------------------
// Obtainability depth — drop chances (walked from loot_tables.json)
// ---------------------------------------------------------------------------
api.hydrateItemDropChancesForTest(lootPayload);
const finDrops = api.itemDropChancesForItemId("Fin_Z1");
assert.ok(Array.isArray(finDrops) && finDrops.length, "Fin_Z1 should have drop sources");
const bestManfishFinDrop = finDrops.find((d) => /Manfish/i.test(d.unitId));
assert.ok(bestManfishFinDrop, "Fin_Z1 should drop from a Manfish unit");
assert.ok(
  bestManfishFinDrop.chance > 0.2,
  `Fin_Z1 Manfish drop chance should exceed 0.2 (got ${bestManfishFinDrop.chance})`
);
