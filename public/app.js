// ── Dynamic form rows ───────────────────────────────────────────────────
// Each "Add" button appends a small row template; each row has its own remove
// button. The number of kids/locations/commitments is simply the row count.

const templates = {
  kid: () => `
    <div class="row" data-row="kid">
      <label>Age <input type="number" min="0" max="18" class="kid-age" required /></label>
      <button type="button" class="remove-btn" data-remove>Remove</button>
    </div>`,
  location: () => `
    <div class="row" data-row="location">
      <label>Name <input type="text" class="loc-name" placeholder="City A" required /></label>
      <label>From <input type="date" class="loc-start" required /></label>
      <label>To <input type="date" class="loc-end" required /></label>
      <button type="button" class="remove-btn" data-remove>Remove</button>
    </div>`,
  commitment: () => `
    <div class="row" data-row="commitment">
      <label>Date <input type="date" class="com-date" required /></label>
      <label>Time <input type="time" class="com-time" /></label>
      <label>What <input type="text" class="com-title" placeholder="Dinner with family" required /></label>
      <button type="button" class="remove-btn" data-remove>Remove</button>
    </div>`,
};

const lists = {
  kid: document.getElementById("kids-list"),
  location: document.getElementById("locations-list"),
  commitment: document.getElementById("commitments-list"),
};

function addRow(kind) {
  lists[kind].insertAdjacentHTML("beforeend", templates[kind]().trim());
}

// Wire the "+ Add" buttons.
document.querySelectorAll("[data-add]").forEach((btn) => {
  btn.addEventListener("click", () => addRow(btn.dataset.add));
});

// Delegate "Remove" clicks (rows are added dynamically).
document.getElementById("trip-form").addEventListener("click", (e) => {
  if (e.target.matches("[data-remove]")) {
    e.target.closest("[data-row]").remove();
  }
});

// Start with one row of each so the form isn't empty on load.
addRow("kid");
addRow("location");

// ── Gather form values into the shape the server expects ────────────────
function collectInput() {
  const kids = [...document.querySelectorAll('[data-row="kid"]')]
    .map((row) => ({ age: Number(row.querySelector(".kid-age").value) }))
    .filter((k) => Number.isFinite(k.age));

  const locations = [...document.querySelectorAll('[data-row="location"]')].map(
    (row) => ({
      name: row.querySelector(".loc-name").value.trim(),
      start: row.querySelector(".loc-start").value,
      end: row.querySelector(".loc-end").value,
    }),
  );

  const fixedCommitments = [
    ...document.querySelectorAll('[data-row="commitment"]'),
  ].map((row) => ({
    date: row.querySelector(".com-date").value,
    time: row.querySelector(".com-time").value,
    title: row.querySelector(".com-title").value.trim(),
  }));

  return {
    kids,
    dateRange: {
      start: document.getElementById("trip-start").value,
      end: document.getElementById("trip-end").value,
    },
    locations,
    fixedCommitments,
  };
}

// ── Submit → call the server → render ───────────────────────────────────
const form = document.getElementById("trip-form");
const generateBtn = document.getElementById("generate-btn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = collectInput();

  setStatus(
    "Generating your plan… this can take a minute or two — longer for multi-week, multi-city trips. Hang tight.",
    false,
  );
  resultsEl.hidden = true;
  generateBtn.disabled = true;

  try {
    const res = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Something went wrong.");

    renderPlan(data);
    statusEl.hidden = true;
    resultsEl.hidden = false;
    resultsEl.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    generateBtn.disabled = false;
  }
});

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
  statusEl.hidden = false;
}

// ── Rendering helpers ───────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

function ageBand(range) {
  if (!Array.isArray(range) || range.length < 2) return "all ages";
  return `ages ${range[0]}–${range[1]}`;
}

function renderPlan(plan) {
  renderSummary(plan.trip_summary);
  renderMenus(plan.idea_menus);
  renderItinerary(plan.itinerary);
}

function renderSummary(summary) {
  const el = document.getElementById("summary");
  const ages = (summary.kids || []).map((k) => k.age).join(", ");
  const locs = (summary.locations || [])
    .map((l) => `${escapeHtml(l.name)} (${l.start} → ${l.end})`)
    .join(", ");
  el.innerHTML = `
    <p><strong>Kids:</strong> ${escapeHtml(ages) || "—"}</p>
    <p><strong>Dates:</strong> ${summary.date_range?.start} → ${summary.date_range?.end}</p>
    <p><strong>Locations:</strong> ${locs || "—"}</p>
    <p><strong>Season notes:</strong> ${escapeHtml(summary.season_notes)}</p>`;
}

function renderMenus(menus) {
  const el = document.getElementById("menus");
  el.innerHTML = (menus || [])
    .map(
      (menu) => `
      <div class="card menu-card">
        <h3>${escapeHtml(menu.label)}</h3>
        ${(menu.ideas || [])
          .map(
            (idea) => `
          <div class="idea">
            <div class="idea-title">${escapeHtml(idea.title)}</div>
            <p class="idea-desc">${escapeHtml(idea.description)}</p>
            <div class="badges">
              <span class="badge">${ageBand(idea.good_for_ages)}</span>
              <span class="badge muted">${escapeHtml(idea.location)}</span>
              <span class="badge muted">${escapeHtml(idea.energy_level)} energy</span>
              <span class="badge muted">~${idea.duration_hours}h</span>
              ${idea.weather_dependent ? '<span class="badge muted">weather-dependent</span>' : ""}
            </div>
          </div>`,
          )
          .join("")}
      </div>`,
    )
    .join("");
}

function renderItinerary(days) {
  const el = document.getElementById("itinerary");
  el.innerHTML = (days || [])
    .map(
      (day) => `
      <div class="card day-card">
        <div class="day-head">
          <span class="day-date">${escapeHtml(day.date)}</span>
          <span class="day-loc">${escapeHtml(day.location)}</span>
        </div>
        <p class="day-summary">${escapeHtml(day.day_summary)}</p>
        ${(day.fixed_commitments || [])
          .map(
            (c) => `
          <div class="commitments">
            <strong>Fixed:</strong> ${c.time ? escapeHtml(c.time) + " — " : ""}${escapeHtml(c.title)}
          </div>`,
          )
          .join("")}
        ${(day.slots || [])
          .map(
            (slot) => `
          <div class="slot">
            <div class="slot-part">${escapeHtml(slot.part_of_day)}</div>
            <div>
              <div class="slot-activity">${escapeHtml(slot.activity_title)}</div>
              <div class="slot-why">${escapeHtml(slot.why)} · <em>${ageBand(slot.good_for_ages)}</em></div>
            </div>
          </div>`,
          )
          .join("")}
      </div>`,
    )
    .join("");
}
