export async function loadMeals() {
  const initSqlJs = globalThis.initSqlJs;
  if (!initSqlJs) throw new Error("SQLite could not start.");
  const SQL = await initSqlJs({
    locateFile: (file) => `./vendor/${file}?v=${globalThis.SAMOORA_UI || ""}`,
  });
  const response = await fetch(`./data/menu.sqlite?v=${globalThis.SAMOORA_UI || ""}`);
  if (!response.ok) throw new Error("The menu database did not load.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  const db = new SQL.Database(bytes);
  const result = db.exec(`
    SELECT id, name, chef, categories, tags, url,
           calories, protein, carbs, fat, protein_per_100,
           nutrition_labels, cookunity_labels,
           is_fish, is_chicken, is_meat, is_veg
    FROM meals
    ORDER BY name
  `);
  db.close();
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map((row) => {
    const meal = {};
    columns.forEach((column, index) => {
      meal[column] = row[index];
    });
    meal.calories = Number(meal.calories) || 0;
    meal.protein = Number(meal.protein) || 0;
    meal.carbs = Number(meal.carbs) || 0;
    meal.fat = Number(meal.fat) || 0;
    meal.is_fish = Number(meal.is_fish) || 0;
    meal.is_chicken = Number(meal.is_chicken) || 0;
    meal.is_meat = Number(meal.is_meat) || 0;
    meal.is_veg = Number(meal.is_veg) || 0;
    return meal;
  });
}

async function initDatabase() {
  const initSqlJs = globalThis.initSqlJs;
  if (!initSqlJs) throw new Error("SQLite could not start.");
  return initSqlJs({
    locateFile: (file) => `./vendor/${file}?v=${globalThis.SAMOORA_UI || ""}`,
  });
}

export async function loadCustomMenuMeals(bytes) {
  const SQL = await initDatabase();
  let db;
  try {
    db = new SQL.Database(bytes);
    let result;
    try {
      result = db.exec(`
        SELECT id, custom_key, name, chef, categories, url, calories, protein, carbs, fat
        FROM meals
        ORDER BY name
      `);
    } catch (error) {
      if (!String(error?.message || error).includes("no such column")) throw error;
      result = db.exec(`
        SELECT id, name, chef, categories, url, calories, protein, carbs, fat
        FROM meals
        ORDER BY name
      `);
    }
    if (!result.length) return [];
    const { columns, values } = result[0];
    return values.map((row) => {
      const meal = {};
      columns.forEach((column, index) => {
        meal[column] = row[index];
      });
      if (!meal.custom_key && Number.isInteger(meal.id) && meal.id > 0) meal.legacy_id = meal.id;
      meal.custom_key ||= customMealKey(meal);
      return meal;
    });
  } finally {
    db?.close();
  }
}

export function customMealKey(meal) {
  return JSON.stringify([
    meal.name || "",
    meal.chef || "",
    meal.categories || "",
    meal.url || "",
  ]);
}

function customMealHash(key) {
  let hash = 1469598103934665603n;
  for (const character of key) {
    hash ^= BigInt(character.codePointAt(0));
    hash *= 1099511628211n;
    hash &= (1n << 52n) - 1n;
  }
  return Number(hash || 1n);
}

function customMealFlags(meal) {
  const text = `${meal.name || ""} ${meal.categories || ""}`.toLowerCase();
  return {
    is_fish: /\b(fish|salmon|tuna|cod|tilapia|shrimp|seafood)\b/.test(text) ? 1 : 0,
    is_chicken: /\b(chicken|poultry)\b/.test(text) ? 1 : 0,
    is_meat: /\b(beef|lamb|steak|turkey|meat)\b/.test(text) ? 1 : 0,
    is_veg: /\b(plant-based|vegan|vegetarian|vegetables?)\b/.test(text) ? 1 : 0,
  };
}

export function mapCustomMenuMeals(meals, reservedIds = [], knownIds = new Map()) {
  const used = new Set(reservedIds);
  const mapped = meals.map((meal) => {
    const normalized = {
      ...meal,
      url: meal.url ?? meal.cookunity_url ?? "",
    };
    const customKey = normalized.custom_key || customMealKey(normalized);
    return {
      ...normalized,
      ...customMealFlags(normalized),
      custom_key: customKey,
      _customMenuKey: customKey,
    };
  });
  const assignedKeys = new Set();
  const assignedIds = new Set();
  mapped.forEach((meal) => {
    if (assignedKeys.has(meal._customMenuKey)) {
      throw new Error(`Duplicate custom meal identity: "${meal.name}".`);
    }
    assignedKeys.add(meal._customMenuKey);
    const persistedId = Number.isInteger(meal.id) && meal.id < 0 ? meal.id : null;
    const knownId = knownIds.get(meal._customMenuKey);
    if (
      persistedId != null
      && (!knownId || knownId === persistedId)
      && (!used.has(persistedId) || knownId === persistedId)
      && !assignedIds.has(persistedId)
    ) {
      meal.id = persistedId;
    } else if (knownId != null && !assignedIds.has(knownId)) {
      meal.id = knownId;
    } else {
      let id = -customMealHash(meal._customMenuKey);
      while (used.has(id) || assignedIds.has(id)) id -= 1;
      meal.id = id;
    }
    assignedIds.add(meal.id);
    used.add(meal.id);
    knownIds.set(meal._customMenuKey, meal.id);
  });
  return mapped.map(({ _customMenuKey, ...meal }) => meal);
}

export async function createCustomMenuDatabase(meals) {
  const SQL = await initDatabase();
  let db;
  let statement;
  try {
    db = new SQL.Database();
    db.run(`
      CREATE TABLE meals (
        id INTEGER PRIMARY KEY,
        custom_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        chef TEXT,
        categories TEXT,
        url TEXT,
        calories REAL NOT NULL,
        protein REAL NOT NULL,
        carbs REAL NOT NULL,
        fat REAL NOT NULL
      )
    `);
    statement = db.prepare(`
      INSERT INTO meals (
        id, custom_key, name, chef, categories, url, calories, protein, carbs, fat
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    meals.forEach((meal) => {
      statement.run([
        meal.id,
        meal.custom_key || customMealKey(meal),
        meal.name,
        meal.chef || null,
        meal.categories || null,
        meal.cookunity_url ?? meal.url ?? null,
        meal.calories,
        meal.protein,
        meal.carbs,
        meal.fat,
      ]);
    });
    return db.export();
  } finally {
    statement?.free();
    db?.close();
  }
}
