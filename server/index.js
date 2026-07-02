// Load .env into process.env BEFORE anything that reads the API key.
import "dotenv/config";

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatePlan } from "./planner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Fail fast with a clear message if the key isn't configured yet.
if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "\n[trip-planner] ANTHROPIC_API_KEY is not set.\n" +
      "Copy .env.example to .env and add your key, then restart.\n",
  );
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "1mb" }));

// Serve the UI (the "public" half of the split). The browser only ever talks
// to this server — never directly to Anthropic — so the key stays server-side.
app.use(express.static(path.join(__dirname, "..", "public")));

// The one endpoint: takes the trip parameters, returns the structured plan.
app.post("/api/plan", async (req, res) => {
  try {
    const plan = await generatePlan(req.body);
    res.json(plan);
  } catch (err) {
    console.error("[trip-planner] plan generation failed:", err);
    res.status(500).json({ error: err.message || "Failed to generate plan." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n[trip-planner] running at http://localhost:${PORT}\n`);
});
