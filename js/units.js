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

export function bmi(weightKg, heightCm) {
  const meters = heightCm / 100;
  if (!meters) return 0;
  return weightKg / (meters * meters);
}

export function bmiWords(value) {
  if (!value || Number.isNaN(value)) return "Enter your height and weight and I'll show the picture.";
  const shown = Math.round(value * 10) / 10;
  if (shown < 18.5) return "You're on the lighter side of the usual chart. It's only a picture, not a grade.";
  if (shown < 25) return "This sits in the middle of the usual chart. Just a picture, sis.";
  if (shown < 30) return "This sits a little above the middle of the usual chart. Still only a picture.";
  return "This sits higher on the usual chart. It does not know you, and it stays right here.";
}

export function formatWeight(kg, unit) {
  const value = unit === "lb" ? kgToLb(kg) : kg;
  return `${Math.round(value * 10) / 10} ${unit}`;
}

export function clockLabel(hhmm) {
  const [hourText, minuteText] = String(hhmm || "12:00").split(":");
  const date = new Date();
  date.setHours(Number(hourText) || 0, Number(minuteText) || 0, 0, 0);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
