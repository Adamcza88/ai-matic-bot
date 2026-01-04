# New dashboard structure

Changes
- Added a sticky status bar, KPI row, and tabbed layout for the dashboard.
- Converted positions, orders, and fills into tables with empty states.
- Moved live feed into Logs with level filters and autoscroll-on-bottom behavior.
- Reworked signal diagnostics into an accordion per symbol with PASS/BLOCKED summaries.
- Consolidated overview content into strategy summary, top signals, asset PnL, and recent events.

Component map
- src/components/Dashboard.tsx: main dashboard layout and data wiring.
- src/components/dashboard/StatusBar.tsx: environment + execution + connection status bar.
- src/components/dashboard/KpiRow.tsx: KPI cards row.
- src/components/dashboard/OverviewTab.tsx: operational overview content.
- src/components/dashboard/PositionsTable.tsx: positions table with expandable details.
- src/components/dashboard/OrdersPanel.tsx: orders and fills tables with filters.
- src/components/dashboard/SignalsAccordion.tsx: signal checklist accordion.
- src/components/dashboard/LogsPanel.tsx: logs view with level filter and smart autoscroll.
- src/components/dashboard/Panel.tsx: shared panel wrapper.
