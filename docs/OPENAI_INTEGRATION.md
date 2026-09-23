# StockPilot Procurement Agent

## What is connected

The agent operates on the same normalised `Dataset` that powers the dashboard. `lib/analytics.ts` remains the single calculation authority for forecasts, stock position, safety stock, MOQ, pack size and budget allocation. An LLM never computes or invents these values.

The server exposes an in-memory, anonymous session for the local MVP. An opaque `sessionId` is bound to an HttpOnly owner cookie. The server validates the dataset with Zod, limits collection sizes, computes `datasetRevision` itself and marks old plans stale when data changes. This is suitable for a single demo instance only; a public multi-instance deployment needs shared encrypted storage and authenticated tenancy.

The `POST /api/agent` route initializes or clears a session and retains compatibility with the old `{ question, context }` explanation-only request. `POST /api/agent/stream` uses fetch-compatible NDJSON events, not `EventSource`, and reports `run_started`, tool events, review events, answer readiness, confirmation requests, errors and completion. It never streams private model reasoning or API secrets.

## Tools and workflow

Each tool returns the same envelope: `status`, `toolName`, `datasetRevision`, `scope`, `resultId`, `data`, `facts`, `assumptions`, `warnings` and (when required) `errorCode`. Facts retain origin and calculation identity. The UI uses facts from completed tools as numeric evidence.

The active tool set is selected from the request intent rather than exposing every capability at once. Connected tools include:

- dataset summary, product search, SKU details and recommendation breakdown;
- immutable purchase-plan calculation, delay/budget scenario, plan comparison and budget coverage;
- known supplier comparison;
- an NVIDIA-review boundary, backtest availability reporting, draft purchase orders, supplier-message drafts and report payloads.

Drafts are grouped by supplier, versioned and idempotent. They are never sent. Creating a draft emits a `confirmation_required` event. CSV export remains guarded against spreadsheet formula injection.

## OpenAI mode and fallback

Set `OPENAI_API_KEY` and an account-verified `OPENAI_MODEL` only in `.env.local`; never use a `NEXT_PUBLIC_` key. The Responses request uses `store: false`, a strict function schema, bounded iterations/tool calls and an abort signal. Tool output and product names are explicitly treated as untrusted data.

With no key or no configured model, the same deterministic tools run locally and the UI says **Тестовый режим · локальное объяснение**. It does not pretend an OpenAI request succeeded. Model text with numeric claims is accepted only when it cites known `fact` identifiers; otherwise the user receives a deterministic, source-safe fallback.

`store: false` is a request setting, not a claim that a provider stores nothing under every policy.

## NVIDIA and backtests

`lib/openai/adapters/nvidia.ts` is a small registration boundary only. It does not recreate NVIDIA logic. The developer responsible for `lib/nvidia/**` registers its reviewed implementation with `registerNvidiaReviewer`. A mismatched `planHash`, unavailable module or invalid response remains explicit and cannot replace a calculation.

The existing SKU-level `stockpilot-backtest` is still available in the Backtest screen. The agent reports portfolio/system backtest as unavailable rather than renaming a forecast-only check as a full validation.

## Demo and verification

1. Load the seeded demo data.
2. Ask for urgent products, then open one SKU from an evidence card.
3. Ask for a budgeted purchase plan and inspect the tool timeline and fact cards.
4. Run the delay scenario, NVIDIA review, and a draft creation request.
5. Show the confirmation warning before exporting a draft.

Run checks with the repository package manager:

```bash
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
```

The unit suite uses fake provider responses and makes no paid API calls. A real smoke test is separate and should be run only with a deliberately configured `.env.local`.
