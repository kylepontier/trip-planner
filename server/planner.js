import Anthropic from "@anthropic-ai/sdk";
import {
  MODEL,
  MAX_TOKENS,
  ENABLE_WEB_SEARCH,
  WEB_SEARCH_MAX_USES,
  ENABLE_WEATHER,
} from "./config.js";
import { enrichPlanWithWeather } from "./weather.js";

// The SDK reads ANTHROPIC_API_KEY from the environment (loaded from .env in
// index.js before this module is imported). The key stays server-side.
const client = new Anthropic();

// ── Output shape ────────────────────────────────────────────────────────
// This JSON Schema is handed to the model via output_config.format. The API
// then GUARANTEES the response matches this structure, so the UI can render
// it without defensive parsing. Fixed category keys mean consistent sections
// every time.
//
// Note: strict JSON-schema output requires `additionalProperties: false` and
// a `required` list on every object — that's why they appear everywhere.
const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["trip_summary", "idea_menus", "itinerary"],
  properties: {
    trip_summary: {
      type: "object",
      additionalProperties: false,
      required: ["kids", "date_range", "locations", "season_notes"],
      properties: {
        kids: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["age"],
            properties: { age: { type: "integer" } },
          },
        },
        date_range: {
          type: "object",
          additionalProperties: false,
          required: ["start", "end"],
          properties: {
            start: { type: "string" }, // YYYY-MM-DD
            end: { type: "string" },
          },
        },
        locations: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "start", "end"],
            properties: {
              name: { type: "string" },
              start: { type: "string" },
              end: { type: "string" },
            },
          },
        },
        season_notes: { type: "string" },
      },
    },

    idea_menus: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "label", "ideas"],
        properties: {
          category: {
            type: "string",
            enum: [
              "outdoor",
              "indoor_rainy",
              "toddler_friendly",
              "older_kid",
              "family_gathering",
              "low_key_evening",
            ],
          },
          label: { type: "string" }, // human-friendly heading
          ideas: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "title",
                "description",
                "location",
                "good_for_ages",
                "energy_level",
                "weather_dependent",
                "duration_hours",
                "url",
              ],
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                location: { type: "string" },
                // [minAge, maxAge] the idea suits, inclusive.
                good_for_ages: { type: "array", items: { type: "integer" } },
                energy_level: {
                  type: "string",
                  enum: ["low", "medium", "high"],
                },
                weather_dependent: { type: "boolean" },
                duration_hours: { type: "number" },
                // A real, useful link (official site / booking) or "" if unsure.
                url: { type: "string" },
              },
            },
          },
        },
      },
    },

    itinerary: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["date", "location", "day_summary", "fixed_commitments", "slots"],
        properties: {
          date: { type: "string" }, // YYYY-MM-DD
          location: { type: "string" },
          day_summary: { type: "string" },
          fixed_commitments: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["time", "title"],
              properties: {
                time: { type: "string" }, // e.g. "19:00" or "" if all-day
                title: { type: "string" },
              },
            },
          },
          slots: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["part_of_day", "activity_title", "why", "good_for_ages", "url"],
              properties: {
                part_of_day: {
                  type: "string",
                  enum: ["morning", "afternoon", "evening"],
                },
                activity_title: { type: "string" },
                why: { type: "string" }, // one line on why it fits here
                good_for_ages: { type: "array", items: { type: "integer" } },
                // Same as ideas: a real link for this activity, or "".
                url: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You are a thoughtful family-trip planner. You produce
(1) categorized menus of activity ideas and (2) a flexible, day-by-day itinerary for
a family traveling with kids.

Guiding principles:
- AGE-APPROPRIATENESS is the main driver. Tailor ideas to the specific ages of the
  kids given. When ages span a wide range, favor activities that work for the whole
  group or explain how younger and older kids can each engage.
- Use the TRIP DATES to reason about season, likely weather, daylight, and any
  timely/seasonal events or considerations for each location. Put this reasoning in
  season_notes.
- If a VERIFIED RESEARCH BRIEF is provided in the user message, prefer the real places
  and events it lists — they have been confirmed to currently exist. Use your own
  general knowledge to fill any gaps, but do NOT invent specific named venues or events
  you are unsure of.
- Use each LOCATION's own date range: suggest and schedule activities in the place the
  family is actually in on that date.

Idea menus:
- Provide an entry for each of these categories where it makes sense: outdoor,
  indoor_rainy, toddler_friendly, older_kid, family_gathering, low_key_evening.
- Aim for roughly 3–6 concrete ideas per category. Each idea gets a short, practical
  description, the location it applies to, an inclusive [minAge, maxAge] band, an
  energy level, whether it's weather-dependent, and a rough duration in hours.

Itinerary:
- Produce ONE entry per day across the entire trip date range (inclusive).
- Place any FIXED COMMITMENTS for that day first, in fixed_commitments, then build the
  open morning/afternoon/evening slots around them — do not double-book a slot that a
  commitment already fills.
- Balance the needs of different ages: pair higher-energy outings with calmer recovery
  time, keep evenings low-key when toddlers are present, and avoid over-packing days.
- Leave breathing room; it's fine for a slot to be a relaxed/flexible suggestion.
- Every slot's "why" should briefly justify the placement (energy, weather, timing,
  age balance, proximity to a commitment, etc.).

Links:
- For every idea and every itinerary slot, include a "url": a single real, useful link
  (the official website, or a tickets/booking page) ONLY if you are confident it exists
  from your knowledge or the research brief. If you are not sure of a real URL, use an
  empty string "". Never fabricate or guess links.

All dates must be YYYY-MM-DD. good_for_ages is always [minAge, maxAge].`;

// A plain-text description of the trip parameters, reused by both phases.
function tripParamsText(input) {
  return [
    "Kids (ages): " +
      (input.kids?.map((k) => k.age).join(", ") || "none specified"),
    `Trip dates: ${input.dateRange?.start} to ${input.dateRange?.end}`,
    "",
    "Locations and their date ranges:",
    ...(input.locations || []).map((l) => `- ${l.name}: ${l.start} to ${l.end}`),
  ].join("\n");
}

// ── Phase 1: research ────────────────────────────────────────────────────
// A search-only prompt. The model is told to VERIFY things by searching and to
// DISCARD anything it can't confirm — this is where messy or irrelevant search
// results get filtered out, before any of it reaches the structured plan.
function buildSearchPrompt(input) {
  return [
    "Research real, current, family-friendly things to do for this trip, then write a",
    "short verified brief. Use web search to CONFIRM that places are real and currently",
    "open, and to find any timely/seasonal events happening during the trip dates.",
    "",
    tripParamsText(input),
    "",
    "For each location, list:",
    "- A handful of specific, currently-open attractions or activities suited to the",
    "  kids' ages (name — one-line note: what it is, rough age fit, indoor/outdoor;",
    "  include the official website URL if you find one).",
    "- Any notable events, festivals, or seasonal considerations during the dates.",
    "- A one-line weather expectation for the season.",
    "",
    "Rules for the brief:",
    "- Only include things you could CONFIRM via search. If you can't confirm it, leave",
    "  it out entirely — do not guess, and ignore irrelevant or off-topic results.",
    "- Keep it concise plain text grouped by location. No preamble, no JSON.",
  ].join("\n");
}

// Runs the research pass. Returns a plain-text brief, or "" if search found
// nothing usable. Handles the server-side tool loop: web search runs on
// Anthropic's side and may return `pause_turn` when it wants to keep going —
// we re-send to let it resume, capped so it can't loop forever.
async function researchLocations(input) {
  const tools = [
    { type: "web_search_20250305", name: "web_search", max_uses: WEB_SEARCH_MAX_USES },
  ];
  const messages = [{ role: "user", content: buildSearchPrompt(input) }];
  const briefParts = [];

  for (let i = 0; i < 5; i++) {
    const r = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      tools,
      messages,
    });

    // Web-search responses split their answer across multiple text blocks
    // (cited text is chunked) — collect them all, not just the first.
    for (const block of r.content) {
      if (block.type === "text" && block.text.trim()) briefParts.push(block.text);
    }

    // pause_turn = the server tool loop paused; append the turn so far and
    // re-send to let it continue. Anything else (end_turn/max_tokens) is done.
    if (r.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: r.content });
      continue;
    }
    break;
  }

  return briefParts.join("\n").trim();
}

// Turn the trip inputs (plus any research brief) into the planning prompt.
function buildUserPrompt(input, brief) {
  const lines = [
    "Plan a family trip with the following parameters.",
    "",
    tripParamsText(input),
    "",
    "Fixed commitments to schedule around (may be empty):",
    ...((input.fixedCommitments || []).length
      ? input.fixedCommitments.map(
          (c) => `- ${c.date}${c.time ? " " + c.time : ""}: ${c.title}`,
        )
      : ["- (none)"]),
  ];

  if (brief) {
    lines.push(
      "",
      "VERIFIED RESEARCH BRIEF (real, currently-confirmed places and events — prefer",
      "these; fall back to your own knowledge only for gaps):",
      brief,
    );
  }

  lines.push(
    "",
    "Return the categorized idea menus and the full day-by-day itinerary.",
  );
  return lines.join("\n");
}

export async function generatePlan(input) {
  // Phase 1: ground the plan in real, current info (best-effort). If search is
  // disabled or fails, we degrade gracefully to model-knowledge-only planning.
  let brief = "";
  if (ENABLE_WEB_SEARCH) {
    try {
      brief = await researchLocations(input);
    } catch (err) {
      console.warn(
        "[trip-planner] web research failed, continuing without grounding:",
        err.message,
      );
    }
  }

  // Phase 2: produce the structured plan (no tools → reliable schema-valid JSON).
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    output_config: {
      format: { type: "json_schema", schema: PLAN_SCHEMA },
      effort: "medium",
    },
    messages: [{ role: "user", content: buildUserPrompt(input, brief) }],
  });

  // With output_config.format, the first text block is valid JSON matching
  // PLAN_SCHEMA. If the model was cut off (max_tokens) it can be incomplete —
  // surface that clearly rather than returning half a plan.
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      "The plan was too long to finish in one response. Try a shorter trip or fewer locations.",
    );
  }
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("The model returned no plan text.");

  const plan = JSON.parse(textBlock.text);

  // Attach real weather + location coordinates from Open-Meteo (best-effort).
  if (ENABLE_WEATHER) {
    try {
      await enrichPlanWithWeather(plan);
    } catch (err) {
      console.warn("[trip-planner] weather enrichment failed:", err.message);
    }
  }

  return plan;
}
