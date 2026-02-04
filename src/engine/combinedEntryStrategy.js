// CombinedEntryStrategy.js
// Deterministická kombinovaná ENTRY strategie dle cheat sheetu AI-MATIC-TREE.
// Implementuje dopady při chybějících modulech a vrací rozhodnutí + bloky.

const BLOCK = (msg) => msg;

export function decideCombinedEntry(deps, s) {
  const blocks = [];

  // Globální hard-blocky (session)
  if (!s.sessionOk) {
    return noTrade([BLOCK("SESSION_BLOCK")]);
  }

  // Dopady: LowVol modul chybí
  const scalpAllowedByDeps = deps.hasLowVol;
  if (!deps.hasLowVol) blocks.push("IMPACT:LOWVOL_MISSING=>SCALP_DISABLED");

  // Dopady: VP modul chybí
  if (!deps.hasVP) {
    blocks.push("IMPACT:VP_MISSING=>NO_POC_VP_LVN");
    blocks.push("IMPACT:VP_MISSING=>TP_STRUCTURE_ONLY");
  }
  // Dopady: OB modul chybí
  if (!deps.hasOB) blocks.push("IMPACT:OB_MISSING=>NO_OB_ENTRIES");
  // Dopady: GAP modul chybí
  if (!deps.hasGAP) blocks.push("IMPACT:GAP_MISSING=>TP1_STRUCTURE_ONLY");
  // Dopady: TRAP modul chybí
  if (!deps.hasTrap) blocks.push("IMPACT:TRAP_MISSING=>INTRADAY_ENTRY2_DISABLED");

  // 1) SWING má prioritu, pokud je potvrzená HTF reakce.
  if (s.htfReactionConfirmed) {
    return {
      ok: true,
      mode: "SWING",
      side: inferSideFromBOS(s),
      entryType: "HTF_REACTION_ONLY",
      tfContext: "1h",
      tfEntry: "5m",
      slRule: "UNDER_SWING",
      tpPlan: { tp1: "SWING_PERCENT_4_6" },
      trailing: "NONE",
      blocks,
    };
  }

  // 2) INTRADAY, pokud je struktura čitelná
  if (s.structureReadable) {
    if (!deps.hasOB && !s.returnToLevel) {
      return noTrade([...blocks, BLOCK("INTRADAY_BLOCK:OB_MISSING_NEEDS_RETURN")]);
    }
    if (deps.hasOB && s.touchOB) {
      return {
        ok: true,
        mode: "INTRADAY",
        side: inferSideFromBOS(s),
        entryType: "OB_RETURN",
        tfContext: "1h",
        tfEntry: "5m",
        slRule: "UNDER_OB_WICK",
        tpPlan: {
          tp1: deps.hasGAP ? "GAP_OR_STRUCTURE" : "STRUCTURE_NEAREST",
          tp2: deps.hasVP ? "VP_OR_HTF_SR" : "STRUCTURE_NEAREST",
        },
        trailing: "NONE",
        blocks,
      };
    }

    const bosSide = inferSideFromBOS(s);
    const canUseTrap = deps.hasTrap && s.trapReaction;

    if (bosSide && (s.bosUp || s.bosDown) && s.returnToLevel) {
      return {
        ok: true,
        mode: "INTRADAY",
        side: bosSide,
        entryType: "BOS_RETURN",
        tfContext: "1h",
        tfEntry: "5m",
        slRule: "UNDER_SWING",
        tpPlan: {
          tp1: deps.hasGAP ? "GAP_OR_STRUCTURE" : "STRUCTURE_NEAREST",
          tp2: deps.hasVP ? "VP_OR_HTF_SR" : "STRUCTURE_NEAREST",
        },
        trailing: "NONE",
        blocks,
      };
    }

    if (canUseTrap && s.returnToLevel) {
      return {
        ok: true,
        mode: "INTRADAY",
        side: bosSide,
        entryType: "BOS_RETURN",
        tfContext: "1h",
        tfEntry: "5m",
        slRule: "UNDER_SWING",
        tpPlan: {
          tp1: deps.hasGAP ? "GAP_OR_STRUCTURE" : "STRUCTURE_NEAREST",
          tp2: deps.hasVP ? "VP_OR_HTF_SR" : "STRUCTURE_NEAREST",
        },
        trailing: "NONE",
        blocks,
      };
    }
  }

  // 3) SCALP poslední priorita
  if (!scalpAllowedByDeps) {
    return noTrade([...blocks, BLOCK("SCALP_BLOCK:LOWVOL_MODULE_MISSING")]);
  }
  if (s.inLowVolume) {
    return noTrade([...blocks, BLOCK("SCALP_BLOCK:LOW_VOLUME")]);
  }

  const scalpSide = inferSideFromBOS(s);

  if (deps.hasVP && s.rejectionInLVN) {
    return {
      ok: true,
      mode: "SCALP",
      side: scalpSide,
      entryType: "REJECTION_ZONE",
      tfContext: "1h",
      tfEntry: "5m",
      slRule: deps.hasOB ? "UNDER_OB_WICK" : "UNDER_SWING",
      tpPlan: { tp1: "POC_VP_NEAREST" },
      trailing: "ACTIVATE_AFTER_0_5_TO_0_7_PCT",
      blocks,
    };
  }

  if (deps.hasOB && s.rejectionInOB) {
    return {
      ok: true,
      mode: "SCALP",
      side: scalpSide,
      entryType: "REJECTION_ZONE",
      tfContext: "1h",
      tfEntry: "5m",
      slRule: "UNDER_OB_WICK",
      tpPlan: deps.hasVP ? { tp1: "POC_VP_NEAREST" } : { tp1: "STRUCTURE_NEAREST" },
      trailing: "ACTIVATE_AFTER_0_5_TO_0_7_PCT",
      blocks,
    };
  }

  if ((s.bosUp || s.bosDown) && s.returnToLevel) {
    return {
      ok: true,
      mode: "SCALP",
      side: scalpSide,
      entryType: "BOS_RETURN",
      tfContext: "1h",
      tfEntry: "5m",
      slRule: "UNDER_SWING",
      tpPlan: deps.hasVP ? { tp1: "POC_VP_NEAREST" } : { tp1: "STRUCTURE_NEAREST" },
      trailing: "ACTIVATE_AFTER_0_5_TO_0_7_PCT",
      blocks,
    };
  }

  return noTrade([...blocks, BLOCK("NO_VALID_ENTRY")]);
}

function noTrade(blocks) {
  return {
    ok: false,
    mode: null,
    side: null,
    entryType: null,
    tfContext: null,
    tfEntry: null,
    slRule: null,
    tpPlan: null,
    trailing: "NONE",
    blocks,
  };
}

function inferSideFromBOS(s) {
  if (s.bosUp && !s.bosDown) return "LONG";
  if (s.bosDown && !s.bosUp) return "SHORT";
  return null;
}
