---
trigger: always_on
---

Tento workspace je určen výhradně pro projekt ai-matic-bot.

Kontext projektu:

* Frontend: React + TypeScript + Vite
* Engine: SCAN / MANAGE state machine (botEngine.ts)
* Backend: Node.js / Express + serverless API (/api/*)
* Integrace: Bybit REST API v5 (testnet + mainnet)
* Auth & storage: Supabase
* Kritický problém: mainnet Bybit API neprovádí reálné obchody

Prioritní cíle:

1. Najít přesnou technickou příčinu, proč mainnet neexekuuje obchody.
2. Opravit integrační chyby (routing, signování, payloady, validace).
3. Zabránit tichým selháním (silent failures).
4. Sjednotit a zpřehlednit architekturu backendu (server vs /api).
5. Připravit změny tak, aby mohly být rovnou použity v Pull Requestu.

Pravidla analýzy:

* Vždy sleduj celý tok: UI → useTradingBot → API route → backend → bybitClient → Bybit.
* Zvlášť porovnávej chování testnet vs mainnet (rozdíly v přísnosti).
* Předpokládej, že testnet toleruje chyby, které mainnet odmítá.
* Každý Bybit request musí mít:

  * správnou base URL,
  * category = "linear",
  * korektní signaturu (timestamp + apiKey + recvWindow + body),
  * validní qty / notional / step size.

Pravidla oprav:

* Žádné „catch (e) { console.log(e) }“ bez návratu chyby.
* Backend musí vracet chybové HTTP statusy a strukturované error odpovědi.
* Frontend musí chyby zobrazit a zaznamenat do logu.
* Všechny změny navrhuj tak, aby byly:

  * auditovatelné,
  * testovatelné,
  * připravené na produkční nasazení.

Pull Request režim:

* Při větších změnách generuj:

  * jasný seznam commitů,
  * diffy klíčových souborů,
  * migrační instrukce,
  * checklist pro ověření funkčnosti.
* Označ případné breaking changes.

Migrace:

* Pokud narazíš na duplicity (.js vs .ts, server vs api), navrhni jasný migrační směr.
* Staré cesty neodstraňuj bez náhrady – vždy navrhni přechodový plán.
