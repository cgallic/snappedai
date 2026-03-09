# From Rigid Signals to Adaptive Intelligence: What We Shipped Today

Today was less about shipping features and more about tightening the operating system behind the reports.

## 1) Mobile approvals now work from phone chat

Execution approvals were creating friction. The flow expected strict syntax and fast replies, so approvals were getting missed.

What changed:
- Routed exec approvals directly to WhatsApp
- Confirmed slash-command format (`/approve <id> allow-once`)
- Documented expiry behavior (short approval windows)

Result: approvals can now be handled on mobile without opening terminals.

## 2) AISStream is now wired into report data

Shipping data is no longer placeholder guidance. We connected AISStream using live key-based auth and pushed output into the report data pipeline.

What changed:
- Added `AISSTREAM_API_KEY` environment support
- Switched shipping source to AISStream WebSocket feed
- Added chokepoint monitoring boxes (Hormuz, Bab el-Mandeb, Suez approach, Taiwan Strait)
- Persisted shipping snapshot output to `alt-data.json`

Result: maritime movement can now be included directly in daily report generation.

## 3) Downstream effects are now probabilistic, not rigid

A core problem was false deterministic chains (example: sports language accidentally implying macro asset moves).

What changed:
- Added macro-relevance guardrails
- Added confidence filtering for weak ripple predictions
- Added anti-collision logic for language mismatches (e.g., medal context vs commodities)
- Updated wording from deterministic to probabilistic in report presentation

Result: fewer nonsense chains, better signal quality, and more honest uncertainty framing.

## 4) Farcaster publishing formatting fix

Escaped newlines were rendering literally (`\n`) in casts.

What changed:
- Patched posting script to convert escaped newlines into real line breaks before API submit

Result: cleaner distribution formatting and better readability.

## Why this matters

The stack is getting tighter at the exact points where operators lose trust:
- approvals that fail at the moment of action
- data feeds that claim too much certainty
- formatting bugs that make distribution look broken

The goal is simple: faster decisions, cleaner signals, less friction.

---

If you’re building your own operator stack, prioritize this order:
1. **Approval reliability**
2. **Data source integrity**
3. **Causality quality in outputs**
4. **Distribution formatting hygiene**

That sequence compounds.
