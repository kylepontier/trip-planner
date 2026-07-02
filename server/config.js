// ── Model configuration ────────────────────────────────────────────────
// Swap this one line to change which Claude model the planner uses.
// Current default: Sonnet 4.6 — fast, cost-effective, and strong at
// returning structured JSON. Alternatives you can drop in:
//   "claude-opus-4-8"   → richer / more creative suggestions, higher cost
//   "claude-haiku-4-5"  → fastest / cheapest, lighter reasoning
export const MODEL = "claude-sonnet-4-6";

// Max tokens for the model's response. 16000 is a safe non-streaming
// default that comfortably fits menus + a two-week itinerary while
// staying under the SDK's request timeout.
export const MAX_TOKENS = 16000;
