const shown = new Map();
const runs = new Map();

function digitsOf(el) {
  return Number(el?.dataset.digits) || 0;
}

function epsilon(digits) {
  return digits ? 0.51 / 10 ** digits : 0.51;
}

export function formatTick(value, digits) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  if (!digits) return String(Math.round(number));
  return number.toFixed(digits);
}

export function tickHTML(key, value, digits = 2, suffix = "") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `<span class="tick" data-tick="${key}" data-value="${number}" data-digits="${digits}" data-suffix="${suffix}">${formatTick(number, digits)}${suffix}</span>`;
}

function nodes(key) {
  return document.querySelectorAll(`[data-tick="${key}"]`);
}

function paint(key, value) {
  nodes(key).forEach((el) => {
    const digits = digitsOf(el);
    el.textContent = formatTick(value, digits) + (el.dataset.suffix || "");
  });
}

function finish(key, value, cancel) {
  paint(key, value);
  shown.set(key, value);
  nodes(key).forEach((el) => {
    el.style.transform = "";
    el.classList.remove("tick-up", "tick-down");
  });
  if (runs.get(key) === cancel) runs.delete(key);
}

function animateKey(key, from, to) {
  runs.get(key)?.();
  const sample = document.querySelector(`[data-tick="${key}"]`);
  if (!sample) {
    shown.set(key, to);
    return;
  }
  const digits = digitsOf(sample);
  const quantum = digits ? 1 / 10 ** digits : 1;
  const abs = Math.abs(to - from);
  const natural = Math.max(1, Math.round(abs / quantum));
  const ticks = Math.min(natural, Math.max(8, Math.min(24, Math.ceil(abs))));
  const duration = 500;
  const rising = to > from;
  const start = performance.now();
  let frame = 0;
  let stopped = false;
  const cancel = () => {
    stopped = true;
    cancelAnimationFrame(frame);
  };
  runs.set(key, cancel);
  nodes(key).forEach((el) => {
    el.classList.remove("tick-up", "tick-down");
    el.classList.add(rising ? "tick-up" : "tick-down");
  });
  paint(key, from);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    finish(key, to, cancel);
    return;
  }
  const step = (now) => {
    if (stopped) return;
    const t = Math.min(1, (now - start) / duration);
    const jumped = Math.min(1, Math.ceil(t * ticks) / ticks);
    const raw = from + (to - from) * jumped;
    const snapped = snap(raw, from, to, quantum);
    paint(key, snapped);
    shown.set(key, snapped);
    const pop = 1 + 0.62 * Math.sin(Math.PI * t);
    nodes(key).forEach((el) => {
      el.style.transform = `scale(${pop.toFixed(3)})`;
    });
    if (t < 1) frame = requestAnimationFrame(step);
    else finish(key, to, cancel);
  };
  frame = requestAnimationFrame(step);
}

function snap(value, from, to, quantum) {
  const steps = Math.round((value - from) / quantum);
  const snapped = from + steps * quantum;
  if (to >= from) return Math.min(to, Math.max(from, snapped));
  return Math.max(to, Math.min(from, snapped));
}

export function playTicks(root = document) {
  const keys = new Set();
  root.querySelectorAll("[data-tick]").forEach((el) => keys.add(el.dataset.tick));
  keys.forEach((key) => {
    const el = document.querySelector(`[data-tick="${key}"]`);
    const next = Number(el.dataset.value);
    const digits = digitsOf(el);
    if (!shown.has(key) || !Number.isFinite(shown.get(key))) {
      shown.set(key, next);
      return;
    }
    const prev = shown.get(key);
    if (Math.abs(prev - next) < epsilon(digits)) {
      shown.set(key, next);
      paint(key, next);
      return;
    }
    animateKey(key, prev, next);
  });
}

export function writeTick(el, value) {
  if (!el?.dataset?.tick) return;
  const key = el.dataset.tick;
  const next = Number(value);
  nodes(key).forEach((node) => {
    node.dataset.value = String(next);
  });
  const digits = digitsOf(el);
  if (!shown.has(key) || Math.abs(shown.get(key) - next) < epsilon(digits)) {
    shown.set(key, next);
    paint(key, next);
    return;
  }
  animateKey(key, shown.get(key), next);
}

export function seedTick(key, value) {
  shown.set(key, Number(value));
}
