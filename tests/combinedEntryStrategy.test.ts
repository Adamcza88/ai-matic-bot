import { describe, it } from "node:test";
import assert from "node:assert";
import { decideCombinedEntry, type DependencyFlags, type MarketSignals } from "../src/engine/combinedEntryStrategy";

describe("CombinedEntryStrategy - Safety Checks", () => {
  it("should not return INTRADAY signal with side: null when BOS is missing", () => {
    // 1. Nastavení závislostí: Máme Trap modul
    const deps: DependencyFlags = {
      hasVP: false,
      hasOB: false,
      hasGAP: false,
      hasTrap: true,
      hasLowVol: true,
    };

    // 2. Nastavení signálů:
    // - Jsme v Intraday režimu (structureReadable)
    // - Máme reakci na past (trapReaction) a návrat (returnToLevel)
    // - ALE nemáme BOS (bosUp/bosDown jsou false) -> směr je neznámý
    const signals: MarketSignals = {
      inLowVolume: false,
      htfReactionConfirmed: false,
      structureReadable: true,
      sessionOk: true,
      bosUp: false,
      bosDown: false,
      returnToLevel: true,
      rejectionInLVN: false,
      touchOB: false,
      rejectionInOB: false,
      trapReaction: true,
    };

    // 3. Exekuce
    const decision = decideCombinedEntry(deps, signals);

    // 4. Ověření
    // Strategie by neměla vygenerovat validní signál, pokud nezná směr (side).
    // Pokud by chyba nebyla opravena, vrátilo by to ok: true, side: null.
    assert.strictEqual(decision.ok, false, "Should not produce a signal without BOS direction");
  });

  it("should not return INTRADAY signal for OB touch when BOS is missing", () => {
    const deps: DependencyFlags = {
      hasVP: false,
      hasOB: true, // Máme OB modul
      hasGAP: false,
      hasTrap: false,
      hasLowVol: true,
    };

    const signals: MarketSignals = {
      inLowVolume: false,
      htfReactionConfirmed: false,
      structureReadable: true,
      sessionOk: true,
      bosUp: false, // Směr neznámý
      bosDown: false,
      returnToLevel: false,
      rejectionInLVN: false,
      touchOB: true, // Dotyk OB
      rejectionInOB: false,
      trapReaction: false,
    };

    const decision = decideCombinedEntry(deps, signals);

    assert.strictEqual(decision.ok, false, "Should not produce OB_RETURN signal without BOS direction");
  });

  it("should not return SCALP signal for LVN rejection when BOS is missing", () => {
    const deps: DependencyFlags = {
      hasVP: true, // VP modul pro LVN
      hasOB: false,
      hasGAP: false,
      hasTrap: false,
      hasLowVol: true, // Nutné pro povolení SCALP
    };

    const signals: MarketSignals = {
      inLowVolume: false,
      htfReactionConfirmed: false,
      structureReadable: true,
      sessionOk: true,
      bosUp: false, // Směr neznámý
      bosDown: false,
      returnToLevel: false,
      rejectionInLVN: true, // Signál pro vstup
      touchOB: false,
      rejectionInOB: false,
      trapReaction: false,
    };

    const decision = decideCombinedEntry(deps, signals);

    assert.strictEqual(decision.ok, false, "Should not produce REJECTION_ZONE signal without BOS direction");
  });

  it("should not return SWING signal when BOS is missing (even if HTF reaction is confirmed)", () => {
    const deps: DependencyFlags = {
      hasVP: true,
      hasOB: true,
      hasGAP: true,
      hasTrap: true,
      hasLowVol: true,
    };

    const signals: MarketSignals = {
      inLowVolume: false,
      htfReactionConfirmed: true, // SWING trigger
      structureReadable: true,
      sessionOk: true,
      bosUp: false, // Směr neznámý
      bosDown: false,
      returnToLevel: false,
      rejectionInLVN: false,
      touchOB: false,
      rejectionInOB: false,
      trapReaction: false,
    };

    const decision = decideCombinedEntry(deps, signals);

    assert.strictEqual(decision.ok, false, "Should not produce SWING signal without BOS direction");
  });
});