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
  cmToFtIn,
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

function prettyDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const weekday = date.toLocaleDateString([], { weekday: "long" });
  const rest = date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
  return `${weekday} · ${rest}`;
}

function todayPlan() {
  return state.plans.find((plan) => plan.date === todayKey() && plan.confirmedAt) || null;
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

function formFromProfile(profile) {
  const unit = profile?.unit || "lb";
  const heightCm = profile?.heightCm || 165;
  const imperial = cmToFtIn(heightCm);
  const weightKg = profile?.weightKg || (unit === "lb" ? lbToKg(150) : 68);
  return {
    unit,
    feet: profile ? imperial.feet : 5,
    inches: profile ? imperial.inches : 5,
    cm: round2(heightCm),
    weight: unit === "lb" ? round2(kgToLb(weightKg)) : round2(weightKg),
    calories: baselineCalories(weightKg, heightCm),
    deficit: profile?.deficit ?? 300,
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
  if (profile.unit === "kg") {
    if (profile.heightCm < 120 || profile.heightCm > 230) return "That height looks off. Want to check it?";
    if (requireWeight && (profile.weightKg < 32 || profile.weightKg > 230)) return "That weight looks off. Want to check it?";
  } else {
    const { feet, inches } = cmToFtIn(profile.heightCm);
    if (feet < 4 || feet > 7 || inches < 0 || inches > 11) return "That height looks off. Want to check it?";
    const pounds = kgToLb(profile.weightKg);
    if (requireWeight && (pounds < 70 || pounds > 500)) return "That weight looks off. Want to check it?";
  }
  if (profile.deficit < 0 || profile.deficit >= profile.calories) return "Leave yourself something to eat, sis. The deficit has to stay under your baseline.";
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

function macroField(key, label, min, max, step) {
  const range = activePreset()[key];
  if (key === "cal") {
    const ceiling = Math.max(0, liveTarget());
    const floor = Math.min(range[0], ceiling || range[0]);
    const sliderMin = Math.min(min, ceiling || min);
    const sliderMax = Math.max(sliderMin, ceiling || min);
    return `<div class="macro"><strong>${label}</strong>
      <label><span>Greater than ${tickHTML(`${key}-min`, floor)}</span>
        <input type="range" min="${sliderMin}" max="${sliderMax}" step="1" value="${floor}" data-range="${key}" data-end="0">
      </label>
      <div class="macro-max"><i></i><span>Max ${ceiling ? tickHTML("cal-max", ceiling) : "—"}</span></div>
    </div>`;
  }
  return `<div class="macro"><strong>${label}</strong>
    <label><span>Greater than ${tickHTML(`${key}-min`, range[0])}</span>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${range[0]}" data-range="${key}" data-end="0">
    </label>
    <label><span>Less than ${tickHTML(`${key}-max`, range[1])}</span>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${range[1]}" data-range="${key}" data-end="1">
    </label></div>`;
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
  clampCalMax();
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
      ${macroField("cal", "Calories", 600, 2800, 10)}
      ${macroField("protein", "Protein (g)", 20, 220, 1)}
      ${macroField("carbs", "Carbs (g)", 20, 320, 1)}
      ${macroField("fat", "Fat (g)", 10, 180, 1)}
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
      <label><span>Fast length ${tickHTML("fast-hours", hours)} hours</span>
        <input type="range" min="12" max="20" step="1" value="${hours}" data-fast-hours="1">
      </label>
      <label>Eating window opens
        <input type="time" value="${esc(fasting.windowStartsAt || "12:00")}" data-window="1">
      </label>
      <p>You fast ${tickHTML("fast-hours", hours)} hours, then eat for ${tickHTML("eat-hours", 24 - hours)}, starting at ${esc(clockLabel(fasting.windowStartsAt))}.</p>
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
  const max = liveTarget();
  const preset = activePreset();
  if (!preset || !(max > 0)) return;
  preset.cal[1] = max;
  if (preset.cal[0] > max) preset.cal[0] = max;
}

function planningPreset() {
  clampCalMax();
  const preset = activePreset();
  return { ...preset, cal: [...preset.cal] };
}

function paintCalMax() {
  const max = liveTarget();
  const preset = activePreset();
  if (!preset || !(max > 0)) return;
  const minInput = document.querySelector('[data-range="cal"][data-end="0"]');
  if (minInput) {
    const sliderMin = Math.min(600, max);
    minInput.min = String(sliderMin);
    minInput.max = String(Math.max(sliderMin, max));
    minInput.step = "1";
    minInput.value = String(preset.cal[0]);
  }
  const minOut = document.querySelector('[data-tick="cal-min"]');
  const maxOut = document.querySelector('[data-tick="cal-max"]');
  if (minOut) writeTick(minOut, preset.cal[0]);
  if (maxOut) writeTick(maxOut, max);
}

function pictureBlock() {
  clampCalMax();
  const profile = profileFromForm();
  const picture = bmi(profile.weightKg, profile.heightCm);
  const shown = picture ? round2(picture) : 0;
  const baseline = profile.calories || 0;
  const deficit = Math.max(0, round2(state.form.deficit));
  const target = Math.max(0, round2(baseline - deficit));
  const scaleMin = 15;
  const scaleSpan = 25;
  const pin = shown ? Math.min(100, Math.max(0, ((shown - scaleMin) / scaleSpan) * 100)) : null;
  const zones = [18.5, 25, 30, 40].map((edge, index, edges) => {
    const start = index === 0 ? scaleMin : edges[index - 1];
    return ((edge - start) / scaleSpan) * 100;
  });
  const keep = baseline > 0 ? Math.min(1, target / baseline) : 0;
  const label = shown ? `BMI ${fixed2(shown)}. Day maximum ${fixed2(target)} calories.` : "Add height and weight.";
  return `<div class="bmi-board" role="img" aria-label="${esc(label)}">
    <div class="bmi-read"><span class="kicker">BMI</span><strong>${shown ? tickHTML("bmi", shown) : "—"}</strong></div>
    <div class="bmi-scale">
      <div class="bmi-zones">${zones.map((width, index) => `<span class="z${index + 1}" style="width:${width}%"></span>`).join("")}</div>
      ${pin === null ? "" : `<i class="bmi-pin" style="left:${pin}%"></i>`}
    </div>
    <div class="bmi-marks"><span style="left:14%">18.50</span><span style="left:40%">25.00</span><span style="left:60%">30.00</span></div>
    <div class="energy">
      <div class="energy-track" aria-hidden="true"><span class="energy-keep" style="width:${keep * 100}%"></span><span class="energy-cut" style="width:${(1 - keep) * 100}%"></span></div>
      <div class="energy-fig">${target > 0 ? tickHTML("day-target", target) : "—"}<small>max</small></div>
    </div>
    <div class="energy-notes"><span>${baseline ? tickHTML("baseline", baseline) : "—"}</span><span>− ${tickHTML("deficit-show", deficit)}</span></div>
  </div>`;
}

function bodyFields({ weight = true } = {}) {
  const form = state.form;
  const imperial = form.unit === "lb";
  return `<div class="fields">
    <div class="choice row">
      <button type="button" data-action="unit" data-value="lb" aria-pressed="${imperial}">Pounds</button>
      <button type="button" data-action="unit" data-value="kg" aria-pressed="${!imperial}">Kilograms</button>
    </div>
    ${imperial
      ? `<div class="split"><label>Feet<input id="feet" type="number" min="4" max="7" step="0.01" value="${fixed2(form.feet)}" data-form="feet"></label>
         <label>Inches<input id="inches" type="number" min="0" max="11" step="0.01" value="${fixed2(form.inches)}" data-form="inches"></label></div>`
      : `<label>Height in centimeters<input id="cm" type="number" min="120" max="230" step="0.01" value="${fixed2(form.cm)}" data-form="cm"></label>`}
    ${weight ? `<label>Weight in ${imperial ? "pounds" : "kilograms"}<input id="bodyWeight" type="number" min="1" step="0.01" value="${fixed2(form.weight)}" data-form="weight"></label>` : `<p>Latest weight: <strong>${tickHTML("latest-weight", form.unit === "lb" ? kgToLb(state.profile.weightKg) : state.profile.weightKg, 2, ` ${form.unit}`)}</strong></p>`}
    <label>Deficit<input id="deficit" type="number" min="0" step="0.01" value="${fixed2(form.deficit)}" data-form="deficit"></label>
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
  probe.innerHTML = `${mealCard(lunch, "Lunch")}${mealCard(dinner, "Dinner")}`;
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
    box.innerHTML = `${withMealHeight(mealCard(lunch, "Lunch"), hold[0])}${withMealHeight(mealCard(dinner, "Dinner"), hold[1])}`;
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
  const note = state.draft.relaxed
    ? "This is the closest pair I could find."
    : state.deal === "again" ? "Another pair." : "";
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

function mealCard(meal, slot, { rating = undefined, scope = "" } = {}) {
  if (!meal) {
    return `<article class="meal"><p class="slot">${slot}</p><p class="quiet">Nothing here yet.</p></article>`;
  }
  const prefix = `${scope}${slot.toLowerCase()}`;
  const pills = String(meal.categories || "").split(";").map((item) => item.trim()).filter(Boolean).slice(0, 6);
  return `<article class="meal"><p class="slot">${slot}</p><h3>${esc(meal.name)}</h3>
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
      ${labeled.has(index) ? `<text class="tick" data-tick="log-${point.at.getTime()}" data-value="${round2(point.value)}" data-digits="2" data-suffix=" ${unit}" x="${x}" y="${y - 28}" text-anchor="middle">${esc(`${fixed2(point.value)} ${unit}`)}</text><text x="${x}" y="${y - 14}" text-anchor="middle">${esc(stamp(point.at))}</text>` : ""}`;
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
      <label>Weight in ${form.unit}
        <input id="weightNow" type="number" min="1" step="0.01" value="${fixed2(form.value)}" data-weight="1">
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
    `<p>Set the day the way you like it. Greater than, less than, and how heavy lunch or dinner should be. You can change this whenever you want.</p>`,
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

function renderHome() {
  const due = weightIsDue() && sessionStorage.getItem("samoora.weightLater") !== "1";
  if (due) {
    openWeightForm();
    return weightScreen({ weekly: true });
  }
  const status = fastingStatus(state.fasting);
  const fastingNow = status.enabled && status.phase === "fasting";
  const plan = todayPlan();
  const lunch = plan ? findMeal(plan.lunchId) : null;
  const dinner = plan ? findMeal(plan.dinnerId) : null;
  const waiting = confirmedPlans().filter((item) => item.date !== todayKey() && (!item.ratings?.lunch?.overall || !item.ratings?.dinner?.overall));
  const needsRating = plan && (!plan.ratings?.lunch?.overall || !plan.ratings?.dinner?.overall);
  return `${header()}<main class="wrap">
    <p class="quiet">${esc(prettyDate(todayKey()))}</p>
    <h1>${fastingNow ? "You're fasting" : "Home"}</h1>
    ${fastingBlock(status)}
    ${status.enabled && !fastingNow ? `<p class="banner">Eating window until ${esc(status.windowCloses)}.</p>` : ""}
    ${waiting.length ? `<p class="banner"><button class="ghost" type="button" data-action="history">History</button> is holding meals that still want a rating.</p>` : ""}
    ${plan ? `${host("thumbs", "<p>This is the day you saved. It stays on this date.</p>")}
      <div class="meals">${mealCard(lunch, "Lunch", { rating: plan.ratings?.lunch })}${mealCard(dinner, "Dinner", { rating: plan.ratings?.dinner })}</div>
      <div class="row" style="margin-top:14px">
        <button class="primary" type="button" data-action="planner" data-scroll="#planner-meals">Change meals</button>
        ${needsRating ? `<button class="ghost" type="button" data-action="planner" data-scroll="#day-rating">Rate these meals</button>` : ""}
      </div>` : `${host("chef", "<p>The day is open. Plan lunch and dinner when you're ready.</p>")}
      <button class="primary" type="button" data-action="planner">Plan today</button>`}
    ${footer()}</main>`;
}

function renderPlanner() {
  const status = fastingStatus(state.fasting);
  const fastingNow = status.enabled && status.phase === "fasting";
  const saved = todayPlan();
  const locked = Boolean(saved?.confirmedAt);
  const finished = Boolean(saved?.finishedAt);
  const lunch = state.draft.lunch;
  const dinner = state.draft.dinner;
  const total = round2((lunch?.calories || 0) + (dinner?.calories || 0));
  const sameMeal = lunch && dinner && lunch.id === dinner.id;
  const ready = lunch && dinner && !sameMeal && !locked;
  const idiom = idiomFor(todayKey());
  return `${header()}<main class="wrap">
    <p class="quiet">${esc(prettyDate(todayKey()))}</p>
    <h1>Planner</h1>
    ${fastingBlock(status)}
    ${fastingNow ? `<h2>For when you eat</h2>` : ""}
    ${host(state.pickMode && !locked ? "grocery" : "chef", `<p class="idiom">${esc(idiom)}</p>`)}
    ${status.enabled && !fastingNow ? `<p class="banner">Eating window until ${esc(status.windowCloses)}.</p>` : ""}
    ${state.justConfirmed ? `<p class="banner">Saved for ${esc(prettyDate(todayKey()))}. Rate the meals when you've eaten them, then start a new day.</p>` : ""}
    ${finished ? `<p class="banner">${esc(prettyDate(todayKey()))} keeps this one plan.</p>` : ""}
    ${locked ? `<p class="quiet">Unconfirm opens this day again.</p>` : ""}
    ${state.draft.error ? `<p class="warn" id="form-error">${esc(state.draft.error)}</p>` : ""}
    ${state.draft.relaxed ? `<p class="banner">This is the closest pair I could find. The meter tells the truth.</p>` : ""}
    <div id="plan-meter">${meterHTML(total)}</div>
    <div class="plan-head">
      <h2>Today's meals</h2>
      <button class="icon-btn" type="button" data-action="toggle-macros" aria-expanded="${state.macrosOpen}" aria-label="${state.macrosOpen ? "Hide macros" : "Show macros"}">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19V10M10 19V5M16 19v-7M22 19H2"/></svg>
        <span>Macros</span>
      </button>
    </div>
    ${state.macrosOpen ? macrosPanel(lunch, dinner) : ""}
    <div class="meals-slot">
      <div id="planner-meals" class="meals">${mealCard(lunch, "Lunch")}${mealCard(dinner, "Dinner")}</div>
    </div>
    <div class="row" id="plan-actions" style="margin:14px 0">
      <button class="primary mode" type="button" data-action="surprise" ${locked ? "disabled" : ""}>Surprise Me</button>
      <button class="ghost mode" type="button" data-action="pick-mode" aria-pressed="${state.pickMode && !locked}" ${locked ? "disabled" : ""}>I'll pick</button>
      ${locked
        ? `<button class="ghost" type="button" data-action="unconfirm">Unconfirm</button>`
        : `<button class="primary" type="button" data-action="confirm" ${ready ? "" : "disabled"}>Confirm</button>`}
    </div>
    ${sameMeal ? `<p class="warn">Pick two different meals, sis.</p>` : ""}
    ${state.pickMode && !locked ? `<section class="card" id="pick-panel">
      ${eatenHistoryHTML()}
      <label style="margin-top:16px">Search the menu<input id="mealSearch" type="search" value="${esc(state.search)}" placeholder="Chicken, salmon, a chef..."></label>
      <div id="mealResults" class="results">${resultsHTML()}</div>
    </section>` : ""}
    ${locked ? `<section id="day-rating">
      ${host("eating", "<p>When you've eaten, tell me how it was. Higher stars bring a meal forward. Lower stars tuck it back. You can also leave them and start a new day.</p>")}
      ${state.ratingNote ? `<p class="banner" id="rating-note">${esc(state.ratingNote)}</p>` : ""}
      ${ratingCard(saved)}
      ${finished ? "" : `<div class="row" id="day-next"><button class="primary" type="button" data-action="finish-day">Start a New Day</button></div>`}
    </section>` : ""}
    ${footer()}</main>`;
}

function renderHistory() {
  const plans = confirmedPlans();
  const body = plans.length
    ? plans.map((plan) => {
      const lunchRating = plan.ratings?.lunch?.overall ? plan.ratings.lunch : undefined;
      const dinnerRating = plan.ratings?.dinner?.overall ? plan.ratings.dinner : undefined;
      const open = !lunchRating || !dinnerRating;
      return `<section class="card history-day"><h2>${esc(prettyDate(plan.date))}</h2>
        <div class="meals">${mealCard(findMeal(plan.lunchId), "Lunch", { ...(lunchRating ? { rating: lunchRating } : {}), scope: `${plan.date}-` })}${mealCard(findMeal(plan.dinnerId), "Dinner", { ...(dinnerRating ? { rating: dinnerRating } : {}), scope: `${plan.date}-` })}</div>
        ${open ? ratingCard(plan, { heading: false }) : ""}
      </section>`;
    }).join("")
    : `${host("notebook", "<p>Your eaten meals will gather here, one day at a time.</p>")}`;
  return `${header()}<main class="wrap">${backBar()}<h1>Meals you've eaten</h1>
    ${state.ratingNote ? `<p class="banner" id="rating-note">${esc(state.ratingNote)}</p>` : ""}
    <p class="quiet">Each date keeps one plan.</p>
    ${body}
    ${footer()}</main>`;
}

function renderPrefs() {
  return `${header()}<main class="wrap">${backBar()}<h1>Preferences</h1>
    ${host("notebook", "<p>Change any of this and save. It stays on this device, and you can come back to it.</p>")}
    <h2>Fasting</h2>${fastingFields()}
    <h2 style="margin-top:18px">Your numbers</h2>
    <div class="card">${bodyFields({ weight: false })}
      <button class="ghost" type="button" data-action="weight">Update my weight</button>
    </div>
    <h2 style="margin-top:18px">Presets</h2>
    ${presetEditor()}
    <div class="row" style="margin-top:14px">
      <button class="primary" type="button" data-action="save-prefs">Save</button>
      <button class="ghost" type="button" data-action="planner">Back to planner</button>
    </div>
    ${footer()}</main>`;
}

function themeFor() {
  const status = fastingStatus(state.fasting);
  if (state.onboarded && state.screen !== "onboard" && status.phase === "fasting") return "fasting";
  return "eating";
}

function render() {
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
  if (!log.length) return false;
  const last = new Date(log[log.length - 1].at).getTime();
  return Date.now() - last >= 7 * 24 * 60 * 60 * 1000;
}

function openWeightForm() {
  if (state.weightForm) return;
  const unit = state.profile?.unit || "lb";
  const kg = state.weightLog.at(-1)?.kg || state.profile?.weightKg || 68;
  state.weightForm = { unit, value: unit === "lb" ? round2(kgToLb(kg)) : round2(kg) };
}

function setUnit(next) {
  const canonical = profileFromForm();
  state.form = formFromProfile({ ...canonical, unit: next });
  render();
}

function updateRange(input) {
  const preset = activePreset();
  const end = Number(input.dataset.end);
  const value = Number(input.value);
  const next = [...preset[input.dataset.range]];
  next[end] = value;
  if (input.dataset.range === "cal") {
    const cap = liveTarget();
    next[1] = cap;
    if (next[0] > cap) next[0] = cap;
    input.value = String(next[0]);
  } else if (next[0] > next[1]) next[end === 0 ? 1 : 0] = value;
  preset[input.dataset.range] = next;
  const minOut = document.querySelector(`[data-tick="${input.dataset.range}-min"]`);
  const maxOut = document.querySelector(`[data-tick="${input.dataset.range}-max"]`);
  if (minOut) writeTick(minOut, next[0]);
  if (maxOut) writeTick(maxOut, next[1]);
  const other = input.parentElement.parentElement.querySelector(`[data-end="${end === 0 ? 1 : 0}"]`);
  if (other && Number(other.value) !== next[end === 0 ? 1 : 0]) other.value = next[end === 0 ? 1 : 0];
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
  if (action === "surprise") {
    if (todayPlan()) return;
    const again = Boolean(state.draft.lunch || state.draft.dinner);
    const result = surprisePair(state.meals, planningPreset(), state.mealWeights, recentMealIds(), state.pairKey);
    if (result.error) {
      state.notice = result.error;
      state.draft = { lunch: null, dinner: null, relaxed: false, error: result.error };
      state.deal = "";
      state.scrollTo = "#form-error";
      render();
    } else {
      state.draft = { lunch: result.lunch, dinner: result.dinner, relaxed: result.relaxed };
      state.pairKey = `${result.lunch.id}-${result.dinner.id}`;
      state.pickMode = false;
      state.justConfirmed = false;
      state.deal = again ? "again" : "first";
      const token = Date.now();
      state.dealToken = token;
      if (!paintSurprise(token)) render();
    }
  }
  if (action === "pick-mode") {
    if (todayPlan()) return;
    state.pickMode = true;
    state.deal = "";
    state.scrollTo = "#pick-panel";
    render();
  }
  if (action === "assign") {
    if (todayPlan()) return;
    const meal = findMeal(Number(button.dataset.id));
    state.draft[button.dataset.slot] = meal;
    state.draft.relaxed = false;
    state.draft.error = "";
    state.justConfirmed = false;
    state.deal = "";
    state.scrollTo = "#planner-meals";
    render();
  }
  if (action === "confirm") confirmDay();
  if (action === "unconfirm") unconfirmDay();
  if (action === "finish-day") finishDay();
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
    state.screen = "planner";
    state.cheer = "";
    state.scrollTo = button.dataset.scroll || "top";
  }
  if (action === "history") {
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
    state.weightForm.unit = button.dataset.value;
    state.weightForm.value = state.weightForm.unit === "lb" ? round2(kgToLb(kg)) : round2(kg);
    render();
  }
  if (action === "save-weight") saveWeight();
  if (action === "save-prefs") savePrefs();
  if (action === "rate") {
    const draft = state.ratingDraft[button.dataset.plan][button.dataset.slot];
    draft[button.dataset.field] = Number(button.dataset.value);
    render();
  }
  if (action === "save-rating") saveRating(button.dataset.plan, button.dataset.slot);
  if (["prefs", "weight", "home", "planner", "history", "plan-first"].includes(action)) render();
}

function onInput(event) {
  const input = event.target;
  if (input.dataset.form) {
    state.form[input.dataset.form] = input.type === "number" ? Number(input.value) : input.value;
    const box = document.querySelector(".bmi");
    if (box) {
      box.innerHTML = pictureBlock();
      playTicks(box);
    }
    paintCalMax();
    return;
  }
  if (input.dataset.range) updateRange(input);
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
  if (input.dataset.weight) state.weightForm.value = Number(input.value);
  if (input.id === "mealSearch") {
    state.search = input.value;
    const box = document.getElementById("mealResults");
    if (box) {
      box.innerHTML = resultsHTML();
      playTicks(box);
    }
  }
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
  const date = todayKey();
  if (todayPlan()) return;
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
  state.deal = "";
  state.scrollTo = "#plan-actions";
  render();
}

function unconfirmDay() {
  const date = todayKey();
  state.plans = state.plans.filter((plan) => plan.date !== date);
  savePlans(state.plans);
  state.justConfirmed = false;
  state.ratingNote = "";
  state.scrollTo = "#plan-actions";
  render();
}

function finishDay() {
  const plan = todayPlan();
  if (!plan) return;
  plan.finishedAt = new Date().toISOString();
  savePlans(state.plans);
  state.justConfirmed = false;
  state.screen = "home";
  state.scrollTo = "top";
  render();
}

function saveRating(planDate, slot) {
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
  const kg = state.weightForm.unit === "lb" ? lbToKg(value) : value;
  const pounds = kgToLb(kg);
  if (!value || kg < 32 || kg > 230 || pounds < 70 || pounds > 500) {
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
  state.weightForm = { unit: state.profile.unit, value: state.profile.unit === "lb" ? round2(kgToLb(kg)) : round2(kg) };
  state.screen = "weight";
  sessionStorage.removeItem("samoora.weightLater");
  render();
}

function savePrefs() {
  const profile = profileFromForm();
  profile.weightKg = state.profile.weightKg;
  profile.calories = baselineCalories(profile.weightKg, profile.heightCm);
  state.formError = validateBody(profile, { requireWeight: false });
  if (state.formError) {
    state.scrollTo = "#form-error";
    return render();
  }
  state.profile = profile;
  saveProfile(profile);
  state.form = formFromProfile(profile);
  clampCalMax();
  saveFasting(state.fasting);
  savePresets(state.presets, state.activePresetId);
  state.screen = "planner";
  state.scrollTo = "top";
  render();
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
  const saved = state.plans.find((plan) => plan.date === todayKey());
  if (!saved) return;
  state.draft = {
    lunch: findMeal(saved.lunchId),
    dinner: findMeal(saved.dinnerId),
    relaxed: false,
  };
}

async function boot() {
  const loaded = loadState();
  Object.assign(state, loaded);
  if (!state.presets?.length) state.presets = starterPresets();
  const savedFasting = state.fasting;
  state.onboardStep = !state.profile ? 1 : savedFasting ? 3 : 2;
  if (!state.fasting) state.fasting = { on: true, hours: 16, windowStartsAt: "12:00" };
  if (state.profile?.heightCm && state.profile?.weightKg) {
    state.profile.calories = baselineCalories(state.profile.weightKg, state.profile.heightCm);
    saveProfile(state.profile);
  }
  state.plans = dedupePlans(state.plans || []);
  state.form = formFromProfile(state.profile);
  state.screen = state.onboarded ? "home" : "onboard";
  if (state.profile) {
    clampCalMax();
    savePresets(state.presets, state.activePresetId);
  }
  render();
  try {
    state.meals = await loadMeals();
    restoreToday();
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
  if (input.dataset.fastHours || input.dataset.window || input.dataset.level || input.dataset.range) render();
});
boot();
