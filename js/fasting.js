import { clockLabel } from "./units.js";

export function fastingStatus(fasting, now = new Date()) {
  if (!fasting?.on) {
    return { enabled: false, phase: "eating", remainingMin: 0 };
  }
  const [hourText, minuteText] = String(fasting.windowStartsAt || "12:00").split(":");
  const start = (Number(hourText) || 0) * 60 + (Number(minuteText) || 0);
  const hours = Number(fasting.hours) || 16;
  const eatLen = Math.max(0, Math.round((24 - hours) * 60));
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const end = (start + eatLen) % 1440;
  let eating = false;
  if (eatLen > 0 && start + eatLen <= 1440) {
    eating = nowMin >= start && nowMin < start + eatLen;
  } else if (eatLen > 0) {
    eating = nowMin >= start || nowMin < end;
  }
  let remaining = eating
    ? (start + eatLen - nowMin + 1440) % 1440
    : (start - nowMin + 1440) % 1440;
  if (remaining === 0) remaining = eating ? eatLen : hours * 60;
  const fastMin = hours * 60;
  const progress = eating
    ? 1 - remaining / Math.max(eatLen, 1)
    : 1 - remaining / Math.max(fastMin, 1);
  return {
    enabled: true,
    phase: eating ? "eating" : "fasting",
    remainingMin: remaining,
    windowOpens: clockLabel(fasting.windowStartsAt),
    windowCloses: clockLabel(minutesToHHMM(end)),
    hours,
    eatHours: 24 - hours,
    progress: Math.min(1, Math.max(0, progress)),
  };
}

function minutesToHHMM(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = Math.floor(mins % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatRemaining(mins) {
  const total = Math.max(0, Math.round(mins));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours <= 0) return `${minutes} min`;
  return `${hours}h ${minutes}m`;
}
