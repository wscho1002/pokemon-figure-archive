"use strict";

const FigureDB = (() => {
  const DB_NAME = "pokemon-figure-archive";
  const DB_VERSION = 2;
  let dbPromise;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("figures")) {
          const store = db.createObjectStore("figures", { keyPath: "id" });
          store.createIndex("speciesId", "speciesId", { unique: false });
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
        if (!db.objectStoreNames.contains("speciesPrefs")) {
          db.createObjectStore("speciesPrefs", { keyPath: "speciesId" });
        }
        if (!db.objectStoreNames.contains("seriesGoals")) {
          const store = db.createObjectStore("seriesGoals", { keyPath: "id" });
          store.createIndex("maker", "maker", { unique: false });
          store.createIndex("series", "series", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("다른 탭에서 데이터베이스가 사용 중입니다."));
    });
    return dbPromise;
  }

  async function run(storeName, mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      try {
        result = action(store);
      } catch (error) {
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(result?.result ?? result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("저장 작업이 중단되었습니다."));
    });
  }

  const getMeta = async key => {
    const row = await run("meta", "readonly", store => store.get(key));
    return row?.value;
  };
  const setMeta = (key, value) => run("meta", "readwrite", store => store.put({ key, value }));
  const putFigure = figure => run("figures", "readwrite", store => store.put(figure));
  const deleteFigure = id => run("figures", "readwrite", store => store.delete(id));
  const getFigure = id => run("figures", "readonly", store => store.get(id));
  const getAllFigures = () => run("figures", "readonly", store => store.getAll());
  const getFiguresBySpecies = speciesId => run("figures", "readonly", store => store.index("speciesId").getAll(Number(speciesId)));
  const putSpeciesPref = pref => run("speciesPrefs", "readwrite", store => store.put(pref));
  const getSpeciesPref = speciesId => run("speciesPrefs", "readonly", store => store.get(Number(speciesId)));
  const getAllSpeciesPrefs = () => run("speciesPrefs", "readonly", store => store.getAll());
  const putSeriesGoal = goal => run("seriesGoals", "readwrite", store => store.put(goal));
  const deleteSeriesGoal = id => run("seriesGoals", "readwrite", store => store.delete(id));
  const getSeriesGoal = id => run("seriesGoals", "readonly", store => store.get(id));
  const getAllSeriesGoals = () => run("seriesGoals", "readonly", store => store.getAll());

  async function clearCollections() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["figures", "speciesPrefs", "seriesGoals"], "readwrite");
      tx.objectStore("figures").clear();
      tx.objectStore("speciesPrefs").clear();
      tx.objectStore("seriesGoals").clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  return {
    open, getMeta, setMeta, putFigure, deleteFigure, getFigure,
    getAllFigures, getFiguresBySpecies, putSpeciesPref,
    getSpeciesPref, getAllSpeciesPrefs, putSeriesGoal,
    deleteSeriesGoal, getSeriesGoal, getAllSeriesGoals, clearCollections
  };
})();
