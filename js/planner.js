const LEVEL = { none: 0, less: 0.45, normal: 1, more: 1.8 };

export function isPork(meal) {
  if (!meal) return false;
  const blob = `${meal.name || ""} ${meal.categories || ""} ${meal.tags || ""}`;
  if (/\b(plant-based|vegan|vegetarian|mock meat)\b/i.test(blob) && !/\bpork\b/i.test(blob)) return false;
  if (/\b(pork|bacon|pancetta|prosciutto|pepperoni|andouille|guanciale|salami|speck|lard|ham)\b/i.test(blob)) return true;
  if (/\b(chorizo|sausage)\b/i.test(blob)) return true;
  return false;
}

export function preferenceMultiplier(meal, preset) {
  const flags = [
    ["fish", meal.is_fish],
    ["chicken", meal.is_chicken],
    ["meat", meal.is_meat],
    ["veggies", meal.is_veg],
  ];
  let multiplier = 1;
  for (const [key, on] of flags) {
    if (!on) continue;
    const preference = preset[key] || "normal";
    if (preference === "none") return 0;
    multiplier *= LEVEL[preference] ?? 1;
  }
  return multiplier;
}

export function weightFromRating(rating) {
  if (!rating?.overall) return 1;
  const stars = [0, 0.25, 0.55, 1, 1.45, 1.9];
  const again = [0, 0.45, 0.7, 1, 1.3, 1.65];
  const nudge = (value) => 0.92 + ((value || 3) - 1) * 0.04;
  const score =
    stars[rating.overall] *
    (0.4 + 0.6 * (again[rating.again] || 1)) *
    nudge(rating.delicious) *
    nudge(rating.full);
  return Math.min(3, Math.max(0.15, score));
}

export function ratingWords(weight) {
  if (weight > 1.15) {
    return "I'll bring this one forward. Surprise Me will offer it more often.";
  }
  if (weight < 0.85) {
    return "I'll tuck this one back. Surprise Me will offer it less often.";
  }
  return "This stays in the middle. Surprise Me will treat it like any other meal.";
}

export function dayTarget(profile) {
  if (!profile) return 0;
  return Math.round((Number(profile.calories) - Number(profile.deficit)) * 100) / 100;
}

export function meterFor(total, target) {
  if (!target) {
    return { tone: "wait", title: "Set your day first", detail: "" };
  }
  if (!total) {
    return {
      tone: "wait",
      title: `Your day is ${target} calories`,
      detail: "Lunch and dinner together.",
    };
  }
  const delta = Math.round((total - target) * 100) / 100;
  if (delta <= 0) {
    return {
      tone: "green",
      title: delta === 0 ? "Right on your plan" : "In plan",
      detail: delta === 0 ? "Lunch and dinner land on your number." : `${Math.abs(delta)} calories left`,
    };
  }
  if (delta <= target * 0.1) {
    return { tone: "gold", title: "A little over", detail: `${delta} calories over` };
  }
  return { tone: "red", title: "Over", detail: `${delta} calories over` };
}

function boundPenalty(value, range) {
  const [low, high] = range;
  if (value < low) return (low - value) / Math.max(low, 1);
  if (value > high) return (value - high) / Math.max(high, 1);
  return 0;
}

function pickWeighted(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];
  let cursor = Math.random() * total;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor <= 0) return item;
  }
  return items[items.length - 1];
}

export function surprisePair(meals, preset, weights, recentIds, avoidKey = "", fixed = null, seenIds = null) {
  const allowed = meals.filter((meal) => !isPork(meal));
  const usable = allowed.filter((meal) => preferenceMultiplier(meal, preset) > 0);
  const held = fixed?.meal && !isPork(fixed.meal) ? fixed.meal : null;
  if (!held && usable.length < 2) {
    return { error: "Every group is set to None, sis. Ease one slider and I'll try again." };
  }
  const lunches = held && fixed.slot === "lunch" ? [held] : usable;
  const dinners = held && fixed.slot === "dinner" ? [held] : usable;
  const share = preset.heavier === "lunch" ? 0.6 : preset.heavier === "dinner" ? 0.4 : 0.5;
  const scored = [];
  lunches.forEach((lunch) => {
    dinners.forEach((dinner) => {
      if (lunch.id === dinner.id) return;
      const lunchPref = held && fixed.slot === "lunch" ? 1 : preferenceMultiplier(lunch, preset);
      const dinnerPref = held && fixed.slot === "dinner" ? 1 : preferenceMultiplier(dinner, preset);
      if (!lunchPref || !dinnerPref) return;
      const calories = lunch.calories + dinner.calories;
      const penalty =
        boundPenalty(calories, preset.cal) +
        boundPenalty(lunch.protein + dinner.protein, preset.protein) +
        boundPenalty(lunch.carbs + dinner.carbs, preset.carbs) +
        boundPenalty(lunch.fat + dinner.fat, preset.fat);
      const split = Math.abs(lunch.calories - calories * share) / Math.max(calories, 1);
      const fit = 1 / (1 + penalty * 6);
      const splitFactor = 1 / (1 + split * 3);
      const base =
        lunchPref *
        (weights[lunch.id] || 1) *
        dinnerPref *
        (weights[dinner.id] || 1) *
        fit *
        splitFactor;
      scored.push({
        lunch,
        dinner,
        penalty,
        split,
        weight: Math.max(0.01, base),
      });
    });
  });
  if (!scored.length) {
    return { error: held
      ? "I need another meal to shuffle. Ease a slider or unlock this one."
      : "Every group is set to None, sis. Ease one slider and I'll try again." };
  }
  const offered = seenIds || new Set();
  const history = recentIds || new Set();
  const relaxed = scored.every((pair) => pair.penalty > 0);
  scored.sort((a, b) => a.penalty - b.penalty);
  const best = scored[0].penalty;
  const caps = [0, 0.15, 0.35, 0.6, 1, 1.5, 2.5, 100];

  const sameAsCurrent = (pair) => {
    if (!avoidKey) return false;
    const key = `${pair.lunch.id}-${pair.dinner.id}`;
    const swapped = `${pair.dinner.id}-${pair.lunch.id}`;
    return key === avoidKey || swapped === avoidKey;
  };
  const usesBlocked = (pair, blocked) => {
    if (!blocked?.size) return false;
    if (held && fixed.slot === "lunch") return blocked.has(pair.dinner.id);
    if (held && fixed.slot === "dinner") return blocked.has(pair.lunch.id);
    return blocked.has(pair.lunch.id) || blocked.has(pair.dinner.id);
  };
  const freshestBand = (blocked) => {
    for (const cap of caps) {
      const band = scored.filter((pair) => pair.penalty <= Math.max(cap, best) && !sameAsCurrent(pair) && !usesBlocked(pair, blocked));
      if (band.length) return band;
    }
    return [];
  };

  const skip = new Set([...offered, ...history]);
  let pool = freshestBand(skip);
  if (!pool.length && offered.size) {
    offered.clear();
    pool = freshestBand(history);
  }
  if (!pool.length) pool = freshestBand(new Set());
  if (!pool.length) pool = scored.filter((pair) => !sameAsCurrent(pair));
  if (!pool.length) pool = scored;
  const choice = pickWeighted(pool);
  return { lunch: choice.lunch, dinner: choice.dinner, relaxed };
}
