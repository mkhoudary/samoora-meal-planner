export function kgToLb(kg) {
  return kg * 2.2046226218;
}

export function lbToKg(lb) {
  return lb / 2.2046226218;
}

export function cmToFtIn(cm) {
  const total = Math.round(cm / 2.54);
  let feet = Math.floor(total / 12);
  let inches = total - feet * 12;
  if (inches === 12) {
    feet += 1;
    inches = 0;
  }
  return { feet, inches };
}

export function ftInToCm(feet, inches) {
  return (Number(feet) * 12 + Number(inches)) * 2.54;
}

export function round2(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

export function bmi(weightKg, heightCm) {
  const meters = heightCm / 100;
  if (!meters) return 0;
  return weightKg / (meters * meters);
}

export const ACTIVITY = [
  { name: "No activity", factor: 1.2, text: "Mostly sitting, with only the walking a quiet day needs." },
  { name: "Light", factor: 1.375, text: "On your feet for ordinary chores, or a walk on a few days a week." },
  { name: "Moderate", factor: 1.55, text: "A real workout several days a week, such as a brisk walk, a class, or lifting." },
  { name: "Active", factor: 1.725, text: "Hard exercise or a job on your feet, most days." },
  { name: "Most active", factor: 1.9, text: "Hard training every day, or heavy physical work plus exercise." },
];

export function activityIndex(value) {
  if (value == null || value === "") return 1;
  const index = Math.round(Number(value));
  if (!Number.isFinite(index)) return 1;
  return Math.min(ACTIVITY.length - 1, Math.max(0, index));
}

export function personAge(value) {
  if (value == null || value === "") return 30;
  const age = Math.round(Number(value));
  if (!Number.isFinite(age)) return 30;
  return Math.min(80, Math.max(18, age));
}

export function baselineCalories(weightKg, heightCm, person = {}) {
  if (!weightKg || !heightCm) return 0;
  const age = personAge(person.age);
  const sex = person.gender === "male" ? 5 : -161;
  const resting = 10 * weightKg + 6.25 * heightCm - 5 * age + sex;
  if (!(resting > 0)) return 0;
  return round2(resting * ACTIVITY[activityIndex(person.activity)].factor);
}

export function bmiBand(value) {
  const shown = round2(value);
  if (!shown) return { id: "fit", name: "Fit" };
  if (shown < 18.5) return { id: "light", name: "Light" };
  if (shown < 25) return { id: "fit", name: "Fit" };
  if (shown < 30) return { id: "over", name: "Over" };
  return { id: "obese", name: "Obese" };
}

export function weeklyLossGrams(deficit) {
  const cut = Math.max(0, Math.round(Number(deficit) || 0));
  return Math.round(cut * 7 * 1000 / 7700);
}

export function deficitWords(deficit, baseline) {
  const cut = Math.max(0, Math.round(Number(deficit) || 0));
  if (!cut) return { id: "even", name: "Even" };
  const share = baseline > 0 ? cut / baseline : 1;
  if (share < 0.1) return { id: "gentle", name: "Gentle" };
  if (share < 0.2) return { id: "steady", name: "Steady" };
  if (share < 0.3) return { id: "strong", name: "Strong" };
  return { id: "steep", name: "Steep" };
}

export function formatWeight(kg, unit) {
  const value = unit === "lb" ? kgToLb(kg) : kg;
  return `${(Math.round(value * 10) / 10).toFixed(1)} ${unit}`;
}

export function clockLabel(hhmm) {
  const [hourText, minuteText] = String(hhmm || "12:00").split(":");
  const date = new Date();
  date.setHours(Number(hourText) || 0, Number(minuteText) || 0, 0, 0);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
