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

const CUSTOM_MENU_DB_NAME = "samoora-custom-menu";
const CUSTOM_MENU_STORE = "database";
const CUSTOM_MENU_HISTORY_STORE = "history";
const CUSTOM_MENU_KEY = "active";
const CUSTOM_MENU_HISTORY_KEY = "menus";

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

function openCustomMenuDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("This browser does not support local menu storage."));
      return;
    }
    const request = globalThis.indexedDB.open(CUSTOM_MENU_DB_NAME, 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CUSTOM_MENU_STORE)) database.createObjectStore(CUSTOM_MENU_STORE);
      if (!database.objectStoreNames.contains(CUSTOM_MENU_HISTORY_STORE)) database.createObjectStore(CUSTOM_MENU_HISTORY_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open local menu storage."));
    request.onblocked = () => reject(new Error("Local menu storage is busy. Close another Samoora tab and try again."));
  });
}

export function saveCustomMenuBytes(bytes) {
  return new Promise(async (resolve, reject) => {
    let database;
    try {
      database = await openCustomMenuDatabase();
      const transaction = database.transaction([CUSTOM_MENU_STORE, CUSTOM_MENU_HISTORY_STORE], "readwrite");
      const activeStore = transaction.objectStore(CUSTOM_MENU_STORE);
      const historyStore = transaction.objectStore(CUSTOM_MENU_HISTORY_STORE);
      const activeRequest = activeStore.get(CUSTOM_MENU_KEY);
      const historyRequest = historyStore.get(CUSTOM_MENU_HISTORY_KEY);
      let activeBytes;
      let history;
      let activeReady = false;
      let historyReady = false;
      const replaceActive = () => {
        if (!activeReady || !historyReady) return;
        if (activeBytes != null) historyStore.put([...history, activeBytes.slice(0)], CUSTOM_MENU_HISTORY_KEY);
        activeStore.put(bytes.slice().buffer, CUSTOM_MENU_KEY);
      };
      activeRequest.onsuccess = () => {
        activeBytes = activeRequest.result;
        activeReady = true;
        replaceActive();
      };
      historyRequest.onsuccess = () => {
        history = Array.isArray(historyRequest.result) ? historyRequest.result : [];
        historyReady = true;
        replaceActive();
      };
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        const error = transaction.error || new Error("The custom menu could not be saved.");
        database.close();
        reject(error);
      };
      transaction.onabort = () => {
        const error = transaction.error || new Error("The custom menu save was aborted.");
        database.close();
        reject(error);
      };
    } catch (error) {
      database?.close();
      reject(error);
    }
  });
}

export function loadCustomMenuBytes() {
  return new Promise(async (resolve, reject) => {
    let database;
    try {
      database = await openCustomMenuDatabase();
      const transaction = database.transaction(CUSTOM_MENU_STORE, "readonly");
      const request = transaction.objectStore(CUSTOM_MENU_STORE).get(CUSTOM_MENU_KEY);
      request.onsuccess = () => {
        const value = request.result;
        database.close();
        resolve(value == null ? null : new Uint8Array(value));
      };
      request.onerror = () => {
        const error = request.error || new Error("The saved custom menu could not be read.");
        database.close();
        reject(error);
      };
      transaction.onabort = () => {
        const error = transaction.error || new Error("The saved custom menu read was aborted.");
        database.close();
        reject(error);
      };
    } catch (error) {
      database?.close();
      reject(error);
    }
  });
}

export function loadCustomMenuHistoryBytes() {
  return new Promise(async (resolve, reject) => {
    let database;
    try {
      database = await openCustomMenuDatabase();
      const transaction = database.transaction(CUSTOM_MENU_HISTORY_STORE, "readonly");
      const request = transaction.objectStore(CUSTOM_MENU_HISTORY_STORE).get(CUSTOM_MENU_HISTORY_KEY);
      request.onsuccess = () => {
        const values = Array.isArray(request.result) ? request.result : [];
        database.close();
        resolve(values.map((value) => new Uint8Array(value)));
      };
      request.onerror = () => {
        const error = request.error || new Error("The custom menu history could not be read.");
        database.close();
        reject(error);
      };
      transaction.onabort = () => {
        const error = transaction.error || new Error("The custom menu history read was aborted.");
        database.close();
        reject(error);
      };
    } catch (error) {
      database?.close();
      reject(error);
    }
  });
}

export function removeCustomMenuBytes() {
  return new Promise(async (resolve, reject) => {
    let database;
    try {
      database = await openCustomMenuDatabase();
      const transaction = database.transaction([CUSTOM_MENU_STORE, CUSTOM_MENU_HISTORY_STORE], "readwrite");
      const activeStore = transaction.objectStore(CUSTOM_MENU_STORE);
      const historyStore = transaction.objectStore(CUSTOM_MENU_HISTORY_STORE);
      const activeRequest = activeStore.get(CUSTOM_MENU_KEY);
      const historyRequest = historyStore.get(CUSTOM_MENU_HISTORY_KEY);
      let activeBytes;
      let history;
      let activeReady = false;
      let historyReady = false;
      const moveActive = () => {
        if (!activeReady || !historyReady || activeBytes == null) return;
        historyStore.put([...history, activeBytes.slice(0)], CUSTOM_MENU_HISTORY_KEY);
        activeStore.delete(CUSTOM_MENU_KEY);
      };
      activeRequest.onsuccess = () => {
        activeBytes = activeRequest.result;
        activeReady = true;
        moveActive();
      };
      historyRequest.onsuccess = () => {
        history = Array.isArray(historyRequest.result) ? historyRequest.result : [];
        historyReady = true;
        moveActive();
      };
      transaction.oncomplete = () => {
        database.close();
        resolve(activeBytes == null ? false : true);
      };
      transaction.onerror = () => {
        const error = transaction.error || new Error("The custom menu could not be removed.");
        database.close();
        reject(error);
      };
      transaction.onabort = () => {
        const error = transaction.error || new Error("The custom menu removal was aborted.");
        database.close();
        reject(error);
      };
    } catch (error) {
      database?.close();
      reject(error);
    }
  });
}
