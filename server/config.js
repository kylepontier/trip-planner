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

// ── Web-search grounding (Layer 2) ─────────────────────────────────────
// When true, the planner first runs a web-search pass to confirm real,
// current places and timely events before writing the plan. Flip to false
// to fall back to Layer 1 behavior (model knowledge only).
export const ENABLE_WEB_SEARCH = true;

// Caps how many searches the model may run during the research pass — keeps
// latency and cost bounded. 5 is comfortable for a multi-city trip.
export const WEB_SEARCH_MAX_USES = 5;

// ── Weather (Layer 4) ──────────────────────────────────────────────────
// When true, the server fetches real weather from Open-Meteo (free, no key)
// for each location — a forecast when dates are near, typical values when far.
export const ENABLE_WEATHER = true;
