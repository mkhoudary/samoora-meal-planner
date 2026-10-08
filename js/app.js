import { loadMeals } from "./db.js";
import { fastingStatus, formatRemaining } from "./fasting.js";
import {
  dayTarget,
  meterFor,
  ratingWords,
  surprisePair,
  weightFromRating,
} from "./planner.js";
import {
  LEVEL_LABELS,
  loadState,
  saveCheer,
  saveFasting,
  saveMealWeights,
  saveOnboarded,
  savePlans,
  savePresets,
  saveProfile,
  saveWeightLog,
  starterPresets,
} from "./storage.js";
import { idiomFor } from "./idioms.js";
import { playTicks, seedTick, tickHTML, writeTick } from "./tick.js";
import {
  baselineCalories,
  bmi,
  bmiBand,
  cmToFtIn,
  deficitWords,
  round2,
  clockLabel,
  formatWeight,
  ftInToCm,
  kgToLb,
  lbToKg,
} from "./units.js";

const CHEERS = [
  "Look at you, showing up for yourself. I'm proud of you, sis.",
  "That's my sister. One more check-in, and I'm right here with you.",
  "I don't need the number to be proud of you. I just love that you came back.",
  "You checked in. That's the whole win, sis.",
  "I'm smiling over here. You didn't have to, and you did.",
  "This stays between us, and I'm glad you trusted this little page.",
  "Another point on your chart. Quiet, steady, yours.",
  "Hi sis. I see you. That's enough for me.",
];

const PRIVACY = "Don't worry sis, I don't know these numbers, it's not sent anywhere.";
const STAYS = "This page has no account and no server, so your numbers never leave this browser.";

const state = {
  meals: [],
  screen: "loading",
  onboardStep: 1,
  error: "",
  formError: "",
  search: "",
  pickMode: false,
  draft: { lunch: null, dinner: null, relaxed: false },
  cheer: "",
  ratingDraft: {},
  ratingNote: "",
  justConfirmed: false,
  pairKey: "",
  weightForm: null,
  macrosOpen: false,
  deal: "",
  scrollTo: null,
  focusDate: "",
  locks: { lunch: false, dinner: false },
  dayNote: "",
};

const app = document.querySelector("#app");

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function fixed2(value) {
  return round2(value).toFixed(2);
}

function todayKey(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function shiftDate(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + days);
  return todayKey(date);
}

function tomorrowKey() {
  return shiftDate(todayKey(), 1);
}

function yesterdayKey() {
  return shiftDate(todayKey(), -1);
}

function planFor(date) {
  return state.plans.find((plan) => plan.date === date && plan.confirmedAt) || null;
}

function floorKey() {
  const dates = state.plans.map((plan) => plan.date).filter((date) => date && date < todayKey()).sort();
  return dates[0] || yesterdayKey();
}

function focusKey() {
  const focus = state.focusDate;
  if (!focus || focus > tomorrowKey()) return todayKey();
  return focus;
}

function aheadDay(date = focusKey()) {
  return date > todayKey();
}

function prettyDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const weekday = date.toLocaleDateString([], { weekday: "long" });
  const rest = date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
  return `${weekday} · ${rest}`;
}

function todayPlan() {
  return planFor(todayKey());
}

function anyRated(plan) {
  return Boolean(plan?.ratings?.lunch?.overall || plan?.ratings?.dinner?.overall);
}

function fullyRated(plan) {
  return Boolean(plan?.ratings?.lunch?.overall && plan?.ratings?.dinner?.overall);
}

function dayClosed(plan) {
  return Boolean(plan && (plan.finishedAt || fullyRated(plan)));
}

function confirmedPlans() {
  return state.plans
    .filter((plan) => plan.confirmedAt)
    .sort((a, b) => b.date.localeCompare(a.date));
}

function dedupePlans(plans) {
  const map = new Map();
  plans.forEach((plan) => {
    const previous = map.get(plan.date);
    if (!previous || String(plan.confirmedAt || "") >= String(previous.confirmedAt || "")) map.set(plan.date, plan);
  });
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function stamp(iso) {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function activePreset() {
  return state.presets.find((preset) => preset.id === state.activePresetId) || state.presets[0];
}

function findMeal(id) {
  return state.meals.find((meal) => meal.id === id) || null;
}

function tenth(value) {
  return Math.round(Number(value) * 10) / 10;
}

function weightBounds(unit) {
  return unit === "kg" ? { min: 40, max: 150 } : { min: 90, max: 330 };
}

function heightBounds(unit) {
  return unit === "kg"
    ? { cm: [140, 200] }
    : { feet: [4, 6], inches: [0, 11] };
}

function deficitMax(baseline) {
  const room = Math.floor(Number(baseline) || 0) - 1;
  return Math.max(0, Math.min(1000, room));
}

function formFromProfile(profile) {
  const unit = profile?.unit || "lb";
  const heightCm = profile?.heightCm || 165;
  const imperial = cmToFtIn(heightCm);
  const weightKg = profile?.weightKg || (unit === "lb" ? lbToKg(150) : 68);
  const bounds = weightBounds(unit);
  const height = heightBounds(unit);
  const weight = Math.min(bounds.max, Math.max(bounds.min, tenth(unit === "lb" ? kgToLb(weightKg) : weightKg)));
  return {
    unit,
    feet: Math.min(height.feet?.[1] ?? imperial.feet, Math.max(height.feet?.[0] ?? imperial.feet, profile ? imperial.feet : 5)),
    inches: Math.min(11, Math.max(0, profile ? imperial.inches : 5)),
    cm: Math.min(height.cm?.[1] ?? 200, Math.max(height.cm?.[0] ?? 140, Math.round(heightCm))),
    weight,
    calories: baselineCalories(weightKg, heightCm),
    deficit: Math.round(profile?.deficit ?? 300),
  };
}

function profileFromForm() {
  const unit = state.form.unit;
  const heightCm = unit === "kg"
    ? Number(state.form.cm)
    : ftInToCm(state.form.feet, state.form.inches);
  const weightKg = unit === "kg" ? Number(state.form.weight) : lbToKg(state.form.weight);
  return {
    unit,
    heightCm,
    weightKg,
    calories: baselineCalories(weightKg, heightCm),
    deficit: Number(state.form.deficit),
  };
}

function validateBody(profile, { requireWeight = true } = {}) {
  const height = heightBounds(profile.unit);
  const weight = weightBounds(profile.unit);
  if (profile.unit === "kg") {
    if (profile.heightCm < height.cm[0] || profile.heightCm > height.cm[1]) return "That height looks off. Want to check it?";
    if (requireWeight && (profile.weightKg < weight.min || profile.weightKg > weight.max)) return "That weight looks off. Want to check it?";
  } else {
    const { feet, inches } = cmToFtIn(profile.heightCm);
    if (feet < height.feet[0] || feet > height.feet[1] || inches < 0 || inches > 11) return "That height looks off. Want to check it?";
    const pounds = kgToLb(profile.weightKg);
    if (requireWeight && (pounds < weight.min || pounds > weight.max)) return "That weight looks off. Want to check it?";
  }
  if (profile.deficit < 0 || profile.deficit > deficitMax(profile.calories)) return "Leave yourself something to eat, sis. The deficit has to stay under your baseline.";
  return "";
}

function host(src, html) {
  return `<div class="host"><img src="./assets/characters/${src}.png" alt="Mohammed"><div class="bubble">${html}</div></div>`;
}

function privacyBlock() {
  return `<p class="privacy">${PRIVACY}</p><p class="quiet">${STAYS}</p>`;
}

function footer() {
  return `<p class="footer">Made with Love by Mohammed</p>`;
}

function header() {
  const item = (action, label) =>
    `<button class="ghost" type="button" data-action="${action}" aria-pressed="${state.screen === action}">${label}</button>`;
  return `<header class="top"><button class="logo-btn" type="button" data-action="home" aria-label="Home"><img class="logo" src="./assets/logo.png" alt="Samoora Meal Planner"></button><nav>
    ${item("home", "Home")}
    ${item("planner", "Planner")}
    ${item("history", "History")}
    ${item("prefs", "Preferences")}
    ${item("weight", "Weight")}
  </nav></header>`;
}

function backBar() {
  return `<div class="backbar">
    <button class="primary" type="button" data-action="planner">Back to planner</button>
    <button class="ghost" type="button" data-action="home">Home</button>
  </div>`;
}

function canShiftYesterday(date) {
  return shiftDate(date, -1) >= floorKey();
}

function dayNav(date = focusKey()) {
  const onHome = state.screen === "home";
  const viewing = onHome ? todayKey() : date;
  const button = (day, label, pressed, enabled) =>
    `<button class="ghost" type="button" data-action="shift-day" data-day="${day}" aria-pressed="${pressed}" ${enabled ? "" : "disabled"}>${label}</button>`;
  return `<div class="day-nav" role="group" aria-label="Days">
    ${button("yesterday", "Yesterday", !onHome && viewing === yesterdayKey(), canShiftYesterday(viewing))}
    ${button("today", "Today", onHome || viewing === todayKey(), true)}
    ${button("tomorrow", "Tomorrow", !onHome && viewing === tomorrowKey(), viewing < tomorrowKey())}
  </div>`;
}

function goDay(which) {
  const current = state.screen === "home" ? todayKey() : focusKey();
  let next = todayKey();
  if (which === "yesterday") {
    next = shiftDate(current, -1);
    if (next < floorKey()) return;
  } else if (which === "tomorrow") {
    if (current >= tomorrowKey()) return;
    next = shiftDate(current, 1);
  }
  const stayOnHistory = state.screen === "history" && which === "yesterday";
  showDate(next);
  state.dayNote = "";
  state.screen = stayOnHistory ? "history" : "planner";
  state.scrollTo = "top";
  render();
}

const MACRO_LIMITS = {
  protein: [80, 120],
  carbs: [30, 40],
  fat: [50, 70],
};

function calorieCap() {
  return Math.max(0, Math.floor(liveTarget()));
}

function rangeBounds(key) {
  if (key === "cal") return [0, calorieCap()];
  return MACRO_LIMITS[key];
}

function clampWindow(stored, min, max) {
  let low = Math.round(Number(stored?.[0]));
  let high = Math.round(Number(stored?.[1]));
  if (!Number.isFinite(low) || !Number.isFinite(high)) return [min, max];
  if ((low < min && high <= min) || (low >= max && high > max) || (low <= min && high >= max)) return [min, max];
  low = Math.min(max, Math.max(min, low));
  high = Math.min(max, Math.max(min, high));
  if (low > high) return [high, low];
  return [low, high];
}

function sanitizePreset(preset) {
  const cap = calorieCap();
  if (cap > 0) {
    let low = Math.round(Number(preset.cal?.[0]));
    let high = Math.round(Number(preset.cal?.[1]));
    if (!Number.isFinite(low) || low < 0) low = 0;
    if (!Number.isFinite(high) || high <= 0 || preset.calChosen !== true) high = cap;
    high = Math.min(cap, high);
    low = Math.min(high, Math.max(0, low));
    preset.cal = [low, high];
  }
  Object.entries(MACRO_LIMITS).forEach(([key, [min, max]]) => {
    preset[key] = clampWindow(preset[key], min, max);
  });
}

function knobShift(value, min, max) {
  const span = Math.max(1, max - min);
  const pct = (value - min) / span;
  return `calc(${(pct * 100).toFixed(4)}% - ${(pct * 22).toFixed(2)}px)`;
}

function macroField(key, label) {
  const [min, max] = rangeBounds(key);
  const range = activePreset()[key];
  const low = Math.min(max, Math.max(min, Math.round(range[0])));
  const high = Math.min(max, Math.max(low, Math.round(range[1])));
  const span = Math.max(1, max - min);
  const fillLeft = ((low - min) / span) * 100;
  const fillWidth = ((high - low) / span) * 100;
  const knob = (end, value) => `<button type="button" class="knob" data-range="${key}" data-end="${end}" role="slider" aria-label="${label} ${end === 0 ? "from" : "to"}" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${value}" aria-orientation="horizontal" style="left:${knobShift(value, min, max)}"></button>`;
  const scaleMax = key === "cal" ? tickHTML("cal-cap", max, 0) : String(max);
  return `<div class="macro"><strong>${label}</strong>
    <div class="duo-read">${tickHTML(`${key}-min`, low, 0)}<span class="duo-dash">–</span>${tickHTML(`${key}-max`, high, 0)}</div>
    <div class="duo" data-duo="${key}">
      <div class="duo-rail"><div class="duo-fill" style="left:${fillLeft}%;width:${fillWidth}%"></div></div>
      ${knob(0, low)}
      ${knob(1, high)}
    </div>
    <div class="duo-scale"><span>${min}</span><span>${scaleMax}</span></div>
  </div>`;
}

function levelField(key, label, image) {
  const value = ["none", "less", "normal", "more"].indexOf(activePreset()[key]);
  const index = value < 0 ? 2 : value;
  return `<div class="level"><img src="./assets/characters/${image}.png" alt="">
    <div><div class="pref-label"><strong>${label}</strong> · <span id="${key}Word">${LEVEL_LABELS[index]}</span></div>
      <input type="range" min="0" max="3" step="1" value="${index}" data-level="${key}" aria-label="${label}">
      <div class="ticks"><span>None</span><span>Less</span><span>Normal</span><span>More</span></div>
    </div></div>`;
}

function presetEditor() {
  state.presets.forEach((preset) => sanitizePreset(preset));
  const preset = activePreset();
  const heavier = preset.heavier;
  const chips = state.presets.map((item) =>
    `<button type="button" class="ghost" data-action="use-preset" data-id="${esc(item.id)}" aria-pressed="${item.id === preset.id}">${esc(item.name)}</button>`
  ).join("");
  return `<div class="card"><div class="row">${chips}</div>
    <label style="margin-top:12px">Preset name
      <input id="presetName" type="text" value="${esc(preset.name)}" data-preset-name="1">
    </label>
    <div class="macros" style="margin-top:12px">
      ${macroField("cal", "Calories")}
      ${macroField("protein", "Protein (g)")}
      ${macroField("carbs", "Carbs (g)")}
      ${macroField("fat", "Fat (g)")}
    </div>
    <h3 style="margin-top:16px">Which meal is heavier?</h3>
    <div class="choice row">
      ${["lunch", "even", "dinner"].map((value) => {
        const label = value === "lunch" ? "Lunch heavier" : value === "dinner" ? "Dinner heavier" : "Split evenly";
        return `<button type="button" data-action="heavier" data-value="${value}" aria-pressed="${heavier === value}">${label}</button>`;
      }).join("")}
    </div>
    <h3>How often</h3>
    <p class="quiet">This is for the whole day, lunch and dinner together.</p>
    <div class="levels">
      ${levelField("fish", "Fish", "avocado-salmon")}
      ${levelField("chicken", "Chicken", "chicken")}
      ${levelField("meat", "Meat", "grocery")}
      ${levelField("veggies", "Veggies", "chopping")}
    </div>
    <div class="row" style="margin-top:14px">
      <button class="ghost" type="button" data-action="copy-preset">Save a copy</button>
    </div></div>`;
}

function fastingFields() {
  const fasting = state.fasting;
  const hours = Number(fasting.hours) || 16;
  return `<div class="card"><div class="choice row">
      <button type="button" data-action="fast-on" data-value="1" aria-pressed="${fasting.on ? "true" : "false"}">I fast</button>
      <button type="button" data-action="fast-on" data-value="0" aria-pressed="${fasting.on ? "false" : "true"}">Not right now</button>
    </div>
    ${fasting.on ? `<div class="fields" style="margin-top:12px">
      <div class="choice row">
        ${[14, 16, 18].map((hour) => `<button type="button" data-action="fast-hours" data-value="${hour}" aria-pressed="${hours === hour}">${hour} hours</button>`).join("")}
      </div>
      <label><span>Fast length ${tickHTML("fast-hours", hours, 0)} hours</span>
        <input type="range" min="12" max="20" step="1" value="${Math.round(hours)}" data-fast-hours="1">
      </label>
      <label>Eating window opens
        <input type="time" value="${esc(fasting.windowStartsAt || "12:00")}" data-window="1">
      </label>
      <p>You fast ${tickHTML("fast-hours", hours, 0)} hours, then eat for ${tickHTML("eat-hours", 24 - hours, 0)}, starting at ${esc(clockLabel(fasting.windowStartsAt))}.</p>
    </div>` : `<p class="quiet">The app stays in the warm eating look.</p>`}
  </div>`;
}

function liveTarget() {
  if (state.form && (state.screen === "prefs" || state.screen === "onboard")) {
    const profile = profileFromForm();
    return Math.max(0, round2((profile.calories || 0) - Number(profile.deficit || 0)));
  }
  return Math.max(0, dayTarget(state.profile));
}

function clampCalMax() {
  state.presets.forEach((preset) => sanitizePreset(preset));
}

function planningPreset() {
  const preset = activePreset();
  const copy = {
    ...preset,
    cal: [...preset.cal],
    protein: [...preset.protein],
    carbs: [...preset.carbs],
    fat: [...preset.fat],
  };
  sanitizePreset(copy);
  return copy;
}

function paintDuo(key) {
  const duo = document.querySelector(`[data-duo="${key}"]`);
  const preset = activePreset();
  if (!duo || !preset) return;
  const [min, max] = rangeBounds(key);
  const low = Math.round(preset[key][0]);
  const high = Math.round(preset[key][1]);
  const span = Math.max(1, max - min);
  duo.querySelectorAll(".knob").forEach((knob) => {
    const end = Number(knob.dataset.end);
    const value = end === 0 ? low : high;
    knob.style.left = knobShift(value, min, max);
    knob.setAttribute("aria-valuemin", String(min));
    knob.setAttribute("aria-valuemax", String(max));
    knob.setAttribute("aria-valuenow", String(value));
    knob.style.zIndex = duo.dataset.activeEnd === String(end) ? "4" : end === 1 ? "3" : "2";
  });
  const fill = duo.querySelector(".duo-fill");
  fill.style.left = `${((low - min) / span) * 100}%`;
  fill.style.width = `${((high - low) / span) * 100}%`;
  const minOut = document.querySelector(`[data-tick="${key}-min"]`);
  const maxOut = document.querySelector(`[data-tick="${key}-max"]`);
  if (minOut) writeTick(minOut, low);
  if (maxOut) writeTick(maxOut, high);
  if (key === "cal") {
    const capOut = document.querySelector('[data-tick="cal-cap"]');
    if (capOut) writeTick(capOut, max);
  }
}

function paintCalMax() {
  const preset = activePreset();
  const cap = calorieCap();
  if (!preset || !(cap > 0) || !document.querySelector('[data-duo="cal"]')) return;
  sanitizePreset(preset);
  paintDuo("cal");
}

function pictureBlock() {
  clampCalMax();
  const profile = profileFromForm();
  const picture = bmi(profile.weightKg, profile.heightCm);
  const shown = picture ? round2(picture) : 0;
  const band = bmiBand(shown);
  const baseline = profile.calories || 0;
  const deficit = Math.max(0, Math.min(deficitMax(baseline), Math.round(state.form.deficit)));
  const target = Math.max(0, round2(baseline - deficit));
  const scaleMin = 15;
  const scaleSpan = 25;
  const pin = shown ? Math.min(100, Math.max(0, ((shown - scaleMin) / scaleSpan) * 100)) : null;
  const zones = [18.5, 25, 30, 40].map((edge, index, edges) => {
    const start = index === 0 ? scaleMin : edges[index - 1];
    return ((edge - start) / scaleSpan) * 100;
  });
  const keep = baseline > 0 ? Math.min(1, target / baseline) : 0;
  const cut = deficitWords(deficit, baseline);
  const label = shown ? `BMI ${fixed2(shown)}, ${band.name}. Day maximum ${fixed2(target)} calories. Deficit ${cut.name}.` : "Add height and weight.";
  return `<div class="bmi-board" role="img" aria-label="${esc(label)}">
    <div class="bmi-read"><span class="kicker">BMI</span><strong class="band-${band.id}">${shown ? tickHTML("bmi", shown) : "—"}</strong><em class="band-${band.id}">${band.name}</em></div>
    <div class="bmi-scale">
      <div class="bmi-zones">${zones.map((width, index) => `<span class="z${index + 1}" style="width:${width}%"></span>`).join("")}</div>
      ${pin === null ? "" : `<i class="bmi-pin band-${band.id}" style="left:${pin}%"></i>`}
    </div>
    <div class="bmi-marks"><span style="left:14%">18.50</span><span style="left:40%">25.00</span><span style="left:60%">30.00</span></div>
    <div class="energy">
      <div class="energy-track" aria-hidden="true"><span class="energy-keep" style="width:${keep * 100}%"></span><span class="energy-cut" style="width:${(1 - keep) * 100}%"></span></div>
      <div class="energy-fig">${target > 0 ? tickHTML("day-target", target) : "—"}<small>max</small></div>
    </div>
    <div class="energy-notes"><span>${baseline ? tickHTML("baseline", baseline) : "—"}</span><span>− ${tickHTML("deficit-show", deficit, 0)} · <em class="cut-${cut.id}">${cut.name}</em></span></div>
  </div>`;
}

function bodySlider(key, label, min, max, value, digits = 0) {
  const shown = digits ? tenth(value) : Math.round(value);
  return `<label><span>${label} ${tickHTML(`form-${key}`, shown, digits)}</span>
    <input type="range" min="${min}" max="${max}" step="${digits ? "0.1" : "1"}" value="${digits ? shown.toFixed(1) : shown}" data-form="${key}">
  </label>`;
}

function bodyFields({ weight = true } = {}) {
  const form = state.form;
  const imperial = form.unit === "lb";
  const height = heightBounds(form.unit);
  const bounds = weightBounds(form.unit);
  const profile = profileFromForm();
  const maxCut = deficitMax(profile.calories);
  const deficit = Math.min(maxCut, Math.max(0, Math.round(form.deficit)));
  const cut = deficitWords(deficit, profile.calories);
  return `<div class="fields">
    <div class="choice row">
      <button type="button" data-action="unit" data-value="lb" aria-pressed="${imperial}">Pounds</button>
      <button type="button" data-action="unit" data-value="kg" aria-pressed="${!imperial}">Kilograms</button>
    </div>
    ${imperial
      ? `<div class="split">${bodySlider("feet", "Feet", height.feet[0], height.feet[1], form.feet)}${bodySlider("inches", "Inches", height.inches[0], height.inches[1], form.inches)}</div>`
      : bodySlider("cm", "Height in centimeters", height.cm[0], height.cm[1], form.cm)}
    ${weight
      ? bodySlider("weight", `Weight in ${imperial ? "pounds" : "kilograms"}`, bounds.min, bounds.max, form.weight, 1)
      : `<p>Latest weight: <strong>${tickHTML("latest-weight", tenth(form.unit === "lb" ? kgToLb(state.profile.weightKg) : state.profile.weightKg), 1, ` ${form.unit}`)}</strong></p>`}
    <label><span>Deficit ${tickHTML("form-deficit", deficit, 0)} · <em id="deficitWord" class="cut-${cut.id}">${cut.name}</em></span>
      <input id="deficit" type="range" min="0" max="${maxCut}" step="1" value="${deficit}" data-form="deficit">
    </label>
    <div class="bmi">${pictureBlock()}</div>
    ${state.formError ? `<p class="warn" id="form-error">${esc(state.formError)}</p>` : ""}
  </div>`;
}

function cookLink(meal) {
  if (!meal?.url) return "";
  return `<div class="cook-row"><a class="primary" href="${esc(meal.url)}" target="_blank" rel="noopener">View on CookUnity</a></div>`;
}

function nutrientBits(meal) {
  if (!meal) return { calories: 0, protein: 0, carbs: 0, fat: 0 };
  return {
    calories: Number(meal.calories) || 0,
    protein: Number(meal.protein) || 0,
    carbs: Number(meal.carbs) || 0,
    fat: Number(meal.fat) || 0,
  };
}

function addNutrients(left, right) {
  return {
    calories: left.calories + right.calories,
    protein: left.protein + right.protein,
    carbs: left.carbs + right.carbs,
    fat: left.fat + right.fat,
  };
}

function nutrientCells(bits, prefix, empty = false) {
  if (empty) return "<td>—</td><td>—</td><td>—</td><td>—</td>";
  return `<td>${tickHTML(`${prefix}-cal`, bits.calories)}</td><td>${tickHTML(`${prefix}-protein`, bits.protein)}g</td><td>${tickHTML(`${prefix}-carbs`, bits.carbs)}g</td><td>${tickHTML(`${prefix}-fat`, bits.fat)}g</td>`;
}

function macrosPanel(lunch, dinner) {
  const lunchBits = nutrientBits(lunch);
  const dinnerBits = nutrientBits(dinner);
  const day = addNutrients(lunchBits, dinnerBits);
  return `<section class="card macro-detail" id="macro-detail">
    <table class="macro-table">
      <thead><tr><th>Meal</th><th>Calories</th><th>Protein</th><th>Carbs</th><th>Fat</th></tr></thead>
      <tbody>
        <tr><th>Lunch${lunch ? ` · ${esc(lunch.name)}` : ""}</th>${nutrientCells(lunchBits, "lunch", !lunch)}</tr>
        <tr><th>Dinner${dinner ? ` · ${esc(dinner.name)}` : ""}</th>${nutrientCells(dinnerBits, "dinner", !dinner)}</tr>
        <tr class="day"><th>Full day</th>${nutrientCells(day, "day", !lunch && !dinner)}</tr>
      </tbody>
    </table>
  </section>`;
}

function ratingSummary(rating, prefix) {
  if (!rating?.overall) return `<p class="quiet">Waiting for a rating</p>`;
  const filled = "★".repeat(rating.overall);
  const empty = "☆".repeat(5 - rating.overall);
  return `<p class="stars-read" aria-label="${rating.overall} of 5">${filled}${empty}</p>
    <p class="note">Delicious ${tickHTML(`${prefix}-delicious`, rating.delicious)} · Full ${tickHTML(`${prefix}-full`, rating.full)} · Again ${tickHTML(`${prefix}-again`, rating.again)}</p>
    <p class="note">${esc(ratingWords(weightFromRating(rating)))}</p>`;
}

function tagRow(text, kind) {
  const items = String(text || "").split(";").map((item) => item.trim()).filter(Boolean);
  if (!items.length) return "";
  return `<div class="pills ${kind}">${items.map((item) => `<span>${esc(item)}</span>`).join("")}</div>`;
}

function mealSkeleton(slot, height) {
  const bars = (count) => Array.from({ length: count }, () => `<span class="bone"></span>`).join("");
  return `<article class="meal skeleton" style="min-height:${height}px" aria-hidden="true">
    <p class="slot">${slot}</p>
    <span class="bone bone-title"></span>
    <span class="bone bone-line"></span>
    <div class="stats">${bars(4)}</div>
    <div class="pills">${bars(3)}</div>
    <span class="bone bone-line"></span>
    <div class="cook-row"><span class="bone bone-btn"></span></div>
  </article>`;
}

function withMealHeight(html, height) {
  return html.replace("<article class=\"meal\"", `<article class="meal" style="min-height:${height}px"`);
}

function mealHeights(lunch, dinner, width) {
  const probe = document.createElement("div");
  probe.className = "meals";
  probe.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;left:-10000px;top:0;width:${width}px`;
  probe.innerHTML = `${mealCard(lunch, "Lunch", { lockable: true })}${mealCard(dinner, "Dinner", { lockable: true })}`;
  document.body.appendChild(probe);
  const heights = [...probe.querySelectorAll(".meal")].map((card) => Math.ceil(card.offsetHeight));
  probe.remove();
  return heights;
}

let surpriseTimer = 0;

function paintSurprise(token) {
  const meals = document.querySelector("#planner-meals");
  if (!meals) return false;
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  const lunch = state.draft.lunch;
  const dinner = state.draft.dinner;
  const meterRoot = document.getElementById("plan-meter");
  if (meterRoot) {
    const fresh = document.createElement("div");
    fresh.innerHTML = meterHTML(round2((lunch?.calories || 0) + (dinner?.calories || 0)));
    const nextHost = fresh.querySelector(".host");
    const nextMeter = fresh.querySelector(".meter");
    const host = meterRoot.querySelector(".host");
    const meter = meterRoot.querySelector(".meter");
    if (host && nextHost) {
      const face = host.querySelector("img");
      const nextFace = nextHost.querySelector("img");
      if (face && nextFace && face.getAttribute("src") !== nextFace.getAttribute("src")) face.src = nextFace.getAttribute("src");
      const bubble = host.querySelector(".bubble");
      const nextBubble = nextHost.querySelector(".bubble");
      if (bubble && nextBubble) bubble.innerHTML = nextBubble.innerHTML;
    }
    if (meter && nextMeter) {
      meter.className = nextMeter.className;
      meter.innerHTML = nextMeter.innerHTML;
    }
    playTicks(meterRoot);
  }
  if (state.macrosOpen && document.getElementById("macro-detail")) {
    document.getElementById("macro-detail").outerHTML = macrosPanel(lunch, dinner);
    playTicks(document.getElementById("macro-detail"));
  }
  const confirm = document.querySelector("#plan-actions [data-action='confirm']");
  if (confirm) confirm.disabled = !(lunch && dinner && lunch.id !== dinner.id);
  document.getElementById("pick-panel")?.remove();
  const pick = document.querySelector("[data-action='pick-mode']");
  if (pick) pick.setAttribute("aria-pressed", "false");
  const idiomHost = document.querySelector(".idiom")?.closest(".host");
  const face = idiomHost?.querySelector("img");
  if (face) face.src = "./assets/characters/chef.png";
  const next = mealHeights(lunch, dinner, meals.getBoundingClientRect().width);
  const current = [...meals.querySelectorAll(".meal")].map((card) => Math.ceil(card.offsetHeight));
  const hold = next.map((height, index) => Math.max(height, current[index] || 0));
  const reveal = () => {
    if (state.dealToken !== token || !document.querySelector("#planner-meals")) return;
    const box = document.querySelector("#planner-meals");
    box.innerHTML = `${withMealHeight(mealCard(lunch, "Lunch", { lockable: true }), hold[0])}${withMealHeight(mealCard(dinner, "Dinner", { lockable: true }), hold[1])}`;
    box.classList.remove("loading");
    state.deal = "";
    playTicks(box);
    const detail = document.getElementById("macro-detail");
    if (detail) playTicks(detail);
  };
  window.clearTimeout(surpriseTimer);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    reveal();
    return true;
  }
  meals.classList.add("loading");
  meals.innerHTML = `${mealSkeleton("Lunch", hold[0])}${mealSkeleton("Dinner", hold[1])}`;
  const shufflingOne = state.locks.lunch !== state.locks.dinner && (state.locks.lunch || state.locks.dinner);
  const note = state.draft.relaxed
    ? "This is the closest pair I could find."
    : state.deal === "again" ? (shufflingOne ? "Another meal." : "Another pair.") : "";
  document.querySelector(".deal-note")?.remove();
  if (note) {
    const flag = document.createElement("p");
    flag.className = "banner deal-note";
    flag.textContent = note;
    meals.parentElement.appendChild(flag);
  }
  surpriseTimer = window.setTimeout(() => {
    document.querySelector(".deal-note")?.remove();
    reveal();
  }, 420);
  return true;
}

function mealCard(meal, slot, { rating = undefined, scope = "", lockable = false } = {}) {
  const key = slot.toLowerCase();
  const locked = Boolean(state.locks?.[key]);
  const lock = lockable && meal
    ? `<button class="tiny lock" type="button" data-action="lock-meal" data-slot="${key}" aria-pressed="${locked ? "true" : "false"}">${locked ? "Unlock" : "Lock"}</button>`
    : "";
  const slotRow = `<div class="slot-row"><p class="slot">${slot}</p>${lock}</div>`;
  if (!meal) {
    return `<article class="meal">${slotRow}<p class="quiet">Nothing here yet.</p></article>`;
  }
  const prefix = `${scope}${slot.toLowerCase()}`;
  const pills = String(meal.categories || "").split(";").map((item) => item.trim()).filter(Boolean).slice(0, 6);
  return `<article class="meal">${slotRow}<h3>${esc(meal.name)}</h3>
    <p class="quiet">${esc(meal.chef || "CookUnity")}</p>
    <div class="stats">
      <span>${tickHTML(`${prefix}-cal`, meal.calories)} cal</span>
      <span>${tickHTML(`${prefix}-protein`, meal.protein)}g protein</span>
      <span>${tickHTML(`${prefix}-carbs`, meal.carbs)}g carbs</span>
      <span>${tickHTML(`${prefix}-fat`, meal.fat)}g fat</span>
    </div>
    <div class="pills">${pills.map((pill) => `<span>${esc(pill)}</span>`).join("")}</div>
    ${tagRow(meal.cookunity_labels, "")}
    ${tagRow(meal.nutrition_labels, "macros")}
    ${rating !== undefined ? ratingSummary(rating, prefix) : ""}
    ${cookLink(meal)}
  </article>`;
}

function meterHTML(total) {
  const target = dayTarget(state.profile);
  const meter = meterFor(total, target);
  const width = target ? Math.min(100, Math.round((total / target) * 100)) : 0;
  const delta = round2((total || 0) - target);
  const pose = meter.tone === "green" ? "thumbs" : meter.tone === "gold" ? "thinking" : meter.tone === "red" ? "calm" : "clipboard";
  const line = meter.tone === "green"
    ? "You're inside the plan. I like this."
    : meter.tone === "gold"
      ? "Close. A little over, and you can still change one."
      : meter.tone === "red"
        ? "You're past the number. That's information, not a scolding. You can swap a meal."
        : "Two meals, one day. You're holding the plan.";
  let title = esc(meter.title);
  let detail = esc(meter.detail);
  if (!target) {
    title = "Set your day first";
    detail = "";
  } else if (!total) {
    title = `Your day is ${tickHTML("meter-target", target)} calories`;
    detail = "Lunch and dinner together.";
  } else if (delta <= 0) {
    title = delta === 0 ? "Right on your plan" : "In plan";
    detail = delta === 0
      ? "Lunch and dinner land on your number."
      : `${tickHTML("meter-left", Math.abs(delta))} calories left`;
  } else if (delta <= target * 0.1) {
    title = "A little over";
    detail = `${tickHTML("meter-over", delta)} calories over`;
  } else {
    title = "Over";
    detail = `${tickHTML("meter-over", delta)} calories over`;
  }
  return `${host(pose, `<p class="privacy">${esc(line)}</p>`)}
    <div class="meter ${meter.tone}" role="status"><strong>${title}</strong><span>${detail}</span>
      ${total ? `<div class="bar"><span style="width:${width}%"></span></div>` : ""}</div>`;
}

function resultRow(meal, extra = "") {
  return `<div class="result">
    <div><strong>${esc(meal.name)}</strong><div class="quiet">${fixed2(meal.calories)} cal · ${esc(meal.chef || "")}${extra}</div></div>
    <div class="row">
      <button class="tiny" type="button" data-action="assign" data-slot="lunch" data-id="${meal.id}">Lunch</button>
      <button class="tiny" type="button" data-action="assign" data-slot="dinner" data-id="${meal.id}">Dinner</button>
    </div></div>`;
}

function eatenHistoryHTML() {
  const seen = new Set();
  const rows = [];
  confirmedPlans().forEach((plan) => {
    [["lunch", plan.lunchId], ["dinner", plan.dinnerId]].forEach(([slot, id]) => {
      if (seen.has(id)) return;
      const meal = findMeal(id);
      if (!meal) return;
      seen.add(id);
      rows.push({ meal, date: plan.date, slot });
    });
  });
  if (!rows.length) return `<p class="quiet">Meals you confirm will gather here, ready to choose again.</p>`;
  const shown = rows.slice(0, 40);
  return `<h3>Meals you've eaten</h3><p class="quiet">Pick one of these for today, or search the whole menu below.</p>
    ${shown.length < rows.length ? `<p class="quiet">Showing ${shown.length} of ${rows.length}</p>` : ""}
    ${shown.map((row) => resultRow(row.meal, ` · ${esc(prettyDate(row.date))}`)).join("")}`;
}

function resultsHTML() {
  const query = state.search.trim().toLowerCase();
  const matches = state.meals.filter((meal) => {
    if (!query) return true;
    return `${meal.name} ${meal.chef}`.toLowerCase().includes(query);
  });
  const shown = matches.slice(0, 30);
  if (!shown.length) return `<p class="quiet">I couldn't find that one.</p>`;
  return `<p class="quiet">Showing ${tickHTML("search-shown", shown.length)} of ${tickHTML("search-total", matches.length)}</p>` + shown.map((meal) => resultRow(meal)).join("");
}

function stars(planDate, slot, field, current) {
  return `<div class="stars">${[1, 2, 3, 4, 5].map((value) =>
    `<button type="button" class="${current >= value ? "on" : ""}" data-action="rate" data-plan="${esc(planDate)}" data-slot="${slot}" data-field="${field}" data-value="${value}" aria-label="${value} of 5">${value <= (current || 0) ? "★" : "☆"}</button>`
  ).join("")}</div>`;
}

function ratingCard(plan, { heading = true } = {}) {
  if (plan.date > todayKey()) {
    return `<p class="warn" id="rating-note">You can only rate tomorrow.</p>`;
  }
  state.ratingDraft[plan.date] = state.ratingDraft[plan.date] || { lunch: {}, dinner: {} };
  const lunch = findMeal(plan.lunchId);
  const dinner = findMeal(plan.dinnerId);
  const block = (slot, meal) => {
    if (plan.ratings?.[slot]?.overall) {
      const weight = state.mealWeights[meal?.id] || 1;
      return `<p><strong>${esc(meal?.name || slot)}</strong> is saved. ${esc(ratingWords(weight))}</p>`;
    }
    const draft = state.ratingDraft[plan.date][slot] || {};
    const ready = draft.overall && draft.delicious && draft.full && draft.again;
    const preview = ready
      ? ratingWords(weightFromRating(draft))
      : "Your stars tell me what to offer next. Higher brings a meal forward. Lower tucks it back.";
    return `<div><h3>${esc(meal?.name || slot)}</h3>
      <p>How was it?</p>${stars(plan.date, slot, "overall", draft.overall)}
      <p>How delicious</p>${stars(plan.date, slot, "delicious", draft.delicious)}
      <p>How full did it make you</p>${stars(plan.date, slot, "full", draft.full)}
      <p>Will you have it again</p>${stars(plan.date, slot, "again", draft.again)}
      <p class="note">${esc(preview)}</p>
      <button class="primary" type="button" data-action="save-rating" data-plan="${esc(plan.date)}" data-slot="${slot}">Save this rating</button>
    </div>`;
  };
  return `<section class="${heading ? "card ratings" : "rate-block ratings"}">${heading ? `<h2>${esc(prettyDate(plan.date))}</h2>` : ""}${block("lunch", lunch)}${block("dinner", dinner)}</section>`;
}

function chartSVG(log, unit = state.profile.unit) {
  const points = log.map((entry) => ({
    at: new Date(entry.at),
    value: unit === "lb" ? kgToLb(entry.kg) : entry.kg,
    label: `${stamp(entry.at)} · ${formatWeight(entry.kg, unit)}`,
  }));
  const width = 640;
  const height = 280;
  const pad = 48;
  const min = Math.min(...points.map((point) => point.value)) - 1;
  const max = Math.max(...points.map((point) => point.value)) + 1;
  const minTime = points[0].at.getTime();
  const maxTime = points[points.length - 1].at.getTime() || minTime + 1;
  const xOf = (time) => points.length === 1
    ? width / 2
    : pad + ((time - minTime) / (maxTime - minTime)) * (width - pad * 2);
  const yOf = (value) => height - pad - ((value - min) / (max - min || 1)) * (height - pad * 2);
  const line = points.map((point, index) => `${index ? "L" : "M"} ${xOf(point.at.getTime()).toFixed(1)} ${yOf(point.value).toFixed(1)}`).join(" ");
  const labeled = new Set();
  const taken = [];
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const wanted = points.length <= 6 || index === 0 || index === points.length - 1;
    if (!wanted) continue;
    const x = xOf(points[index].at.getTime());
    if (taken.some((prior) => Math.abs(prior - x) < 120)) continue;
    labeled.add(index);
    taken.push(x);
  }
  const dots = points.map((point, index) => {
    const last = index === points.length - 1;
    const x = xOf(point.at.getTime());
    const y = yOf(point.value);
    return `<circle cx="${x}" cy="${y}" r="${last ? 7 : 5}" fill="${last ? "#c4623a" : "#5f8f62"}"><title>${esc(point.label)}</title></circle>
      ${labeled.has(index) ? `<text class="tick" data-tick="log-${point.at.getTime()}" data-value="${tenth(point.value)}" data-digits="1" data-suffix=" ${unit}" x="${x}" y="${y - 28}" text-anchor="middle">${esc(`${tenth(point.value).toFixed(1)} ${unit}`)}</text><text x="${x}" y="${y - 14}" text-anchor="middle">${esc(stamp(point.at))}</text>` : ""}`;
  }).join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Weight over time">
    <path d="${line}" fill="none" stroke="#c4623a" stroke-width="3"/>
    ${dots}
  </svg>`;
}

function weightScreen({ weekly = false } = {}) {
  const form = state.weightForm;
  const pose = state.cheer ? "celebrate" : weekly ? "week" : "chart";
  const speech = state.cheer
    ? `<p class="privacy">${esc(state.cheer)}</p><p class="quiet">${PRIVACY}</p>`
    : weekly
      ? `<p class="privacy">It's been a week, sis. How is your weight?</p>${privacyBlock()}`
      : privacyBlock();
  return `${header()}<main class="wrap">${backBar()}<h1>${weekly ? "A week went by" : "Your weight"}</h1>
    ${host(pose, speech)}
    <div class="card fields" id="weight-form">
      <div class="choice row">
        <button type="button" data-action="weight-unit" data-value="lb" aria-pressed="${form.unit === "lb"}">Pounds</button>
        <button type="button" data-action="weight-unit" data-value="kg" aria-pressed="${form.unit === "kg"}">Kilograms</button>
      </div>
      <label><span>Weight in ${form.unit} ${tickHTML("check-weight", tenth(form.value), 1)}</span>
        <input id="weightNow" type="range" min="${weightBounds(form.unit).min}" max="${weightBounds(form.unit).max}" step="0.1" value="${tenth(form.value).toFixed(1)}" data-weight="1">
      </label>
      ${state.formError ? `<p class="warn" id="form-error">${esc(state.formError)}</p>` : ""}
      <div class="row">
        <button class="primary" type="button" data-action="save-weight">Save this check-in</button>
        ${weekly ? `<button class="ghost" type="button" data-action="plan-first">I'll plan first</button>` : ""}
      </div>
    </div>
    <section class="card chart-card" style="margin-top:14px"><h2>Your chart</h2>
      ${state.weightLog.length ? chartSVG(state.weightLog, form.unit) : `<p class="quiet">Your first check-in will land here.</p>`}
      <ul class="log">${state.weightLog.map((entry) => `<li>${esc(stamp(entry.at))} · ${esc(formatWeight(entry.kg, form.unit))}</li>`).join("")}</ul>
    </section>
    ${state.cheer ? `<div class="row" style="margin-top:14px"><button class="primary" type="button" data-action="planner">Let's plan</button></div>` : ""}
    ${footer()}</main>`;
}

function renderOnboard() {
  const step = state.onboardStep;
  const titles = ["Let's start with you", "Your fasting clock", "What do you feel like eating?"];
  const poses = ["privacy", "fasting", "notebook"];
  const bubbles = [
    privacyBlock(),
    `<p>The clock is yours. You can change it any day.</p>${privacyBlock()}`,
    `<p>Set the day the way you like it. Calories stay under a whole number, and protein, carbs, and fat each have a range. You can change this whenever you want.</p>`,
  ];
  const brand = step === 1
    ? `<div class="hero-logo"><img src="./assets/logo.png" alt="Samoora Meal Planner"><p class="love">Made with Love by Mohammed</p></div>`
    : `<header class="top"><img class="logo" src="./assets/logo.png" alt="Samoora Meal Planner"></header>`;
  return `${brand}
    <main class="wrap"><div class="steps">${[1, 2, 3].map((item) => `<span class="${item <= step ? "on" : ""}"></span>`).join("")}</div>
    <h1>${titles[step - 1]}</h1>
    ${host(poses[step - 1], bubbles[step - 1])}
    <div id="step-focus">
    ${step === 1 ? bodyFields({ weight: true }) : ""}
    ${step === 2 ? fastingFields() : ""}
    ${step === 3 ? presetEditor() : ""}
    </div>
    <div class="row" style="margin-top:16px">
      ${step > 1 ? `<button class="ghost" type="button" data-action="back">Back</button>` : ""}
      <button class="primary" type="button" data-action="next">${step === 3 ? "Save and start" : "Continue"}</button>
    </div>
    ${footer()}</main>`;
}

function clockFace(mins) {
  const total = Math.max(0, Math.round(mins));
  return `${tickHTML("fast-h", Math.floor(total / 60), 2)}h ${tickHTML("fast-m", total % 60, 2)}m`;
}

function fastingBlock(status) {
  if (!status.enabled || status.phase !== "fasting") return "";
  return `<section class="clock-block">
      <div class="ring" style="--p:${Math.round(status.progress * 100)}"><div class="ring-hole"><strong id="fastClock">${clockFace(status.remainingMin)}</strong><span>left in the fast</span></div></div>
      <div>${host("fasting", `<p class="privacy">I'm right here with you. You eat at ${esc(status.windowOpens)}.</p><p class="quiet">${PRIVACY}</p>`)}</div>
    </section>`;
}

function homeToday(plan) {
  if (!plan) {
    return `<section class="day-block" id="home-today"><h2>Today</h2>
      <p class="quiet">The day is open. Plan lunch and dinner when you're ready.</p>
      <button class="primary" type="button" data-action="planner" data-day="today">Plan today</button>
    </section>`;
  }
  const needsRating = !dayClosed(plan) && (!plan.ratings?.lunch?.overall || !plan.ratings?.dinner?.overall);
  return `<section class="day-block" id="home-today"><h2>Today</h2>
    <div class="meals">${mealCard(findMeal(plan.lunchId), "Lunch", { rating: plan.ratings?.lunch, scope: "home-today-" })}${mealCard(findMeal(plan.dinnerId), "Dinner", { rating: plan.ratings?.dinner, scope: "home-today-" })}</div>
    <div class="row" style="margin-top:14px">
      ${anyRated(plan) ? "" : `<button class="primary" type="button" data-action="planner" data-day="today" data-scroll="#planner-meals">Change meals</button>`}
      ${needsRating ? `<button class="ghost" type="button" data-action="planner" data-day="today" data-scroll="#day-rating">Rate these meals</button>` : ""}
    </div>
  </section>`;
}

function homeTomorrow(tomorrow, todayReady) {
  if (tomorrow) {
    return `<section class="day-block" id="home-tomorrow"><h2>Tomorrow</h2>
      <p class="warn" id="rating-note">You can only rate tomorrow.</p>
      <div class="meals">${mealCard(findMeal(tomorrow.lunchId), "Lunch", { scope: "home-tomorrow-" })}${mealCard(findMeal(tomorrow.dinnerId), "Dinner", { scope: "home-tomorrow-" })}</div>
      <div class="row" style="margin-top:14px">
        <button class="primary" type="button" data-action="planner" data-day="tomorrow">Change meals</button>
      </div>
    </section>`;
  }
  if (!todayReady) {
    return `<section class="day-block" id="home-tomorrow"><h2>Tomorrow</h2>
      <p class="quiet">Tomorrow opens once today is planned.</p>
    </section>`;
  }
  return `<section class="day-block" id="home-tomorrow"><h2>Tomorrow</h2>
    <p class="quiet">Tomorrow is open for planning. Rating waits for the day itself.</p>
    <button class="primary" type="button" data-action="planner" data-day="tomorrow">Plan tomorrow</button>
  </section>`;
}

function renderHome() {
  const due = weightIsDue() && sessionStorage.getItem("samoora.weightLater") !== "1";
  if (due) {
    openWeightForm();
    return weightScreen({ weekly: true });
  }
  const status = fastingStatus(state.fasting);
  const fastingNow = status.enabled && status.phase === "fasting";
  const plan = todayPlan();
  const tomorrow = planFor(tomorrowKey());
  const waiting = confirmedPlans().filter((item) => item.date < todayKey() && (!item.ratings?.lunch?.overall || !item.ratings?.dinner?.overall));
  return `${header()}<main class="wrap">
    <p class="quiet">${esc(prettyDate(todayKey()))}</p>
    <h1>${fastingNow ? "You're fasting" : "Home"}</h1>
    ${fastingBlock(status)}
    ${dayNav(todayKey())}
    ${status.enabled && !fastingNow ? `<p class="banner">Eating window until ${esc(status.windowCloses)}.</p>` : ""}
    ${waiting.length ? `<p class="banner"><button class="ghost" type="button" data-action="history">History</button> is holding meals that still want a rating.</p>` : ""}
    ${homeToday(plan)}
    ${homeTomorrow(tomorrow, Boolean(plan))}
    ${footer()}</main>`;
}

function renderPlanner() {
  const status = fastingStatus(state.fasting);
  const fastingNow = status.enabled && status.phase === "fasting";
  const date = focusKey();
  const ahead = aheadDay(date);
  const past = date < todayKey();
  const saved = planFor(date);
  const locked = Boolean(saved?.confirmedAt);
  const finished = Boolean(saved?.finishedAt);
  const lunch = state.draft.lunch;
  const dinner = state.draft.dinner;
  const total = round2((lunch?.calories || 0) + (dinner?.calories || 0));
  const sameMeal = lunch && dinner && lunch.id === dinner.id;
  const ready = lunch && dinner && !sameMeal && !locked;
  const idiom = idiomFor(date);
  const dayLabel = ahead ? "Tomorrow" : date === yesterdayKey() ? "Yesterday" : prettyDate(date);
  const mealHeading = ahead ? "Tomorrow's meals" : date === todayKey() ? "Today's meals" : date === yesterdayKey() ? "Yesterday's meals" : `${prettyDate(date).split(" · ")[0]}'s meals`;
  if (past && !saved) {
    return `${header()}<main class="wrap">
      <p class="quiet">${esc(prettyDate(date))}</p>
      <h1>Planner</h1>
      ${fastingBlock(status)}
      ${dayNav(date)}
      ${host("notebook", `<p>Nothing was saved for ${esc(prettyDate(date))}.</p>`)}
      ${footer()}</main>`;
  }
  return `${header()}<main class="wrap">
    <p class="quiet">${esc(prettyDate(date))}</p>
    <h1>Planner</h1>
    ${fastingBlock(status)}
    ${dayNav(date)}
    ${ahead ? `<p class="warn" id="rating-note">You can only rate tomorrow.</p>` : ""}
    ${fastingNow ? `<h2>For when you eat</h2>` : ""}
    ${past ? "" : host(state.pickMode && !locked ? "grocery" : "chef", `<p class="idiom">${esc(idiom)}</p>`)}
    ${status.enabled && !fastingNow ? `<p class="banner">Eating window until ${esc(status.windowCloses)}.</p>` : ""}
    ${state.dayNote ? `<p class="warn" id="day-note">${esc(state.dayNote)}</p>` : ""}
    ${state.justConfirmed ? `<p class="banner">Saved for ${esc(dayLabel)}. ${ahead ? "You can only rate tomorrow." : "Rate the meals when you've eaten them, then start a new day."}</p>` : ""}
    ${!ahead && finished ? `<p class="banner">${esc(prettyDate(date))} keeps this one plan.</p>` : ""}
    ${locked && date === todayKey() && !anyRated(saved) ? `<p class="quiet">Unconfirm opens this day again.</p>` : ""}
    ${state.draft.error ? `<p class="warn" id="form-error">${esc(state.draft.error)}</p>` : ""}
    ${state.draft.relaxed ? `<p class="banner">This is the closest pair I could find. The meter tells the truth.</p>` : ""}
    <div id="plan-meter">${meterHTML(total)}</div>
    <div class="plan-head">
      <h2>${mealHeading}</h2>
      <button class="icon-btn" type="button" data-action="toggle-macros" aria-expanded="${state.macrosOpen}" aria-label="${state.macrosOpen ? "Hide macros" : "Show macros"}">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19V10M10 19V5M16 19v-7M22 19H2"/></svg>
        <span>Macros</span>
      </button>
    </div>
    ${state.macrosOpen ? macrosPanel(lunch, dinner) : ""}
    <div class="meals-slot">
      <div id="planner-meals" class="meals">${mealCard(lunch, "Lunch", { lockable: !locked && !past })}${mealCard(dinner, "Dinner", { lockable: !locked && !past })}</div>
    </div>
    ${past ? "" : `<div class="row" id="plan-actions" style="margin:14px 0">
      <button class="primary mode" type="button" data-action="surprise" ${locked ? "disabled" : ""}>Surprise Me</button>
      <button class="ghost mode" type="button" data-action="pick-mode" aria-pressed="${state.pickMode && !locked}" ${locked ? "disabled" : ""}>I'll pick</button>
      ${locked && !anyRated(saved)
        ? `<button class="ghost" type="button" data-action="unconfirm">Unconfirm</button>`
        : locked
          ? ""
          : `<button class="primary" type="button" data-action="confirm" ${ready ? "" : "disabled"}>Confirm</button>`}
    </div>`}
    ${sameMeal ? `<p class="warn">Pick two different meals, sis.</p>` : ""}
    ${state.pickMode && !locked ? `<section class="card" id="pick-panel">
      ${eatenHistoryHTML()}
      <label style="margin-top:16px">Search the menu<input id="mealSearch" type="search" value="${esc(state.search)}" placeholder="Chicken, salmon, a chef..."></label>
      <div id="mealResults" class="results">${resultsHTML()}</div>
    </section>` : ""}
    ${!ahead && locked ? `<section id="day-rating">
      ${past
        ? host("notebook", "<p>This day is saved. A rating still changes what I offer next.</p>")
        : host("eating", "<p>When you've eaten, tell me how it was. Higher stars bring a meal forward. Lower stars tuck it back. You can also leave them and start a new day.</p>")}
      ${state.ratingNote ? `<p class="banner" id="rating-note">${esc(state.ratingNote)}</p>` : ""}
      ${ratingCard(saved)}
      ${date === todayKey() && !finished && !planFor(tomorrowKey()) ? `<div class="row" id="day-next"><button class="primary" type="button" data-action="start-new-day">Start a New Day</button></div>` : ""}
    </section>` : ""}
    ${footer()}</main>`;
}

function historyDay(plan, { open = true } = {}) {
  const lunchRating = plan.ratings?.lunch?.overall ? plan.ratings.lunch : undefined;
  const dinnerRating = plan.ratings?.dinner?.overall ? plan.ratings.dinner : undefined;
  const future = plan.date > todayKey();
  const named = plan.date === todayKey() ? "Today" : plan.date === yesterdayKey() ? "Yesterday" : "";
  const needsRating = open && !future && (!lunchRating || !dinnerRating);
  return `<section class="card history-day" id="day-${esc(plan.date)}"><h2>${esc(named || prettyDate(plan.date))}</h2>
    ${named ? `<p class="quiet">${esc(prettyDate(plan.date))}</p>` : ""}
    ${future ? `<p class="warn" id="rating-note">You can only rate tomorrow.</p>` : ""}
    <div class="meals">${mealCard(findMeal(plan.lunchId), "Lunch", { ...(lunchRating ? { rating: lunchRating } : {}), scope: `${plan.date}-` })}${mealCard(findMeal(plan.dinnerId), "Dinner", { ...(dinnerRating ? { rating: dinnerRating } : {}), scope: `${plan.date}-` })}</div>
    ${needsRating ? ratingCard(plan, { heading: false }) : ""}
  </section>`;
}

function renderHistory() {
  const date = focusKey() > todayKey() ? todayKey() : focusKey();
  const plans = confirmedPlans().filter((plan) => plan.date <= todayKey());
  const focused = plans.find((plan) => plan.date === date);
  const rest = plans.filter((plan) => plan.date !== date);
  const focusBlock = focused
    ? historyDay(focused)
    : `<section class="card history-day" id="day-${esc(date)}"><h2>${esc(date === todayKey() ? "Today" : date === yesterdayKey() ? "Yesterday" : prettyDate(date))}</h2><p class="quiet">Nothing was saved for ${esc(prettyDate(date))}.</p></section>`;
  const body = `${focusBlock}${rest.map((plan) => historyDay(plan, { open: false })).join("")}`;
  return `${header()}<main class="wrap">${backBar()}<h1>Meals you've eaten</h1>
    ${dayNav(date)}
    ${state.ratingNote ? `<p class="banner" id="rating-note">${esc(state.ratingNote)}</p>` : ""}
    <p class="quiet">Each date keeps one plan. Tomorrow stays in the planner.</p>
    ${plans.length || date <= todayKey() ? body : host("notebook", "<p>Your eaten meals will gather here, one day at a time.</p>")}
    ${footer()}</main>`;
}

function renderPrefs() {
  return `${header()}<main class="wrap">${backBar()}<h1>Preferences</h1>
    ${host("notebook", "<p>Change any of this. It saves as you go, and it stays on this device.</p>")}
    <h2>Fasting</h2>${fastingFields()}
    <h2 style="margin-top:18px">Your numbers</h2>
    <div class="card">${bodyFields({ weight: true })}
      <button class="ghost" type="button" data-action="weight">Update my weight</button>
    </div>
    <h2 style="margin-top:18px">Presets</h2>
    ${presetEditor()}
    ${footer()}</main>`;
}

function themeFor() {
  const status = fastingStatus(state.fasting);
  if (state.onboarded && state.screen !== "onboard" && status.phase === "fasting") return "fasting";
  return "eating";
}

function render() {
  expireDraft();
  document.body.dataset.theme = themeFor();
  const scrollTo = state.scrollTo;
  state.scrollTo = null;
  const y = window.scrollY;
  if (state.screen === "loading") {
    app.innerHTML = `<div class="hero-logo"><img src="./assets/logo.png" alt="Samoora Meal Planner"><p class="love">Setting the table...</p></div>`;
  } else if (state.screen === "error") {
    app.innerHTML = `<main class="wrap"><h1>I couldn't open the menu</h1><p>${esc(state.error)}</p></main>`;
  } else if (!state.onboarded || state.screen === "onboard") app.innerHTML = renderOnboard();
  else if (state.screen === "weight") app.innerHTML = weightScreen({ weekly: false });
  else if (state.screen === "prefs") app.innerHTML = renderPrefs();
  else if (state.screen === "history") app.innerHTML = renderHistory();
  else if (state.screen === "planner") app.innerHTML = renderPlanner();
  else app.innerHTML = renderHome();
  if (scrollTo === "top") requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  else if (scrollTo) {
    requestAnimationFrame(() => {
      document.querySelector(scrollTo)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  } else if (y) window.scrollTo(0, y);
  playTicks(app);
  seedOpenNumbers();
}

function seedOpenNumbers() {
  if (!state.meals.length) return;
  if (state.screen !== "home" && state.screen !== "planner") return;
  ["lunch", "dinner"].forEach((slot) => {
    if (document.querySelector(`[data-tick="${slot}-cal"]`)) return;
    ["cal", "protein", "carbs", "fat"].forEach((part) => seedTick(`${slot}-${part}`, 0));
  });
  if (!document.querySelector('[data-tick="lunch-cal"]') && !document.querySelector('[data-tick="dinner-cal"]')) {
    ["cal", "protein", "carbs", "fat"].forEach((part) => seedTick(`day-${part}`, 0));
  }
  if (!document.querySelector('[data-tick="meter-left"]')) seedTick("meter-left", dayTarget(state.profile) || 0);
  if (!document.querySelector('[data-tick="meter-over"]')) seedTick("meter-over", 0);
}

function weightIsDue() {
  const log = state.weightLog;
  if (!Array.isArray(log) || !log.length) return false;
  const last = new Date(log[log.length - 1].at).getTime();
  return Date.now() - last >= 7 * 24 * 60 * 60 * 1000;
}

function openWeightForm() {
  if (state.weightForm) return;
  const unit = state.profile?.unit || "lb";
  const bounds = weightBounds(unit);
  const kg = state.weightLog.at(-1)?.kg || state.profile?.weightKg || 68;
  const raw = unit === "lb" ? tenth(kgToLb(kg)) : tenth(kg);
  state.weightForm = { unit, value: Math.min(bounds.max, Math.max(bounds.min, raw)) };
}

function setUnit(next) {
  const canonical = profileFromForm();
  state.form = formFromProfile({ ...canonical, unit: next });
  render();
}

function applyRange(key, end, raw) {
  const preset = activePreset();
  if (!preset) return false;
  const [min, max] = rangeBounds(key);
  if (!(max > min)) return false;
  const next = preset[key].map((item) => Math.round(Number(item)));
  let value = Math.round(Number(raw));
  value = Math.min(max, Math.max(min, value));
  if (end === 0) value = Math.min(value, next[1]);
  else value = Math.max(value, next[0]);
  if (next[end] === value) return false;
  next[end] = value;
  preset[key] = next;
  if (key === "cal" && end === 1) preset.calChosen = next[1] < max;
  paintDuo(key);
  return true;
}

function rangeValueFromPointer(duo, key, clientX) {
  const [min, max] = rangeBounds(key);
  const rect = duo.getBoundingClientRect();
  const usable = Math.max(1, rect.width - 22);
  const x = Math.min(usable, Math.max(0, clientX - rect.left - 11));
  return min + (x / usable) * (max - min);
}

function nextCheer() {
  const index = Number(state.cheerIndex) || 0;
  const text = CHEERS[index % CHEERS.length];
  state.cheerIndex = (index + 1) % CHEERS.length;
  saveCheer(state.cheerIndex);
  return text;
}

function onClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const editingPrefs = state.screen === "prefs";
  const action = button.dataset.action;
  if (action === "unit") setUnit(button.dataset.value);
  if (action === "back") {
    state.onboardStep -= 1;
    state.formError = "";
    state.scrollTo = "#step-focus";
    render();
  }
  if (action === "next") continueOnboard();
  if (action === "fast-on") {
    state.fasting.on = button.dataset.value === "1";
    render();
  }
  if (action === "fast-hours") {
    state.fasting.hours = Number(button.dataset.value);
    render();
  }
  if (action === "heavier") {
    activePreset().heavier = button.dataset.value;
    render();
  }
  if (action === "use-preset") {
    state.activePresetId = button.dataset.id;
    render();
  }
  if (action === "copy-preset") {
    const source = activePreset();
    const copy = { ...source, id: `mine-${Date.now()}`, name: `${source.name} copy` };
    ["cal", "protein", "carbs", "fat"].forEach((key) => { copy[key] = [...source[key]]; });
    state.presets.push(copy);
    state.activePresetId = copy.id;
    render();
  }
  if (action === "shift-day") goDay(button.dataset.day);
  if (action === "surprise") {
    if (focusKey() < todayKey()) return;
    const saved = planFor(focusKey());
    if (saved) return;
    if (state.locks.lunch && state.locks.dinner) {
      state.draft.error = "Unlock one meal and I'll shuffle the other.";
      state.scrollTo = "#form-error";
      render();
      return;
    }
    const fixedSlot = state.locks.lunch ? "lunch" : state.locks.dinner ? "dinner" : "";
    if (fixedSlot && !state.draft[fixedSlot]) {
      state.draft.error = "Pick a meal before you lock it.";
      state.scrollTo = "#form-error";
      render();
      return;
    }
    const again = Boolean(state.draft.lunch || state.draft.dinner);
    const fixed = fixedSlot ? { slot: fixedSlot, meal: state.draft[fixedSlot] } : null;
    const result = surprisePair(state.meals, planningPreset(), state.mealWeights, recentMealIds(), state.pairKey, fixed);
    if (result.error) {
      state.notice = result.error;
      state.draft.relaxed = false;
      state.draft.error = result.error;
      state.deal = "";
      state.scrollTo = "#form-error";
      render();
    } else {
      state.draft = {
        lunch: fixedSlot === "lunch" ? state.draft.lunch : result.lunch,
        dinner: fixedSlot === "dinner" ? state.draft.dinner : result.dinner,
        relaxed: result.relaxed,
        error: "",
      };
      state.draftDay = focusKey();
      state.pairKey = `${state.draft.lunch.id}-${state.draft.dinner.id}`;
      state.pickMode = false;
      state.justConfirmed = false;
      state.dayNote = "";
      state.deal = again ? "again" : "first";
      const token = Date.now();
      state.dealToken = token;
      if (!paintSurprise(token)) render();
    }
  }
  if (action === "pick-mode") {
    if (focusKey() < todayKey() || planFor(focusKey())) return;
    state.pickMode = true;
    state.deal = "";
    state.scrollTo = "#pick-panel";
    render();
  }
  if (action === "assign") {
    if (focusKey() < todayKey() || planFor(focusKey())) return;
    const meal = findMeal(Number(button.dataset.id));
    state.draft[button.dataset.slot] = meal;
    state.draftDay = focusKey();
    state.draft.relaxed = false;
    state.draft.error = "";
    state.justConfirmed = false;
    state.deal = "";
    state.scrollTo = "#planner-meals";
    render();
  }
  if (action === "lock-meal") {
    if (focusKey() < todayKey() || planFor(focusKey())) return;
    const slot = button.dataset.slot;
    if (!state.draft[slot]) return;
    state.locks[slot] = !state.locks[slot];
    render();
  }
  if (action === "confirm") confirmDay();
  if (action === "unconfirm") unconfirmDay();
  if (action === "finish-day") finishDay();
  if (action === "start-new-day") startNewDay();
  if (action === "toggle-macros") {
    state.macrosOpen = !state.macrosOpen;
    render();
  }
  if (action === "prefs") {
    state.form = formFromProfile(state.profile);
    state.formError = "";
    state.screen = "prefs";
    state.scrollTo = "top";
  }
  if (action === "weight") {
    state.weightForm = null;
    state.cheer = "";
    state.formError = "";
    openWeightForm();
    state.screen = "weight";
    state.scrollTo = "#weight-form";
  }
  if (action === "home") {
    state.screen = "home";
    state.cheer = "";
    state.scrollTo = "top";
  }
  if (action === "planner") {
    const day = button.dataset.day === "tomorrow" ? tomorrowKey() : button.dataset.day === "yesterday" ? yesterdayKey() : button.dataset.day === "today" || button.dataset.scroll ? todayKey() : focusKey();
    showDate(day);
    state.screen = "planner";
    state.cheer = "";
    state.scrollTo = button.dataset.scroll || "top";
  }
  if (action === "history") {
    if (aheadDay()) showDate(todayKey());
    state.screen = "history";
    state.scrollTo = "top";
  }
  if (action === "plan-first") {
    sessionStorage.setItem("samoora.weightLater", "1");
    state.screen = "planner";
    state.scrollTo = "top";
  }
  if (action === "weight-unit") {
    const kg = state.weightForm.unit === "lb" ? lbToKg(state.weightForm.value) : Number(state.weightForm.value);
    const next = button.dataset.value;
    const bounds = weightBounds(next);
    const raw = next === "lb" ? tenth(kgToLb(kg)) : tenth(kg);
    state.weightForm.unit = next;
    state.weightForm.value = Math.min(bounds.max, Math.max(bounds.min, raw));
    render();
  }
  if (action === "save-weight") saveWeight();
  if (action === "rate") {
    const draft = state.ratingDraft[button.dataset.plan][button.dataset.slot];
    draft[button.dataset.field] = Number(button.dataset.value);
    render();
  }
  if (action === "save-rating") saveRating(button.dataset.plan, button.dataset.slot);
  if (["prefs", "weight", "home", "planner", "history", "plan-first"].includes(action)) render();
  if (editingPrefs) persistPrefs();
}

function onInput(event) {
  const input = event.target;
  if (input.dataset.form) {
    const key = input.dataset.form;
    const value = key === "weight" ? tenth(input.value) : Math.round(Number(input.value));
    state.form[key] = value;
    input.value = key === "weight" ? value.toFixed(1) : String(value);
    const tick = document.querySelector(`[data-tick="form-${key}"]`);
    if (tick) writeTick(tick, value);
    if (key !== "deficit") paintDeficitSlider();
    else paintDeficitWord();
    const box = document.querySelector(".bmi");
    if (box) {
      box.innerHTML = pictureBlock();
      playTicks(box);
    }
    paintCalMax();
    if (state.screen === "prefs") persistPrefs();
    return;
  }
  if (input.dataset.level) {
    const labels = ["none", "less", "normal", "more"];
    activePreset()[input.dataset.level] = labels[Number(input.value)];
    const word = document.getElementById(`${input.dataset.level}Word`);
    if (word) word.textContent = LEVEL_LABELS[Number(input.value)];
  }
  if (input.dataset.fastHours) {
    state.fasting.hours = Number(input.value);
    writeTick(document.querySelector('[data-tick="fast-hours"]'), Number(input.value));
    writeTick(document.querySelector('[data-tick="eat-hours"]'), 24 - Number(input.value));
  }
  if (input.dataset.window) state.fasting.windowStartsAt = input.value;
  if (input.dataset.presetName) activePreset().name = input.value;
  if (input.dataset.weight) {
    const bounds = weightBounds(state.weightForm.unit);
    const value = Math.min(bounds.max, Math.max(bounds.min, tenth(input.value)));
    state.weightForm.value = value;
    input.value = value.toFixed(1);
    const tick = document.querySelector('[data-tick="check-weight"]');
    if (tick) writeTick(tick, value);
  }
  if (input.id === "mealSearch") {
    state.search = input.value;
    const box = document.getElementById("mealResults");
    if (box) {
      box.innerHTML = resultsHTML();
      playTicks(box);
    }
  }
  if (state.screen === "prefs") persistPrefs();
}

function continueOnboard() {
  state.formError = "";
  if (state.onboardStep === 1) {
    const profile = profileFromForm();
    state.formError = validateBody(profile);
    if (state.formError) {
      state.scrollTo = "#form-error";
      return render();
    }
    state.profile = profile;
    saveProfile(profile);
    if (!state.weightLog.length) {
      state.weightLog.push({ at: new Date().toISOString(), kg: profile.weightKg });
      saveWeightLog(state.weightLog);
    }
    state.onboardStep = 2;
    state.scrollTo = "#step-focus";
    return render();
  }
  if (state.onboardStep === 2) {
    saveFasting(state.fasting);
    state.onboardStep = 3;
    state.scrollTo = "#step-focus";
    return render();
  }
  clampCalMax();
  savePresets(state.presets, state.activePresetId);
  saveOnboarded(true);
  state.onboarded = true;
  state.screen = "planner";
  state.scrollTo = "top";
  render();
}

function confirmDay() {
  const lunch = state.draft.lunch;
  const dinner = state.draft.dinner;
  if (!lunch || !dinner || lunch.id === dinner.id) return;
  const date = focusKey();
  if (date < todayKey() || date > tomorrowKey() || planFor(date)) return;
  const previous = state.plans.find((plan) => plan.date === date);
  const same = previous && previous.lunchId === lunch.id && previous.dinnerId === dinner.id;
  const plan = {
    date,
    lunchId: lunch.id,
    dinnerId: dinner.id,
    target: dayTarget(state.profile),
    presetName: activePreset().name,
    confirmedAt: new Date().toISOString(),
    finishedAt: null,
    ratings: same ? previous.ratings : { lunch: null, dinner: null },
  };
  state.plans = dedupePlans([plan, ...state.plans.filter((item) => item.date !== date)]);
  savePlans(state.plans);
  state.justConfirmed = true;
  state.pickMode = false;
  state.locks = { lunch: false, dinner: false };
  state.deal = "";
  state.dayNote = "";
  state.scrollTo = aheadDay(date) ? "#rating-note" : "#plan-actions";
  render();
}

function unconfirmDay() {
  const plan = planFor(focusKey());
  if (!plan || anyRated(plan) || plan.date < todayKey()) return;
  const date = plan.date;
  state.plans = state.plans.filter((item) => item.date !== date);
  savePlans(state.plans);
  state.justConfirmed = false;
  state.ratingNote = "";
  state.dayNote = "";
  state.scrollTo = "#plan-actions";
  render();
}

function showDate(date) {
  const next = date && date <= tomorrowKey() ? date : todayKey();
  state.focusDate = next;
  if (state.draftDay === next) return;
  const saved = planFor(next);
  state.focusDate = next;
  state.draftDay = next;
  state.locks = { lunch: false, dinner: false };
  state.pickMode = false;
  state.justConfirmed = false;
  state.deal = "";
  state.dayNote = "";
  state.draft = {
    lunch: saved ? findMeal(saved.lunchId) : null,
    dinner: saved ? findMeal(saved.dinnerId) : null,
    relaxed: false,
    error: "",
  };
}

function paintDeficitWord() {
  const profile = profileFromForm();
  const cut = deficitWords(state.form.deficit, profile.calories);
  const word = document.getElementById("deficitWord");
  if (!word) return;
  word.textContent = cut.name;
  word.className = `cut-${cut.id}`;
}

function paintDeficitSlider() {
  const profile = profileFromForm();
  const max = deficitMax(profile.calories);
  const input = document.getElementById("deficit");
  const value = Math.min(max, Math.max(0, Math.round(state.form.deficit)));
  state.form.deficit = value;
  if (input) {
    input.max = String(max);
    input.value = String(value);
  }
  const tick = document.querySelector('[data-tick="form-deficit"]');
  if (tick) writeTick(tick, value);
  paintDeficitWord();
}

function startNewDay() {
  if (!todayPlan()) {
    showDate(todayKey());
    state.screen = "planner";
    state.scrollTo = "top";
    render();
    return;
  }
  if (planFor(tomorrowKey())) {
    showDate(tomorrowKey());
    state.dayNote = "Tomorrow is already planned. You can start another day when tomorrow arrives.";
    state.screen = "planner";
    state.scrollTo = "#day-note";
    render();
    return;
  }
  const today = todayPlan();
  if (today && !today.finishedAt) {
    today.finishedAt = new Date().toISOString();
    savePlans(state.plans);
  }
  state.focusDate = tomorrowKey();
  state.draft = { lunch: null, dinner: null, relaxed: false, error: "" };
  state.draftDay = tomorrowKey();
  state.locks = { lunch: false, dinner: false };
  state.pickMode = false;
  state.justConfirmed = false;
  state.deal = "";
  state.dayNote = "";
  state.ratingNote = "";
  state.screen = "planner";
  state.scrollTo = "top";
  render();
}

function finishDay() {
  const plan = planFor(focusKey());
  if (!plan) return;
  if (plan.date > todayKey()) {
    state.ratingNote = "You can only rate tomorrow.";
    state.scrollTo = "#rating-note";
    render();
    return;
  }
  plan.finishedAt = new Date().toISOString();
  savePlans(state.plans);
  state.justConfirmed = false;
  state.screen = "home";
  state.scrollTo = "top";
  render();
}

function saveRating(planDate, slot) {
  if (planDate > todayKey()) {
    state.ratingNote = "You can only rate tomorrow.";
    state.scrollTo = "#rating-note";
    render();
    return;
  }
  const draft = state.ratingDraft[planDate]?.[slot];
  if (!draft?.overall || !draft.delicious || !draft.full || !draft.again) {
    state.ratingNote = "Tell me all four, sis, then I'll remember it.";
    state.scrollTo = state.screen === "history" ? "#rating-note" : "#day-rating";
    render();
    return;
  }
  const plan = state.plans.find((item) => item.date === planDate);
  plan.ratings = plan.ratings || {};
  plan.ratings[slot] = { ...draft };
  const mealId = slot === "lunch" ? plan.lunchId : plan.dinnerId;
  const weight = weightFromRating(plan.ratings[slot]);
  state.mealWeights[mealId] = weight;
  savePlans(state.plans);
  saveMealWeights(state.mealWeights);
  state.ratingNote = ratingWords(weight);
  render();
}

function saveWeight() {
  const value = Number(state.weightForm.value);
  const bounds = weightBounds(state.weightForm.unit);
  const kg = state.weightForm.unit === "lb" ? lbToKg(value) : value;
  if (!value || value < bounds.min || value > bounds.max) {
    state.formError = "That weight looks off. Want to check it?";
    state.scrollTo = "#form-error";
    render();
    return;
  }
  state.profile.unit = state.weightForm.unit;
  state.profile.weightKg = kg;
  state.profile.calories = baselineCalories(kg, state.profile.heightCm);
  saveProfile(state.profile);
  clampCalMax();
  savePresets(state.presets, state.activePresetId);
  state.weightLog.push({ at: new Date().toISOString(), kg });
  saveWeightLog(state.weightLog);
  state.form = formFromProfile(state.profile);
  state.formError = "";
  state.cheer = nextCheer();
  state.weightForm = { unit: state.profile.unit, value: tenth(state.profile.unit === "lb" ? kgToLb(kg) : kg) };
  state.screen = "weight";
  sessionStorage.removeItem("samoora.weightLater");
  render();
}

function paintFormError() {
  const existing = document.getElementById("form-error");
  if (!state.formError) {
    existing?.remove();
    return;
  }
  if (existing) {
    existing.textContent = state.formError;
    return;
  }
  const fields = document.querySelector(".fields");
  if (!fields) return;
  const note = document.createElement("p");
  note.id = "form-error";
  note.className = "warn";
  note.textContent = state.formError;
  fields.appendChild(note);
}

function persistPrefs() {
  if (!state.profile) return;
  const profile = profileFromForm();
  const editingWeight = Boolean(document.querySelector('[data-form="weight"]'));
  if (!editingWeight) profile.weightKg = state.profile.weightKg;
  profile.calories = baselineCalories(profile.weightKg, profile.heightCm);
  state.formError = validateBody(profile, { requireWeight: editingWeight });
  paintFormError();
  if (!state.formError) {
    state.profile = profile;
    saveProfile(profile);
  }
  state.presets.forEach((preset) => sanitizePreset(preset));
  saveFasting(state.fasting);
  savePresets(state.presets, state.activePresetId);
}

function recentMealIds() {
  const ids = new Set();
  state.plans.slice(0, 2).forEach((plan) => {
    ids.add(plan.lunchId);
    ids.add(plan.dinnerId);
  });
  return ids;
}

function restoreToday() {
  const date = focusKey();
  const saved = planFor(date);
  if (!saved) return;
  state.draftDay = date;
  state.draft = {
    lunch: findMeal(saved.lunchId),
    dinner: findMeal(saved.dinnerId),
    relaxed: false,
    error: "",
  };
}

function expireDraft() {
  const live = focusKey();
  if (!state.draftDay || state.draftDay === live) return;
  const saved = state.meals.length ? planFor(live) : null;
  state.draft = {
    lunch: saved ? findMeal(saved.lunchId) : null,
    dinner: saved ? findMeal(saved.dinnerId) : null,
    relaxed: false,
    error: "",
  };
  state.draftDay = live;
  state.locks = { lunch: false, dinner: false };
}

async function boot() {
  try {
    const loaded = loadState();
    Object.assign(state, loaded);
    if (!state.presets?.length) state.presets = starterPresets();
    const savedFasting = state.fasting;
    state.onboardStep = !state.profile ? 1 : savedFasting ? 3 : 2;
    if (!state.fasting) state.fasting = { on: true, hours: 16, windowStartsAt: "12:00" };
    state.fasting.hours = Math.min(20, Math.max(12, Math.round(Number(state.fasting.hours) || 16)));
    if (state.profile?.heightCm && state.profile?.weightKg) {
      state.profile.calories = baselineCalories(state.profile.weightKg, state.profile.heightCm);
      saveProfile(state.profile);
    }
    state.plans = dedupePlans(Array.isArray(state.plans) ? state.plans : []);
    state.form = formFromProfile(state.profile);
    state.screen = state.onboarded ? "home" : "onboard";
    state.scrollTo = "top";
    if (state.profile) {
      clampCalMax();
      savePresets(state.presets, state.activePresetId);
    }
    render();
    state.meals = await loadMeals();
    restoreToday();
    state.scrollTo = "top";
    render();
  } catch (error) {
    state.screen = "error";
    state.error = "The menu could not be opened in this browser. If you just pushed the site, give GitHub Pages a minute and refresh.";
    render();
    console.error(error);
  }
  setInterval(() => {
    const status = fastingStatus(state.fasting);
    const theme = themeFor();
    const clock = document.getElementById("fastClock");
    const ring = document.querySelector(".ring");
    if (document.body.dataset.theme !== theme) render();
    else if (clock) {
      const total = Math.max(0, Math.round(status.remainingMin));
      const hourEl = document.querySelector('[data-tick="fast-h"]');
      const minuteEl = document.querySelector('[data-tick="fast-m"]');
      if (hourEl && minuteEl) {
        writeTick(hourEl, Math.floor(total / 60));
        writeTick(minuteEl, total % 60);
      } else clock.textContent = formatRemaining(status.remainingMin);
      if (ring) ring.style.setProperty("--p", String(Math.round(status.progress * 100)));
    }
  }, 30000);
}

app.addEventListener("click", onClick);
app.addEventListener("input", onInput);
app.addEventListener("change", (event) => {
  const input = event.target;
  if (input.dataset.fastHours || input.dataset.window || input.dataset.level) render();
});
app.addEventListener("pointerdown", (event) => {
  const knob = event.target.closest(".knob");
  if (!knob) return;
  event.preventDefault();
  const duo = knob.closest(".duo");
  const key = duo.dataset.duo;
  const end = Number(knob.dataset.end);
  duo.dataset.activeEnd = String(end);
  knob.style.zIndex = "4";
  knob.focus({ preventScroll: true });
  const knobRect = knob.getBoundingClientRect();
  const grabOffset = event.clientX - (knobRect.left + knobRect.width / 2);
  const move = (ev) => applyRange(key, end, rangeValueFromPointer(duo, key, ev.clientX - grabOffset));
  const up = () => {
    delete duo.dataset.activeEnd;
    knob.removeEventListener("pointermove", move);
    knob.removeEventListener("pointerup", up);
    knob.removeEventListener("pointercancel", up);
    if (state.screen === "prefs") persistPrefs();
  };
  knob.setPointerCapture(event.pointerId);
  knob.addEventListener("pointermove", move);
  knob.addEventListener("pointerup", up);
  knob.addEventListener("pointercancel", up);
});
app.addEventListener("keydown", (event) => {
  const knob = event.target.closest?.(".knob");
  if (!knob) return;
  let raw = null;
  const key = knob.closest(".duo").dataset.duo;
  const end = Number(knob.dataset.end);
  const [min, max] = rangeBounds(key);
  const current = activePreset()[key][end];
  if (event.key === "ArrowRight" || event.key === "ArrowUp") raw = current + 1;
  else if (event.key === "ArrowLeft" || event.key === "ArrowDown") raw = current - 1;
  else if (event.key === "Home") raw = min;
  else if (event.key === "End") raw = max;
  if (raw == null) return;
  event.preventDefault();
  if (applyRange(key, end, raw) && state.screen === "prefs") persistPrefs();
});
boot();
