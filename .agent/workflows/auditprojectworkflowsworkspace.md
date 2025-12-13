---
description: Workflows v tomto workspace jsou určeny výhradně pro projekt ai-matic-bot. Slouží k řízenému, opakovatelnému a auditovatelnému řešení technických úloh napříč celým stackem (frontend, engine, backend, API, Bybit integrace).
---

/audit-mainnet

Zaměř se výhradně na problém:
„Bybit mainnet neprovádí obchody“.

Postup:

1. Sleduj celý tok:
   UI → useTradingBot → API route → backend → bybitClient → Bybit.
2. Porovnej chování testnet vs mainnet.
3. Ověř:

   * výběr API route (/api/demo vs /api/main),
   * načtení API klíčů (testnet vs mainnet),
   * base URL Bybit API,
   * signování requestu,
   * payload order/create,
   * minimální limity (qty, notional, step).
4. Identifikuj přesný bod selhání.
5. Označ, zda jde o:

   * routing bug,
   * auth/signature bug,
   * payload bug,
   * tiché potlačení chyby.

Výstup:

* Jednoznačný závěr, proč mainnet neobchoduje.
* Seznam konkrétních souborů k opravě.

----

/fix-mainnet

Navrhni a proveď opravy pro mainnet obchodování.

Postup:

* Oprav routing a environment přepínání.
* Zajisti striktní validaci payloadů.
* Zruš tiché catch bloky.
* Přidej detailní logging pro mainnet.
* Zachovej kompatibilitu s testnetem.

Výstup:

* Konkrétní kódové změny (diff nebo před/po).
* Stručné vysvětlení každé opravy.

----

/migrate-architecture

Navrhni migrační plán pro ai-matic-bot.

Zaměř se na:

* odstranění duplicit (server vs /api, .js vs .ts),
* sjednocení API kontraktů,
* sjednocení typů (types.ts),
* bezpečnou práci s konfigurací a .env,
* budoucí rozšiřitelnost.

Výstup:

* Migrační kroky (krok 1…n).
* Co je breaking change a co ne.
* Doporučený cílový stav architektury.

----

/full-pr-mainnet-fix

Spusť kompletní workflow:
audit → opravy → migrace → Pull Request
pro problém mainnet obchodování.

Postup:

1. Proveď /audit-mainnet.
2. Navrhni opravy a migraci.
3. Připrav finální Pull Request.

Výstup:

* Kompletní PR připravený k merge.
* Včetně migračních instrukcí a checklistu.
