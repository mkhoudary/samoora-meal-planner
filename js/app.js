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
import {
  baselineCalories,
  bmi,
  bmiWords,
  cmToFtIn,
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
  cookMeal: null,
  cheer: "",
  ratingDraft: {},
  ratingNote: "",
  justConfirmed: false,
  pairKey: "",
  weightForm: null,
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

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function todayKey(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function prettyDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
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
    cm: Math.round(heightCm),
    weight: unit === "lb" ? round1(kgToLb(weightKg)) : round1(weightKg),
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
  return `<header class="top"><img class="logo" src="./assets/logo.png" alt="Samoora Meal Planner"><nav>
    <button class="ghost" data-action="prefs">Preferences</button>
    <button class="ghost" data-action="weight">Update my weight</button>
  </nav></header>`;
}

function macroField(key, label, min, max, step) {
  const range = activePreset()[key];
  return `<div class="macro"><strong>${label}</strong>
    <label><span>Greater than <output id="${key}MinOut">${range[0]}</output></span>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${range[0]}" data-range="${key}" data-end="0">
    </label>
    <label><span>Less than <output id="${key}MaxOut">${range[1]}</output></span>
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
      <label><span>Fast length <output id="fastHoursOut">${hours}</output> hours</span>
        <input type="range" min="12" max="20" step="1" value="${hours}" data-fast-hours="1">
      </label>
      <label>Eating window opens
        <input type="time" value="${esc(fasting.windowStartsAt || "12:00")}" data-window="1">
      </label>
      <p>You fast ${hours} hours, then eat for ${24 - hours}, starting at ${esc(clockLabel(fasting.windowStartsAt))}.</p>
    </div>` : `<p class="quiet">The app stays in the warm eating look.</p>`}
  </div>`;
}

function pictureBlock() {
  const profile = profileFromForm();
  const picture = bmi(profile.weightKg, profile.heightCm);
  const target = Math.round(profile.calories - Number(state.form.deficit));
  return `<span class="kicker">BMI</span><strong>${picture ? picture.toFixed(1) : "—"}</strong>
    <p class="quiet">${esc(bmiWords(picture))}</p>
    <p>Baseline <strong>${profile.calories || "—"}</strong> calories. This comes from your BMI, and it stays calculated.</p>
    <p>Lunch and dinner aim for <strong>${target > 0 ? target : "—"}</strong> calories.</p>`;
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
      ? `<div class="split"><label>Feet<input id="feet" type="number" min="4" max="7" value="${esc(form.feet)}" data-form="feet"></label>
         <label>Inches<input id="inches" type="number" min="0" max="11" value="${esc(form.inches)}" data-form="inches"></label></div>`
      : `<label>Height in centimeters<input id="cm" type="number" min="120" max="230" value="${esc(form.cm)}" data-form="cm"></label>`}
    ${weight ? `<label>Weight in ${imperial ? "pounds" : "kilograms"}<input id="bodyWeight" type="number" min="1" step="0.1" value="${esc(form.weight)}" data-form="weight"></label>` : `<p>Latest weight: <strong>${esc(formatWeight(state.profile.weightKg, form.unit))}</strong></p>`}
    <label>Deficit<input id="deficit" type="number" min="0" step="1" value="${esc(form.deficit)}" data-form="deficit"></label>
    <div class="bmi">${pictureBlock()}</div>
    ${state.formError ? `<p class="warn">${esc(state.formError)}</p>` : ""}
  </div>`;
}

function mealCard(meal, slot) {
  if (!meal) {
    return `<article class="meal"><p class="slot">${slot}</p><p class="quiet">Nothing here yet.</p></article>`;
  }
  const pills = String(meal.categories || "").split(";").map((item) => item.trim()).filter(Boolean).slice(0, 6);
  return `<article class="meal"><p class="slot">${slot}</p><h3>${esc(meal.name)}</h3>
    <p class="quiet">${esc(meal.chef || "CookUnity")}</p>
    <div class="stats">
      <span>${Math.round(meal.calories)} cal</span>
      <span>${round1(meal.protein)}g protein</span>
      <span>${round1(meal.carbs)}g carbs</span>
      <span>${round1(meal.fat)}g fat</span>
    </div>
    <div class="pills">${pills.map((pill) => `<span>${esc(pill)}</span>`).join("")}</div>
    ${meal.cookunity_labels ? `<p class="note">${esc(meal.cookunity_labels)}</p>` : ""}
    ${meal.nutrition_labels ? `<p class="note">${esc(meal.nutrition_labels)}</p>` : ""}
    <button class="primary" type="button" data-action="cook" data-id="${meal.id}">View on CookUnity</button>
  </article>`;
}

function meterHTML(total) {
  const target = dayTarget(state.profile);
  const meter = meterFor(total, target);
  const width = target ? Math.min(100, Math.round((total / target) * 100)) : 0;
  const pose = meter.tone === "green" ? "thumbs" : meter.tone === "gold" ? "thinking" : meter.tone === "red" ? "calm" : "clipboard";
  const line = meter.tone === "green"
    ? "You're inside the plan. I like this."
    : meter.tone === "gold"
      ? "Close. A little over, and you can still change one."
      : meter.tone === "red"
        ? "You're past the number. That's information, not a scolding. You can swap a meal."
        : "Two meals, one day. You're holding the plan.";
  return `${host(pose, `<p class="privacy">${esc(line)}</p>`)}
    <div class="meter ${meter.tone}" role="status"><strong>${esc(meter.title)}</strong><span>${esc(meter.detail)}</span>
      ${total ? `<div class="bar"><span style="width:${width}%"></span></div>` : ""}</div>`;
}

function resultsHTML() {
  const query = state.search.trim().toLowerCase();
  const matches = state.meals.filter((meal) => {
    if (!query) return true;
    return `${meal.name} ${meal.chef}`.toLowerCase().includes(query);
  });
  const shown = matches.slice(0, 30);
  if (!shown.length) return `<p class="quiet">I couldn't find that one.</p>`;
  return `<p class="quiet">Showing ${shown.length} of ${matches.length}</p>` + shown.map((meal) => `<div class="result">
    <div><strong>${esc(meal.name)}</strong><div class="quiet">${Math.round(meal.calories)} cal · ${esc(meal.chef || "")}</div></div>
    <div class="row">
      <button class="tiny" type="button" data-action="assign" data-slot="lunch" data-id="${meal.id}">Lunch</button>
      <button class="tiny" type="button" data-action="assign" data-slot="dinner" data-id="${meal.id}">Dinner</button>
    </div></div>`).join("");
}

function stars(planDate, slot, field, current) {
  return `<div class="stars">${[1, 2, 3, 4, 5].map((value) =>
    `<button type="button" class="${current >= value ? "on" : ""}" data-action="rate" data-plan="${esc(planDate)}" data-slot="${slot}" data-field="${field}" data-value="${value}" aria-label="${value} of 5">${value <= (current || 0) ? "★" : "☆"}</button>`
  ).join("")}</div>`;
}

function ratingCard(plan) {
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
  return `<section class="card"><h2>${esc(prettyDate(plan.date))}</h2>${block("lunch", lunch)}${block("dinner", dinner)}</section>`;
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
      ${labeled.has(index) ? `<text x="${x}" y="${y - 28}" text-anchor="middle">${esc(`${round1(point.value)} ${unit}`)}</text><text x="${x}" y="${y - 14}" text-anchor="middle">${esc(stamp(point.at))}</text>` : ""}`;
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
  return `${header()}<main class="wrap"><h1>${weekly ? "A week went by" : "Your weight"}</h1>
    ${host(pose, speech)}
    <div class="card fields">
      <div class="choice row">
        <button type="button" data-action="weight-unit" data-value="lb" aria-pressed="${form.unit === "lb"}">Pounds</button>
        <button type="button" data-action="weight-unit" data-value="kg" aria-pressed="${form.unit === "kg"}">Kilograms</button>
      </div>
      <label>Weight in ${form.unit}
        <input id="weightNow" type="number" min="1" step="0.1" value="${esc(form.value)}" data-weight="1">
      </label>
      ${state.formError ? `<p class="warn">${esc(state.formError)}</p>` : ""}
      <div class="row">
        <button class="primary" type="button" data-action="save-weight">Save this check-in</button>
        ${weekly ? `<button class="ghost" type="button" data-action="plan-first">I'll plan first</button>` : `<button class="ghost" type="button" data-action="today">Back to today</button>`}
      </div>
    </div>
    <section class="card chart-card" style="margin-top:14px"><h2>Your chart</h2>
      ${state.weightLog.length ? chartSVG(state.weightLog, form.unit) : `<p class="quiet">Your first check-in will land here.</p>`}
      <ul class="log">${state.weightLog.map((entry) => `<li>${esc(stamp(entry.at))} · ${esc(formatWeight(entry.kg, form.unit))}</li>`).join("")}</ul>
    </section>
    ${state.cheer ? `<div class="row" style="margin-top:14px"><button class="primary" type="button" data-action="today">Let's plan</button></div>` : ""}
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
    ${step === 1 ? bodyFields({ weight: true }) : ""}
    ${step === 2 ? fastingFields() : ""}
    ${step === 3 ? presetEditor() : ""}
    <div class="row" style="margin-top:16px">
      ${step > 1 ? `<button class="ghost" type="button" data-action="back">Back</button>` : ""}
      <button class="primary" type="button" data-action="next">${step === 3 ? "Save and start" : "Continue"}</button>
    </div>
    ${footer()}</main>`;
}

function renderToday() {
  const due = weightIsDue() && sessionStorage.getItem("samoora.weightLater") !== "1";
  if (due) {
    openWeightForm();
    return weightScreen({ weekly: true });
  }
  const status = fastingStatus(state.fasting);
  const lunch = state.draft.lunch;
  const dinner = state.draft.dinner;
  const total = Math.round((lunch?.calories || 0) + (dinner?.calories || 0));
  const past = state.plans.filter((plan) => plan.date < todayKey() && (!plan.ratings?.lunch?.overall || !plan.ratings?.dinner?.overall));
  const savedToday = state.plans.find((plan) => plan.date === todayKey());
  const sameMeal = lunch && dinner && lunch.id === dinner.id;
  const fastingNow = status.enabled && status.phase === "fasting";
  return `${header()}<main class="wrap">
    <p class="quiet">${esc(prettyDate(todayKey()))}</p>
    <h1>${fastingNow ? "You're fasting" : "Today"}</h1>
    ${past.length ? `${host("eating", "<p>Before a new day, tell me how those meals were. Your stars change what I offer next.</p>")}${past.map(ratingCard).join("")}` : ""}
    ${fastingNow ? `<section class="clock-block">
        <div class="ring" style="--p:${Math.round(status.progress * 100)}"><div class="ring-hole"><strong id="fastClock">${esc(formatRemaining(status.remainingMin))}</strong><span>left in the fast</span></div></div>
        <div>${host("fasting", `<p class="privacy">I'm right here with you. You eat at ${esc(status.windowOpens)}.</p><p class="quiet">${PRIVACY}</p>`)}</div>
      </section>
      <h2>For when you eat</h2>` : host(state.pickMode ? "grocery" : "chef", `<p>${state.pickMode ? "Pick lunch and dinner yourself. I'll keep the count beside you." : "Surprise Me uses the preset you saved. Or pick the meals yourself."}</p>`)}
    ${status.enabled && !fastingNow ? `<p class="banner">Eating window until ${esc(status.windowCloses)}.</p>` : ""}
    ${state.justConfirmed ? `<p class="banner">Saved on this device. When you've eaten, come back and tell me how it was.</p>` : ""}
    ${state.draft.error ? `<p class="warn">${esc(state.draft.error)}</p>` : ""}
    ${state.draft.relaxed ? `<p class="banner">This is the closest pair I could find. The meter tells the truth.</p>` : ""}
    ${meterHTML(total)}
    <div class="meals">${mealCard(lunch, "Lunch")}${mealCard(dinner, "Dinner")}</div>
    <div class="row" style="margin:14px 0">
      <button class="primary mode" type="button" data-action="surprise">Surprise Me</button>
      <button class="ghost mode" type="button" data-action="pick-mode" aria-pressed="${state.pickMode}">I'll pick</button>
      <button class="primary" type="button" data-action="confirm" ${lunch && dinner && !sameMeal ? "" : "disabled"}>Confirm</button>
    </div>
    ${sameMeal ? `<p class="warn">Pick two different meals, sis.</p>` : ""}
    ${state.pickMode ? `<section class="card"><label>Search the menu<input id="mealSearch" type="search" value="${esc(state.search)}" placeholder="Chicken, salmon, a chef..."></label><div id="mealResults" class="results">${resultsHTML()}</div></section>` : ""}
    ${savedToday && (!savedToday.ratings?.lunch?.overall || !savedToday.ratings?.dinner?.overall) ? `${host("eating", "<p>When you've eaten, tell me how it was. Higher stars bring a meal forward. Lower stars tuck it back.</p>")}${ratingCard(savedToday)}` : ""}
    ${state.ratingNote ? `<p class="banner">${esc(state.ratingNote)}</p>` : ""}
    ${footer()}</main>
    ${state.cookMeal ? cookPanel(state.cookMeal) : ""}`;
}

function cookPanel(meal) {
  return `<div class="backdrop" data-action="close-cook"></div>
    <aside class="cook" role="dialog" aria-label="CookUnity">
      <header><img src="./assets/characters/peek.png" alt="Mohammed">
        <div><strong>${esc(meal.name)}</strong><div><a href="${esc(meal.url)}" target="_blank" rel="noopener">Open in a new tab</a></div></div>
        <button class="ghost" type="button" data-action="close-cook">Close</button>
      </header>
      <iframe src="${esc(meal.url)}" title="CookUnity"></iframe>
      <p>If this stays blank, CookUnity is keeping the page on their site. The link above still opens it.</p>
    </aside>`;
}

function renderPrefs() {
  return `${header()}<main class="wrap"><h1>Preferences</h1>
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
      <button class="ghost" type="button" data-action="today">Back to today</button>
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
  if (state.screen === "loading") {
    app.innerHTML = `<div class="hero-logo"><img src="./assets/logo.png" alt="Samoora Meal Planner"><p class="love">Setting the table...</p></div>`;
    return;
  }
  if (state.screen === "error") {
    app.innerHTML = `<main class="wrap"><h1>I couldn't open the menu</h1><p>${esc(state.error)}</p></main>`;
    return;
  }
  if (!state.onboarded || state.screen === "onboard") app.innerHTML = renderOnboard();
  else if (state.screen === "weight") app.innerHTML = weightScreen({ weekly: false });
  else if (state.screen === "prefs") app.innerHTML = renderPrefs();
  else app.innerHTML = renderToday();
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
  state.weightForm = { unit, value: unit === "lb" ? round1(kgToLb(kg)) : round1(kg) };
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
  if (next[0] > next[1]) next[end === 0 ? 1 : 0] = value;
  preset[input.dataset.range] = next;
  const minOut = document.getElementById(`${input.dataset.range}MinOut`);
  const maxOut = document.getElementById(`${input.dataset.range}MaxOut`);
  if (minOut) minOut.textContent = next[0];
  if (maxOut) maxOut.textContent = next[1];
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
    const result = surprisePair(state.meals, activePreset(), state.mealWeights, recentMealIds(), state.pairKey);
    if (result.error) {
      state.notice = result.error;
      state.draft = { lunch: null, dinner: null, relaxed: false, error: result.error };
    } else {
      state.draft = { lunch: result.lunch, dinner: result.dinner, relaxed: result.relaxed };
      state.pairKey = `${result.lunch.id}-${result.dinner.id}`;
    }
    state.pickMode = false;
    state.justConfirmed = false;
    render();
  }
  if (action === "pick-mode") {
    state.pickMode = true;
    render();
  }
  if (action === "assign") {
    const meal = findMeal(Number(button.dataset.id));
    state.draft[button.dataset.slot] = meal;
    state.draft.relaxed = false;
    state.draft.error = "";
    state.justConfirmed = false;
    render();
    const search = document.getElementById("mealSearch");
    if (search) search.focus();
  }
  if (action === "confirm") confirmDay();
  if (action === "cook") state.cookMeal = findMeal(Number(button.dataset.id));
  if (action === "close-cook") state.cookMeal = null;
  if (action === "prefs") {
    state.form = formFromProfile(state.profile);
    state.formError = "";
    state.screen = "prefs";
  }
  if (action === "weight") {
    state.weightForm = null;
    state.cheer = "";
    state.formError = "";
    openWeightForm();
    state.screen = "weight";
  }
  if (action === "today") {
    state.screen = "today";
    state.cheer = "";
  }
  if (action === "plan-first") sessionStorage.setItem("samoora.weightLater", "1");
  if (action === "weight-unit") {
    const kg = state.weightForm.unit === "lb" ? lbToKg(state.weightForm.value) : Number(state.weightForm.value);
    state.weightForm.unit = button.dataset.value;
    state.weightForm.value = state.weightForm.unit === "lb" ? round1(kgToLb(kg)) : round1(kg);
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
  if (["cook", "close-cook", "prefs", "weight", "today", "plan-first"].includes(action)) render();
}

function onInput(event) {
  const input = event.target;
  if (input.dataset.form) {
    state.form[input.dataset.form] = input.type === "number" ? Number(input.value) : input.value;
    const box = document.querySelector(".bmi");
    if (box) box.innerHTML = pictureBlock();
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
    const out = document.getElementById("fastHoursOut");
    if (out) out.textContent = input.value;
  }
  if (input.dataset.window) state.fasting.windowStartsAt = input.value;
  if (input.dataset.presetName) activePreset().name = input.value;
  if (input.dataset.weight) state.weightForm.value = Number(input.value);
  if (input.id === "mealSearch") {
    state.search = input.value;
    const box = document.getElementById("mealResults");
    if (box) box.innerHTML = resultsHTML();
  }
}

function continueOnboard() {
  state.formError = "";
  if (state.onboardStep === 1) {
    const profile = profileFromForm();
    state.formError = validateBody(profile);
    if (state.formError) return render();
    state.profile = profile;
    saveProfile(profile);
    if (!state.weightLog.length) {
      state.weightLog.push({ at: new Date().toISOString(), kg: profile.weightKg });
      saveWeightLog(state.weightLog);
    }
    state.onboardStep = 2;
    return render();
  }
  if (state.onboardStep === 2) {
    saveFasting(state.fasting);
    state.onboardStep = 3;
    return render();
  }
  savePresets(state.presets, state.activePresetId);
  saveOnboarded(true);
  state.onboarded = true;
  state.screen = "today";
  render();
}

function confirmDay() {
  const lunch = state.draft.lunch;
  const dinner = state.draft.dinner;
  if (!lunch || !dinner || lunch.id === dinner.id) return;
  const date = todayKey();
  const previous = state.plans.find((plan) => plan.date === date);
  const same = previous && previous.lunchId === lunch.id && previous.dinnerId === dinner.id;
  const plan = {
    date,
    lunchId: lunch.id,
    dinnerId: dinner.id,
    target: dayTarget(state.profile),
    presetName: activePreset().name,
    confirmedAt: new Date().toISOString(),
    ratings: same ? previous.ratings : { lunch: null, dinner: null },
  };
  state.plans = [plan, ...state.plans.filter((item) => item.date !== date)];
  savePlans(state.plans);
  state.justConfirmed = true;
  render();
}

function saveRating(planDate, slot) {
  const draft = state.ratingDraft[planDate]?.[slot];
  if (!draft?.overall || !draft.delicious || !draft.full || !draft.again) {
    state.ratingNote = "Tell me all four, sis, then I'll remember it.";
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
    render();
    return;
  }
  state.profile.unit = state.weightForm.unit;
  state.profile.weightKg = kg;
  state.profile.calories = baselineCalories(kg, state.profile.heightCm);
  saveProfile(state.profile);
  state.weightLog.push({ at: new Date().toISOString(), kg });
  saveWeightLog(state.weightLog);
  state.form = formFromProfile(state.profile);
  state.formError = "";
  state.cheer = nextCheer();
  state.weightForm = { unit: state.profile.unit, value: state.profile.unit === "lb" ? round1(kgToLb(kg)) : round1(kg) };
  state.screen = "weight";
  sessionStorage.removeItem("samoora.weightLater");
  render();
}

function savePrefs() {
  const profile = profileFromForm();
  profile.weightKg = state.profile.weightKg;
  state.formError = validateBody(profile, { requireWeight: false });
  if (state.formError) return render();
  state.profile = profile;
  saveProfile(profile);
  saveFasting(state.fasting);
  savePresets(state.presets, state.activePresetId);
  state.screen = "today";
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
  state.form = formFromProfile(state.profile);
  state.screen = state.onboarded ? "today" : "onboard";
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
      clock.textContent = formatRemaining(status.remainingMin);
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
