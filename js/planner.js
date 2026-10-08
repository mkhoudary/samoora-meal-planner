const LEVEL = { none: 0, less: 0.45, normal: 1, more: 1.8 };

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

export function surprisePair(meals, preset, weights, recentIds, avoidKey = "") {
  const usable = meals.filter((meal) => preferenceMultiplier(meal, preset) > 0);
  if (usable.length < 2) {
    return { error: "Every group is set to None, sis. Ease one slider and I'll try again." };
  }
  const share = preset.heavier === "lunch" ? 0.6 : preset.heavier === "dinner" ? 0.4 : 0.5;
  const scored = [];
  for (let i = 0; i < usable.length; i += 1) {
    for (let j = 0; j < usable.length; j += 1) {
      if (i === j) continue;
      const lunch = usable[i];
      const dinner = usable[j];
      const calories = lunch.calories + dinner.calories;
      const penalty =
        boundPenalty(calories, preset.cal) +
        boundPenalty(lunch.protein + dinner.protein, preset.protein) +
        boundPenalty(lunch.carbs + dinner.carbs, preset.carbs) +
        boundPenalty(lunch.fat + dinner.fat, preset.fat);
      const split = Math.abs(lunch.calories - calories * share) / Math.max(calories, 1);
      const base =
        preferenceMultiplier(lunch, preset) *
        (weights[lunch.id] || 1) *
        preferenceMultiplier(dinner, preset) *
        (weights[dinner.id] || 1);
      const recent =
        (recentIds.has(lunch.id) ? 0.4 : 1) * (recentIds.has(dinner.id) ? 0.4 : 1);
      scored.push({
        lunch,
        dinner,
        penalty,
        split,
        weight: Math.max(0.05, base * recent),
      });
    }
  }
  let pool = scored.filter((pair) => pair.penalty === 0);
  let relaxed = false;
  if (!pool.length) {
    relaxed = true;
    scored.sort((a, b) => a.penalty - b.penalty || a.split - b.split);
    const best = scored[0].penalty;
    pool = scored.filter((pair) => pair.penalty <= best + 0.15).slice(0, 40);
  } else {
    pool.sort((a, b) => a.split - b.split);
    const bestSplit = pool[0].split;
    const close = pool.filter((pair) => pair.split <= bestSplit + 0.12);
    pool = close.length >= 8 ? close : pool.slice(0, 80);
  }
  let choice = pickWeighted(pool);
  const key = `${choice.lunch.id}-${choice.dinner.id}`;
  if (avoidKey && key === avoidKey && pool.length > 1) {
    const other = pool.filter((pair) => `${pair.lunch.id}-${pair.dinner.id}` !== avoidKey);
    if (other.length) choice = pickWeighted(other);
  }
  return { lunch: choice.lunch, dinner: choice.dinner, relaxed };
}
