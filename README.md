# Trip Planner

A reusable family-trip planner. You enter your trip parameters — number of kids and
their ages, trip dates, one or more locations with their own date ranges, and any fixed
commitments — and it produces **(1) categorized activity ideas** and **(2) a flexible,
day-by-day itinerary** tailored to your family, presented as a navigable dashboard with a
calendar, real weather, and a map.

Plain HTML, CSS, and JavaScript — no React, no TypeScript, no build step. A tiny local
Node server holds your API key and talks to the Claude API so the key never reaches the
browser. Suggestions are grounded in real places and events (Claude web search), each day
shows real weather (Open-Meteo), and the itinerary is plotted on a map (Leaflet +
OpenStreetMap) — all free, none needing an API key except Claude. The interface uses
Microsoft's **Fluent 2** design language with a light/dark theme toggle that defaults to
your operating system's setting.

## How it works

- **`public/`** — the dashboard UI. You start on a centered form; after you generate a
  plan, the inputs slide into a left rail (editable, with a **Regenerate** button) and the
  results take the main stage:
  - a **hero** summary of the trip,
  - **Activity Ideas** as tabs by type (outdoor, rainy-day, toddler-friendly, …), and when
    a type spans multiple cities, a second row of city sub-tabs to view one city at a time,
  - a **day-by-day itinerary** with a **Calendar ⇄ List** toggle: the calendar is a
    weekday-aligned grid showing each day's weather and commitments; pick a day to see its
    details and pan the map.

  The UI only ever calls `POST /api/plan` — it never sees your API key.
- **`server/`** — the logic layer that holds your key:
  - `index.js` — tiny web server; serves `public/` and exposes `/api/plan`.
  - `planner.js` — builds the Claude requests and returns the plan as structured JSON.
  - `weather.js` — geocodes each location and fetches weather from Open-Meteo.
  - `config.js` — model choice and feature toggles (change behavior here).

When you submit the form, the server builds the plan in **three stages**:

1. **Research** — a web-search pass. The model searches to confirm real, currently-open
   places and any timely/seasonal events (and their official URLs) for your exact locations
   and dates, then writes a short "verified brief." It's told to drop anything it can't
   confirm.
2. **Planning** — a second call that takes your trip parameters plus that verified brief
   and returns the full plan as structured JSON (a fixed schema), including a real "More
   info" link per activity when one is known — so the UI can render it cleanly every time.
3. **Enrich** — the server geocodes each location and attaches real weather and map
   coordinates from Open-Meteo. This is real fetched data, not model output, so it lives
   outside the model's JSON.

The itinerary places any fixed commitments first, then fills the open
morning/afternoon/evening slots around them, balancing kids of different ages, with a
one-line rationale on each slot.

## Design decisions

**UI/server split, key server-side.** The browser only ever talks to this server, and the
server is the only thing that holds the API key. The key can't leak to a user or get
committed. `.env` (with the real key) is gitignored; `.env.example` (a keyless template)
is committed.

**Structured JSON output.** The planning call is constrained to a fixed JSON schema, so
the response is guaranteed to match the shape the UI expects. A malformed response fails
cleanly instead of rendering garbage — no defensive parsing in the frontend.

**Grounding in two phases, not one.** Web search and structured JSON are deliberately
split into two separate calls. The messy, slow part (search) is kept fully apart from the
part that must produce clean JSON — so raw or irrelevant search results can never corrupt
the rendered plan. The structured phase only ever sees an already-filtered plain-text
brief. If research errors or finds nothing, planning degrades gracefully to model
knowledge only — a bad search never breaks plan generation.

**A deliberate tradeoff: leaner web search, verified by testing.** The newer
"dynamic-filtering" web-search tool ran hidden code-execution to filter results, spiraled
into 90+ tool calls, and failed to finish on a test query. The classic `web_search`
variant finished the same task cleanly in ~12 seconds. This project uses the classic
variant on purpose — predictable latency over marginal filtering.

**Weather is fetched, not generated.** A forecast is real-world data, so it is *not* part
of the model's JSON — the server fetches it from Open-Meteo after planning. Because a real
forecast only exists ~16 days out, the app shows a **forecast** for near dates and
**typical** values (last year's actuals for the same dates) for far ones, labeled honestly
so it's never misleading. It's best-effort: if weather can't be fetched, the plan still
renders.

**Navigable results, not one long scroll.** The plan is a lot of information, so instead of
stacking it all vertically the UI lets you move through it: a hero summary, activity ideas
split into tabs (by type, then by city), and an itinerary you can view as a calendar or a
flat list. Cities are de-bundled because a "things to do outdoors" list mixing four cities
is hard to scan — pick the type, then the city.

**Links are guarded.** The model may include a URL per activity, but a `safeUrl()` check
only lets `http(s)` links render, so a `javascript:`/`data:` URL can never become a live
link.

**The map is rudimentary on purpose.** It uses Leaflet + free OpenStreetMap tiles (no API
key) and pins each city, syncing to the calendar (pick a day → pan to its city). Pins are
**city-level**, not per-activity: geocoding every attraction reliably is heavy and
error-prone, so city-level spatial awareness is the honest first version. It degrades to no
map if Leaflet fails to load or coordinates are missing.

**Fluent 2 styling in plain CSS.** The UI matches Microsoft's Fluent 2 design language
through CSS design tokens rather than a component library — no build step and no runtime
dependency, and it themes everything uniformly, including the native date pickers and (via
a filter) the map tiles in dark mode. Light and dark are a token swap on a `data-theme`
attribute: it defaults to the OS setting, follows OS changes until you choose manually,
then remembers your choice; an inline head script applies it before first paint to avoid a
flash. (The real Fluent component libraries were considered — Web Components v3 and React
v9 — but both added either theming/date-picker gaps or a build step, so a faithful CSS
match was the better fit for this stack.)

**Fixed commitments are data, not hope.** Commitments are carried as their own field and
placed into the itinerary first; the model fills open slots around them. The requirement is
enforced structurally, not just requested in the prompt.

**Free, no-key external services.** Weather (Open-Meteo) and map tiles (OpenStreetMap) need
no API key and no billing account, and are called a handful of times per plan. The only
paid, key-bearing call in the whole app is to Claude.

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

1. On the start screen, enter your family's details: each kid's age, the trip dates, one or
   more locations (each with its own date range), and any fixed commitments to schedule
   around.
2. Click **Generate plan**. Grounding the plan in real info and fetching weather takes a
   minute or two — longer for multi-week, multi-city trips. The inputs then move to a left
   rail; edit anything there and click **Regenerate plan** to re-run.
3. Explore the results:
   - **Activity Ideas** — pick an activity type tab; if it spans multiple cities, use the
     city sub-tabs. Each idea shows age, energy, and duration badges, and a **More info ↗**
     link when one is known.
   - **Day-by-day itinerary** — toggle **Calendar** or **List**. In the calendar, each day
     shows its weather and a dot for fixed commitments; click a day to see its full details
     (weather, commitments, and each slot's rationale and link) and to pan the map to that
     day's city.

Use the ☀️/🌙 button in the top-right to switch light/dark themes. It follows your OS by
default and remembers a manual choice.

## Changing the model

The model is set in one line in `server/config.js` (`MODEL = "claude-sonnet-4-6"`). Sonnet
4.6 is a strong, cost-effective default. For richer suggestions at higher cost, change it
to `claude-opus-4-8`; for the fastest and cheapest, `claude-haiku-4-5`.

## Configuration toggles

Also in `server/config.js`:

- `ENABLE_WEB_SEARCH = true` — set to `false` to skip the research phase and plan from the
  model's own knowledge only (faster, but less current).
- `WEB_SEARCH_MAX_USES = 5` — caps how many searches the model may run per plan.
- `ENABLE_WEATHER = true` — set to `false` to skip weather fetching (and location
  geocoding); the map then has no coordinates and won't appear.

## Keeping your key safe

- Never put your key in any file inside `public/` — those are sent to the browser.
- Never commit `.env`. (It's already gitignored.)
- If a key is ever exposed, revoke it in the Anthropic Console and create a new one.

## Known limitations

This is a working prototype.

- Plan generation takes a minute or more (longer for large trips) because it does real web
  searches and weather lookups.
- Suggestions are grounded but not guaranteed — the model can still occasionally get a
  detail wrong.
- Weather beyond ~16 days is **typical** (based on last year's actuals), not a forecast.
- The map shows **city-level** pins, not individual venues.
- On narrow/mobile screens the input rail stacks above the results rather than collapsing.
- There are no automated tests yet, and it isn't deployed (it runs locally).
