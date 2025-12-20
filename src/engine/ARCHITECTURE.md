# Bot Architecture Overview

This document provides a high-level overview of the two distinct trading bot architectures present in the codebase: **V1 (Monolithic)** and **V2 (Modular/Live)**.

---

## V1: Monolithic Backtesting Engine (`botEngine.ts`)

The V1 system, encapsulated primarily within `botEngine.ts`, is a self-contained, stateful engine.

- **Purpose:** Its primary role is for **strategy research, development, and backtesting**.
- **Architecture:** It's a single, large class (`TradingBot`) that handles everything:
  - Signal Generation (complex internal logic for trend and range markets)
  - Position Sizing
  - Active Position Management (tick-by-tick evaluation, trailing stops, partial profits)
  - PnL Calculation and internal state tracking (balance, drawdown).
- **Strengths:**
  - **Fast Iteration:** Having everything in one place makes it easy to quickly prototype and test new strategy ideas.
  - **Simplicity:** For pure backtesting, it's simple to run as it has no external dependencies for execution or state.
- **Limitations:**
  - Not suitable for live trading due to its tight coupling and lack of robustness features required for real-world exchange interaction.

---

## V2: Modular Live Trading System

The V2 system is a professional-grade, decoupled architecture designed for **live trading**. It separates responsibilities into distinct, specialized modules.

### Core Components

1.  **Strategy Modules** (`htfTrendFilter.ts`, `ltFPullback.ts`, `liquidityEntry.ts`)
    -   Generate high-level trading *ideas* or *signals*.
    -   They are stateless and focus only on market analysis.
    -   Example Flow: `htfTrendFilter` finds the macro trend -> `ltFPullback` identifies a setup -> `liquidityEntry` plans a precise entry tactic.

2.  **Execution Router** (`execution/executionRouter.ts`)
    -   Acts as a "translator" between a strategy signal and a concrete order.
    -   It intelligently decides the **order type** (e.g., `LIMIT` for pullbacks, `STOP_LIMIT` for breakouts) and standardizes how TP/SL and trailing stops are planned.

3.  **Runtime** (`v2Runtime.ts`)
    -   The core of the live execution logic.
    -   Manages a strict state machine for an order's lifecycle (`SCAN` -> `PLACE` -> `MANAGE` -> `EXIT`).
    *   Enforces safety rules: Kill Switch, Safe Mode, API rate limiting.
    -   It does **not** generate signals or calculate PnL. It only manages the state of orders and positions as known by the exchange.

4.  **Exchange Adapter** (`bybitAdapterV2.ts`)
    -   The lowest-level component that communicates with the exchange API.
    -   Handles the complex orchestration of placing an order, waiting for it to be filled, and immediately placing a protective stop-loss.
    -   Uses **idempotency keys** to prevent duplicate orders and includes retry logic for network robustness.

### Key Architectural Principles

-   **Separation of Concerns:** Strategy is decoupled from execution.
-   **Offloading to Exchange:** Management tasks like trailing stops are defined in a plan and offloaded to the exchange to execute, rather than being managed tick-by-tick by the bot.
-   **Safety and Robustness:** Designed from the ground up with features to handle real-world issues like API errors, rate limits, and the need for emergency stops.
-   **External PnL Tracking:** PnL is calculated by a separate backend service that fetches data directly from the exchange's trade history, ensuring accuracy.
