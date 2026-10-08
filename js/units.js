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

export function baselineCalories(weightKg, heightCm) {
  const shown = round2(bmi(weightKg, heightCm));
  if (!shown || !weightKg) return 0;
  let perKg = 22;
  if (shown < 18.5) perKg = 30;
  else if (shown < 25) perKg = 27;
  else if (shown < 30) perKg = 24;
  return round2(weightKg * perKg);
}

export function bmiBand(value) {
  const shown = round2(value);
  if (!shown) return { id: "fit", name: "Fit" };
  if (shown < 18.5) return { id: "light", name: "Light" };
  if (shown < 25) return { id: "fit", name: "Fit" };
  if (shown < 30) return { id: "over", name: "Over" };
  return { id: "obese", name: "Obese" };
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
