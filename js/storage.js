const KEYS = {
  profile: "samoora.profile",
  fasting: "samoora.fasting",
  presets: "samoora.presets",
  active: "samoora.activePreset",
  plans: "samoora.plans",
  mealWeights: "samoora.mealWeights",
  weightLog: "samoora.weightLog",
  cheer: "samoora.cheerIndex",
  onboarded: "samoora.onboarded",
};

export function read(key, fallback) {
  try {
    const raw = localStorage.getItem(KEYS[key]);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function write(key, value) {
  localStorage.setItem(KEYS[key], JSON.stringify(value));
}

export const LEVELS = ["none", "less", "normal", "more"];
export const LEVEL_LABELS = ["None", "Less", "Normal", "More"];

function preset(id, name, cal, protein, carbs, fat, heavier = "even") {
  return {
    id,
    name,
    cal,
    protein,
    carbs,
    fat,
    heavier,
    fish: "normal",
    chicken: "normal",
    meat: "normal",
    veggies: "normal",
  };
}

export function starterPresets() {
  return [
    preset("gentle", "Gentle", [0, 100000], [80, 120], [30, 40], [50, 70]),
    preset("balanced", "Balanced", [0, 100000], [80, 120], [30, 40], [50, 70]),
    preset("hearty", "Hearty", [0, 100000], [80, 120], [30, 40], [50, 70]),
  ];
}

export function loadState() {
  const presets = read("presets", null);
  return {
    profile: read("profile", null),
    fasting: read("fasting", null),
    presets: presets && presets.length ? presets : starterPresets(),
    activePresetId: read("active", "balanced"),
    plans: read("plans", []),
    mealWeights: read("mealWeights", {}),
    weightLog: read("weightLog", []),
    cheerIndex: read("cheer", 0),
    onboarded: read("onboarded", false),
  };
}

export function saveProfile(profile) {
  write("profile", profile);
}

export function saveFasting(fasting) {
  write("fasting", fasting);
}

export function savePresets(presets, activePresetId) {
  write("presets", presets);
  write("active", activePresetId);
}

export function savePlans(plans) {
  write("plans", plans);
}

export function saveMealWeights(weights) {
  write("mealWeights", weights);
}

export function saveWeightLog(log) {
  write("weightLog", log);
}

export function saveCheer(index) {
  write("cheer", index);
}

export function saveOnboarded(done) {
  write("onboarded", done);
}
