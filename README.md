# Trip Planner

A reusable family-trip planner. You enter your trip parameters — number of kids and
their ages, trip dates, one or more locations with their own date ranges, and any fixed
commitments — and it produces **(1) categorized menus of activity ideas** and **(2) a
flexible, day-by-day itinerary** tailored to your family.

Plain HTML, CSS, and JavaScript — no React, no TypeScript, no build step. A tiny local
Node server holds your API key and talks to the Claude API so the key never reaches the
browser. The interface uses Microsoft's **Fluent 2** design language, with a light/dark
theme toggle that defaults to your operating system's setting.

## How it works

- **`public/`** — the UI (what the browser shows): the input form (kids' ages, trip
  dates, locations, fixed commitments), and the rendered results (idea menus +
  itinerary). It only ever calls `POST /api/plan`. It never sees your API key.
- **`server/`** — the logic layer that holds your key:
  - `index.js` — tiny web server; serves `public/` and exposes `/api/plan`.
  - `planner.js` — builds the requests and calls the Claude API.
  - `config.js` — model choice and other tunables (change behavior here).

When you submit the form, the server generates the plan in **two phases**:

1. **Research** — a web-search pass. The model searches to confirm real, currently-open
   places and any timely/seasonal events for your exact locations and dates, then writes
   a short "verified brief." It's told to drop anything it can't confirm.
2. **Planning** — a second call that takes your trip parameters plus that verified brief
   and returns the full plan as structured JSON (a fixed schema), so the UI can render it
   cleanly every time.

The result is six scannable idea menus — outdoor, indoor/rainy-day, toddler-friendly,
older-kid, family-gathering, low-key evening — plus a day-by-day itinerary that places
any fixed commitments first, then fills the open morning/afternoon/evening slots around
them, balancing kids of different ages.

## Design decisions

**UI/server split, key server-side.** The browser only ever talks to this server, and
the server is the only thing that holds the API key. The key can't leak to a user or get
committed. `.env` (with the real key) is gitignored; `.env.example` (a keyless template)
is committed.

**Structured JSON output.** The planning call is constrained to a fixed JSON schema, so
the response is guaranteed to match the shape the UI expects. A malformed response fails
cleanly instead of rendering garbage — no defensive parsing in the frontend.

**Grounding in two phases, not one.** Web search and structured JSON are deliberately
split into two separate calls. The messy, slow part (search) is kept fully apart from the
part that must produce clean JSON — so raw or irrelevant search results can never corrupt
the rendered plan. The structured phase only ever sees an already-filtered plain-text
brief.

**Messy results are handled in three layers.** (1) The research prompt tells the model to
include only things it could confirm and to ignore off-topic results — filtering at the
source. (2) The structured phase never sees raw search output, only the cleaned brief.
(3) If the research phase errors or finds nothing, the planner degrades gracefully to
model-knowledge-only planning — a bad search never breaks plan generation.

**A deliberate tradeoff: leaner web search, verified by testing.** The newer
"dynamic-filtering" web-search tool ran hidden code-execution to filter results, spiraled
into 90+ tool calls, and failed to finish on a test query. The classic `web_search`
variant finished the same task cleanly in ~12 seconds. This project uses the classic
variant on purpose — predictable latency over marginal filtering.

**Fixed commitments are data, not hope.** Commitments are carried as their own field and
placed into the itinerary first; the model fills open slots around them. The requirement
is enforced structurally, not just requested in the prompt.

**Fluent 2 styling in plain CSS.** The UI matches Microsoft's Fluent 2 design language
through CSS design tokens rather than a component library — no build step and no runtime
dependency, and it themes everything uniformly, including the native date pickers.
Light and dark are a token swap driven by a `data-theme` attribute: it defaults to the
OS setting, follows OS changes until you choose manually, then remembers your choice. An
inline script in the page head applies the theme before first paint to avoid a flash of
the wrong colors. (The real Fluent component libraries were considered — Web Components
v3 and React v9 — but both added either theming/date-picker gaps or a build step, so a
faithful CSS match was the better fit for this stack.)

## Setup

You need [Node.js](https://nodejs.org) version 18 or newer (`node --version` to check).

1. **Get a Claude API key** at https://console.anthropic.com/.
2. **Install dependencies:**
   ```
   npm install
   ```
3. **Create your `.env` file** from the template and paste your key in:
   ```
   cp .env.example .env
   ```
   Then open `.env` and set `ANTHROPIC_API_KEY=sk-ant-...` to your real key.

   > 🔒 `.env` is gitignored, so your key is **never** committed to GitHub. Only
   > `.env.example` (with a fake placeholder) is committed.
4. **Start it:**
   ```
   npm start
   ```
5. Open http://localhost:3000 in your browser.

## Using it

1. Enter your family's details: each kid's age, the trip dates, one or more locations
   (each with its own date range), and any fixed commitments to schedule around.
2. Click **Generate plan**. Grounding the plan in real, current info takes a minute or
   two — longer for multi-week, multi-city trips.
3. Read the results:
   - **Activity idea menus** — six categorized, scannable lists with age, location,
     energy, and duration badges on each idea.
   - **Day-by-day itinerary** — one card per day, with any fixed commitments pinned first
     and each open slot carrying a one-line rationale.

Use the ☀️/🌙 button in the top-right to switch between light and dark themes. It follows
your operating system by default and remembers a manual choice.

## Changing the model

The model is set in one line in `server/config.js`
(`MODEL = "claude-sonnet-4-6"`). Sonnet 4.6 is a strong, cost-effective default. For
richer suggestions at higher cost, change it to `claude-opus-4-8`; for the fastest and
cheapest, `claude-haiku-4-5`.

## Web-search grounding

Also in `server/config.js`:

- `ENABLE_WEB_SEARCH = true` — set to `false` to skip the research phase and plan from
  the model's own knowledge only (faster, but less current).
- `WEB_SEARCH_MAX_USES = 5` — caps how many searches the model may run per plan, bounding
  latency and cost.

## Keeping your key safe

- Never put your key in any file inside `public/` — those are sent to the browser.
- Never commit `.env`. (It's already gitignored.)
- If a key is ever exposed, revoke it in the Anthropic Console and create a new one.

## Known limitations

This is a working prototype. Plan generation takes a minute or more (longer for large
trips) because it does real web searches. Suggestions are grounded but not guaranteed —
the model can still occasionally get a detail wrong. There are no automated tests yet, and
it isn't deployed (it runs locally).
