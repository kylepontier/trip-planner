import Anthropic from "@anthropic-ai/sdk";
import { MODEL, MAX_TOKENS } from "./config.js";

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
              required: ["part_of_day", "activity_title", "why", "good_for_ages"],
              properties: {
                part_of_day: {
                  type: "string",
                  enum: ["morning", "afternoon", "evening"],
                },
                activity_title: { type: "string" },
                why: { type: "string" }, // one line on why it fits here
                good_for_ages: { type: "array", items: { type: "integer" } },
              },
            },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You are a thoughtful family-trip planner. Using ONLY your own
knowledge (no web browsing), you produce (1) categorized menus of activity ideas and
(2) a flexible, day-by-day itinerary for a family traveling with kids.

Guiding principles:
- AGE-APPROPRIATENESS is the main driver. Tailor ideas to the specific ages of the
  kids given. When ages span a wide range, favor activities that work for the whole
  group or explain how younger and older kids can each engage.
- Use the TRIP DATES to reason about season, likely weather, daylight, and any
  well-known timely/seasonal events or considerations for each location. Put this
  reasoning in season_notes. Do NOT invent specific named events you are unsure of —
  keep those to general, reliable knowledge (grounding with live search comes later).
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

All dates must be YYYY-MM-DD. good_for_ages is always [minAge, maxAge].`;

// Turn the raw form inputs into a compact, unambiguous prompt for the model.
function buildUserPrompt(input) {
  return [
    "Plan a family trip with the following parameters.",
    "",
    "Kids (ages): " +
      (input.kids?.map((k) => k.age).join(", ") || "none specified"),
    `Trip dates: ${input.dateRange?.start} to ${input.dateRange?.end}`,
    "",
    "Locations and their date ranges:",
    ...(input.locations || []).map(
      (l) => `- ${l.name}: ${l.start} to ${l.end}`,
    ),
    "",
    "Fixed commitments to schedule around (may be empty):",
    ...((input.fixedCommitments || []).length
      ? input.fixedCommitments.map(
          (c) => `- ${c.date}${c.time ? " " + c.time : ""}: ${c.title}`,
        )
      : ["- (none)"]),
    "",
    "Return the categorized idea menus and the full day-by-day itinerary.",
  ].join("\n");
}

export async function generatePlan(input) {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    output_config: {
      format: { type: "json_schema", schema: PLAN_SCHEMA },
      effort: "medium",
    },
    messages: [{ role: "user", content: buildUserPrompt(input) }],
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

  return JSON.parse(textBlock.text);
}
