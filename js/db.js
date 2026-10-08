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
