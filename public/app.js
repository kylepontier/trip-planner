// ── Light / dark theme ──────────────────────────────────────────────────
// The initial theme is set by the inline script in <head> (from saved choice
// or OS preference). Here we handle the toggle button and keep following the
// OS until the user makes an explicit choice.
const themeToggle = document.getElementById("theme-toggle");
const osDark = window.matchMedia("(prefers-color-scheme: dark)");

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") || "light";
}
function paintToggle() {
  // Show the icon of the theme you'd switch TO.
  themeToggle.textContent = currentTheme() === "dark" ? "☀️" : "🌙";
}
function setTheme(theme, remember) {
  document.documentElement.setAttribute("data-theme", theme);
  if (remember) localStorage.setItem("theme", theme);
  paintToggle();
}

paintToggle();
themeToggle.addEventListener("click", () => {
  setTheme(currentTheme() === "dark" ? "light" : "dark", true);
});
// If the user hasn't chosen manually, keep mirroring the OS setting live.
osDark.addEventListener("change", (e) => {
  if (!localStorage.getItem("theme")) setTheme(e.matches ? "dark" : "light", false);
});

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
    // Slide from the centered "start here" form into the dashboard layout:
    // the inputs become a left rail and the results get the main stage.
    document.body.classList.add("has-plan");
    generateBtn.textContent = "Regenerate plan";
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

// Only allow http(s) links through — guards against javascript: etc. in a URL
// the model might produce. Returns "" for anything not a plain web URL.
function safeUrl(url) {
  const u = String(url || "").trim();
  return /^https?:\/\//i.test(u) ? u : "";
}

function ageBand(range) {
  if (!Array.isArray(range) || range.length < 2) return "all ages";
  return `ages ${range[0]}–${range[1]}`;
}

// View state for the results. Persists across tab/toggle clicks within a plan;
// reset when a new plan is rendered.
let activeMenuIndex = 0;
let activeCityIndex = 0;
let itineraryView = "calendar"; // "calendar" | "list"
let selectedDayIndex = 0;
let itineraryDays = [];
let planWeather = {}; // { "YYYY-MM-DD": {mode, tmax, tmin, icon, label} }

function renderPlan(plan) {
  activeMenuIndex = 0;
  activeCityIndex = 0;
  selectedDayIndex = 0;
  planWeather = plan.weather || {};
  renderSummary(plan.trip_summary);
  renderMenus(plan.idea_menus);
  renderItinerary(plan.itinerary);
}

// Parse a "YYYY-MM-DD" string as a LOCAL date (avoids the UTC shift that
// `new Date("2026-07-02")` would introduce, which can bump the weekday).
function parseDate(iso) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
}
function formatDateLong(iso) {
  return parseDate(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// Compact weather for a calendar cell (icon + high temp), or "" if none.
function weatherChip(dateIso) {
  const w = planWeather[dateIso];
  return w ? `<span class="cal-wx">${w.icon} ${w.tmax}°</span>` : "";
}

// Fuller weather line for a day's detail — high/low plus an honest label of
// whether it's a real forecast or a typical value for the dates.
function weatherLine(dateIso) {
  const w = planWeather[dateIso];
  if (!w) return "";
  const mode = w.mode === "forecast" ? "Forecast" : "Typical for the dates";
  const label = w.label ? escapeHtml(w.label) + " · " : "";
  return `<div class="wx-line">${w.icon} ${label}${w.tmax}° / ${w.tmin}°<span class="wx-mode">${mode}</span></div>`;
}

function renderSummary(summary) {
  const el = document.getElementById("summary");
  const ages = (summary.kids || []).map((k) => k.age);
  const kidsLabel = ages.length
    ? `${ages.length} ${ages.length === 1 ? "kid" : "kids"} · ages ${ages.join(", ")}`
    : "—";
  const locs =
    (summary.locations || []).map((l) => escapeHtml(l.name)).join("  →  ") || "—";

  el.innerHTML = `
    <div class="hero-eyebrow">Your trip plan</div>
    <div class="hero-stats">
      <div class="hero-stat">
        <span class="hero-stat-label">Travelers</span>
        <span class="hero-stat-value">${kidsLabel}</span>
      </div>
      <div class="hero-stat">
        <span class="hero-stat-label">Dates</span>
        <span class="hero-stat-value">${summary.date_range?.start} → ${summary.date_range?.end}</span>
      </div>
      <div class="hero-stat">
        <span class="hero-stat-label">Where</span>
        <span class="hero-stat-value">${locs}</span>
      </div>
    </div>
    <p class="hero-notes">${escapeHtml(summary.season_notes)}</p>`;
}

// One idea card. `showLocation` is false when the city is already conveyed by
// a selected city sub-tab (so the location badge would just be redundant).
function ideaHtml(idea, showLocation = true) {
  const link = safeUrl(idea.url);
  return `
    <div class="idea">
      <div class="idea-title">${escapeHtml(idea.title)}</div>
      <p class="idea-desc">${escapeHtml(idea.description)}</p>
      <div class="badges">
        <span class="badge">${ageBand(idea.good_for_ages)}</span>
        ${showLocation ? `<span class="badge muted">${escapeHtml(idea.location)}</span>` : ""}
        <span class="badge muted">${escapeHtml(idea.energy_level)} energy</span>
        <span class="badge muted">~${idea.duration_hours}h</span>
        ${idea.weather_dependent ? '<span class="badge muted">weather-dependent</span>' : ""}
      </div>
      ${link ? `<a class="ext-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">More info ↗</a>` : ""}
    </div>`;
}

// Group a category's ideas by city (location), preserving first-seen order.
function groupByCity(ideas) {
  const cities = [];
  const byCity = new Map();
  for (const idea of ideas || []) {
    const c = idea.location || "Other";
    if (!byCity.has(c)) {
      byCity.set(c, []);
      cities.push(c);
    }
    byCity.get(c).push(idea);
  }
  return { cities, byCity };
}

// Idea menus: PRIMARY tabs pick the activity type; if that type spans more than
// one city, SECONDARY city tabs de-bundle it so you see one city at a time.
function renderMenus(menus) {
  const el = document.getElementById("menus");
  const list = (menus || []).filter((m) => (m.ideas || []).length);
  if (!list.length) {
    el.innerHTML = "";
    return;
  }
  if (activeMenuIndex >= list.length) activeMenuIndex = 0;

  const category = list[activeMenuIndex];
  const { cities, byCity } = groupByCity(category.ideas);
  if (activeCityIndex >= cities.length) activeCityIndex = 0;
  const multiCity = cities.length > 1;

  const catTabs = list
    .map(
      (m, i) =>
        `<button type="button" class="tab ${i === activeMenuIndex ? "active" : ""}" data-menu-tab="${i}">${escapeHtml(m.label)}</button>`,
    )
    .join("");

  const cityTabs = multiCity
    ? `<div class="subtabs" role="tablist">${cities
        .map(
          (c, i) =>
            `<button type="button" class="subtab ${i === activeCityIndex ? "active" : ""}" data-city-tab="${i}">${escapeHtml(c)}</button>`,
        )
        .join("")}</div>`
    : "";

  const shown = multiCity ? byCity.get(cities[activeCityIndex]) : category.ideas;
  const ideas = shown.map((idea) => ideaHtml(idea, !multiCity)).join("");

  el.innerHTML = `
    <div class="tabs" role="tablist">${catTabs}</div>
    ${cityTabs}
    <div class="card tab-panel">${ideas}</div>`;

  el.querySelectorAll("[data-menu-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeMenuIndex = Number(btn.dataset.menuTab);
      activeCityIndex = 0; // reset city when the activity type changes
      renderMenus(menus);
    });
  });
  el.querySelectorAll("[data-city-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCityIndex = Number(btn.dataset.cityTab);
      renderMenus(menus);
    });
  });
}

// The inner content of a single day — shared by the list view and the
// calendar's detail panel so they never drift apart.
function dayDetailHtml(day) {
  return `
    <div class="day-head">
      <span class="day-date">${escapeHtml(formatDateLong(day.date))}</span>
      <span class="day-loc">${escapeHtml(day.location)}</span>
    </div>
    ${weatherLine(day.date)}
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
          ${safeUrl(slot.url) ? `<a class="ext-link" href="${escapeHtml(safeUrl(slot.url))}" target="_blank" rel="noopener noreferrer">More info ↗</a>` : ""}
        </div>
      </div>`,
      )
      .join("")}`;
}

// Itinerary with a Calendar ⇄ List toggle. Calendar is the default.
function renderItinerary(days) {
  itineraryDays = days || [];
  const el = document.getElementById("itinerary");
  el.innerHTML = `
    <div class="view-toggle" role="tablist">
      <button type="button" class="seg ${itineraryView === "calendar" ? "active" : ""}" data-view="calendar">📅 Calendar</button>
      <button type="button" class="seg ${itineraryView === "list" ? "active" : ""}" data-view="list">☰ List</button>
    </div>
    <div id="itinerary-body"></div>`;

  el.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      itineraryView = btn.dataset.view;
      renderItinerary(itineraryDays);
    });
  });

  const body = el.querySelector("#itinerary-body");
  if (itineraryView === "list") renderItineraryList(body);
  else renderItineraryCalendar(body);
}

function renderItineraryList(container) {
  container.innerHTML = itineraryDays
    .map((day) => `<div class="card day-card">${dayDetailHtml(day)}</div>`)
    .join("");
}

// A weekday-aligned grid of day cells + a detail panel. Click a day to see it.
function renderItineraryCalendar(container) {
  if (!itineraryDays.length) {
    container.innerHTML = "";
    return;
  }
  if (selectedDayIndex >= itineraryDays.length) selectedDayIndex = 0;

  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const headers = weekdays
    .map((d) => `<div class="cal-weekday">${d}</div>`)
    .join("");

  // Pad the start so day 1 lands under its real weekday column.
  const lead = parseDate(itineraryDays[0].date).getDay();
  const blanks = Array.from(
    { length: lead },
    () => `<div class="cal-cell blank"></div>`,
  ).join("");

  const cells = itineraryDays
    .map((day, i) => {
      const hasCommit = (day.fixed_commitments || []).length;
      return `
        <button type="button" class="cal-cell ${i === selectedDayIndex ? "selected" : ""}" data-day="${i}">
          <span class="cal-daynum">${parseDate(day.date).getDate()}</span>
          <span class="cal-loc">${escapeHtml(day.location)}</span>
          ${hasCommit ? '<span class="cal-dot" title="Has a fixed commitment"></span>' : ""}
          ${weatherChip(day.date)}
        </button>`;
    })
    .join("");

  container.innerHTML = `
    <div class="cal-layout">
      <div class="cal-grid-wrap">
        <div class="cal-grid cal-headers">${headers}</div>
        <div class="cal-grid cal-days">${blanks}${cells}</div>
      </div>
      <div class="card cal-detail" id="cal-detail"></div>
    </div>`;

  const detail = container.querySelector("#cal-detail");
  const paintDetail = () => {
    detail.innerHTML = dayDetailHtml(itineraryDays[selectedDayIndex]);
  };
  paintDetail();

  container.querySelectorAll("[data-day]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedDayIndex = Number(btn.dataset.day);
      container
        .querySelectorAll(".cal-cell")
        .forEach((c) => c.classList.remove("selected"));
      btn.classList.add("selected");
      paintDetail();
    });
  });
}
