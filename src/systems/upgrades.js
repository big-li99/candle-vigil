// The ten upgrade cards of DESIGN §2.9 / the M2b brief. Every card writes into one flat `mods` object, and the
// player, the poison zone, the block and the field read that object — so a card that is picked is a number that
// changes, not a cosmetic flag. A card may be drawn again in a later intermission; picking it twice stacks to
// MAX_STACK and after that the card drops out of the pool, so nothing grows without a ceiling.

export const MAX_STACK = 2;

export const UPGRADES = [
  { id: "focus", name: "FOCUS", desc: "ALL SPELLS -20% COOLDOWN" },
  { id: "flow", name: "MANA FLOW", desc: "+4 MANA PER SECOND" },
  { id: "edge", name: "SHARP EDGE", desc: "SWORD SLASH +30% DAMAGE" },
  { id: "quake", name: "EARTH WRATH", desc: "HAMMER X2 KNOCK + 1S STUN" },
  { id: "winter", name: "WINTER", desc: "SLOW LASTS +2 SECONDS" },
  { id: "storm", name: "STORM", desc: "LIGHTNING COOLDOWN -2S" },
  { id: "bone", name: "BONE EATER", desc: "POISON +40% AREA, +2S" },
  { id: "sacred", name: "SACRED FIRE", desc: "HEAL +50%, +5 MANA" },
  { id: "charm", name: "EMBER CHARM", desc: "CANDLE CAP +25, REFILL" },
  { id: "swift", name: "SWIFT", desc: "BLOCK +0.15S, +8 MANA" },
];

/** The flat, effective numbers every system reads. `mods` is exactly what snapshot() reports. */
export function baseMods() {
  return {
    cdMult: 1, // focus
    manaRegen: 0, // flow, bonus per second on top of the base regen
    slashMult: 1, // edge
    hammerKnockMult: 1, // quake
    hammerStun: 0, // quake, seconds added to the hit
    slowBonus: 0, // winter, seconds added to frost nova's slow
    boltCdCut: 0, // storm, seconds off lightning's cooldown
    poisonRadiusMult: 1, // bone
    poisonDurBonus: 0, // bone, seconds added to the cloud
    healMult: 1, // sacred
    healMana: 0, // sacred, mana returned by the heal
    candleCapBonus: 0, // charm
    blockWindowBonus: 0, // swift, seconds added to the block window
    blockMana: 0, // swift, mana returned by a successful block
  };
}

const byId = new Map(UPGRADES.map((u) => [u.id, u]));

export function upgradeById(id) {
  return byId.get(id) ?? null;
}

/**
 * The card pool and its live modifiers. `onApply(id, stacks, mods)` runs after the numbers are recomputed, so
 * the field can apply side effects that are not plain numbers (charm raising the candle cap and refilling it).
 */
export function createUpgrades({ onApply = null } = {}) {
  const stacks = Object.fromEntries(UPGRADES.map((u) => [u.id, 0]));
  const mods = baseMods();

  function recompute() {
    const n = (id) => stacks[id] ?? 0;
    mods.cdMult = Math.pow(0.8, n("focus"));
    mods.manaRegen = 4 * n("flow");
    mods.slashMult = 1 + 0.3 * n("edge");
    mods.hammerKnockMult = Math.pow(2, n("quake"));
    mods.hammerStun = 1 * n("quake");
    mods.slowBonus = 2 * n("winter");
    mods.boltCdCut = 2 * n("storm");
    mods.poisonRadiusMult = Math.pow(1.4, n("bone"));
    mods.poisonDurBonus = 2 * n("bone");
    mods.healMult = 1 + 0.5 * n("sacred");
    mods.healMana = 5 * n("sacred");
    mods.candleCapBonus = 25 * n("charm");
    mods.blockWindowBonus = 0.15 * n("swift");
    mods.blockMana = 8 * n("swift");
  }

  /** Take one card. Refused when it is unknown or already at the stack cap. */
  function apply(id) {
    const u = byId.get(id);
    if (!u || stacks[id] >= MAX_STACK) return false;
    stacks[id] += 1;
    recompute();
    onApply?.(id, stacks[id], mods);
    return true;
  }

  /** Drop every stack (a new run): the effective numbers return to baseMods(). */
  function reset() {
    for (const id of Object.keys(stacks)) stacks[id] = 0;
    recompute();
  }

  /** Three distinct card ids; cards still below the cap are preferred, so a full card never wastes a slot. */
  function drawCards(count = 3) {
    const open = UPGRADES.filter((u) => stacks[u.id] < MAX_STACK).map((u) => u.id);
    const pool = open.length >= count ? open : UPGRADES.map((u) => u.id);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, count);
  }

  return {
    stacks,
    mods,
    apply,
    reset,
    drawCards,
    stacksOf: (id) => stacks[id] ?? 0,
  };
}
