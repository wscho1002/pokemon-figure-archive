"use strict";

const DATA_URLS = {
  species: "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species.csv",
  names: "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv"
};
const ARTWORK_BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork";
const CATALOG_CACHE_VERSION = 1;
const KOREAN_LANGUAGE_ID = 3;

const FALLBACK_CATALOG = [
  [1,"이상해씨","bulbasaur",1],[2,"이상해풀","ivysaur",1],[3,"이상해꽃","venusaur",1],
  [4,"파이리","charmander",1],[5,"리자드","charmeleon",1],[6,"리자몽","charizard",1],
  [7,"꼬부기","squirtle",1],[8,"어니부기","wartortle",1],[9,"거북왕","blastoise",1],
  [10,"캐터피","caterpie",1],[25,"피카츄","pikachu",1],[26,"라이츄","raichu",1],
  [39,"푸린","jigglypuff",1],[52,"나옹","meowth",1],[54,"고라파덕","psyduck",1],
  [133,"이브이","eevee",1],[143,"잠만보","snorlax",1],[150,"뮤츠","mewtwo",1],[151,"뮤","mew",1]
].map(([id,name,slug,generation]) => ({ id, name, slug, generation, imageUrl: `${ARTWORK_BASE}/${id}.png` }));

const state = {
  catalog: [],
  figures: [],
  prefs: new Map(),
  seriesGoals: [],
  figuresBySpecies: new Map(),
  currentSpecies: null,
  cameraStream: null,
  pendingPhoto: null,
  objectUrls: { grid: new Set(), detail: new Set(), record: new Set(), recent: new Set(), achievement: new Set() },
  renderToken: 0
};

const $ = selector => document.querySelector(selector);
const refs = {};

window.addEventListener("DOMContentLoaded", init);

async function init() {
  bindRefs();
  bindEvents();
  registerServiceWorker();
  await FigureDB.open();
  await loadAppData();
  renderAll();
  updateStorageInfo();
}

function bindRefs() {
  [
    "menuButton","ownedSpeciesCount","figureCount","duplicateCount","recentCount",
    "completionRate","completionBar","completionCount","showMissingButton",
    "generationProgress","resetGenerationButton","recentSection","recentFigures","collectionSection",
    "makerOverview","seriesOverview","collectionEmpty","manageSeriesButton","searchInput",
    "ownershipFilter","generationFilter","sortFilter","makerFilter","seriesFilter",
    "clearCollectionFilters","loadingPanel","loadingTitle",
    "loadingMessage","pokemonGrid","emptyMessage","detailDialog","detailNumber",
    "detailName","detailSubtext","addFigureButton","figureList","recordDialog",
    "recordPokemonName","recordModeText","saveFigureButton","figureForm","editingFigureId",
    "cameraStage","cameraVideo","photoPreview","cameraPlaceholder","startCameraButton",
    "captureButton","retakeButton","fallbackPhotoInput","photoSizeText","figureNameInput",
    "formInput","makerInput","seriesInput","makerSuggestions","seriesSuggestions",
    "productCodeInput","sourceInput","priceInput",
    "currencyInput","purchaseDateInput","conditionInput","locationInput","notesInput",
    "setAsCoverInput","seriesDialog","seriesGoalForm","editingSeriesGoalId","goalMakerInput",
    "goalSeriesInput","goalTargetInput","goalNotesInput","saveSeriesGoalButton","seriesGoalList",
    "settingsDialog","exportButton","importInput","refreshCatalogButton",
    "requestStorageButton","storageStatus","storageUsage","achievementDialog",
    "achievementImage","achievementNumber","achievementName","achievementOldRate",
    "achievementNewRate","achievementConfirmButton","closeAchievementButton","toast","captureCanvas"
  ].forEach(id => refs[id] = document.getElementById(id));
}

function bindEvents() {
  refs.searchInput.addEventListener("input", renderGrid);
  refs.ownershipFilter.addEventListener("change", renderGrid);
  refs.generationFilter.addEventListener("change", () => { renderDashboard(); renderGrid(); });
  refs.sortFilter.addEventListener("change", renderGrid);
  refs.makerFilter.addEventListener("change", () => {
    refs.seriesFilter.value = "all";
    populateSeriesFilter();
    renderDashboard();
    renderGrid();
  });
  refs.seriesFilter.addEventListener("change", () => { renderDashboard(); renderGrid(); });
  refs.clearCollectionFilters.addEventListener("click", () => {
    refs.makerFilter.value = "all";
    populateSeriesFilter();
    refs.seriesFilter.value = "all";
    renderDashboard();
    renderGrid();
  });
  refs.manageSeriesButton.addEventListener("click", openSeriesDialog);
  refs.seriesGoalForm.addEventListener("submit", saveSeriesGoal);
  refs.showMissingButton.addEventListener("click", () => {
    refs.ownershipFilter.value = "unowned";
    refs.generationFilter.value = "all";
    refs.makerFilter.value = "all";
    populateSeriesFilter();
    refs.seriesFilter.value = "all";
    renderDashboard();
    renderGrid();
    refs.searchInput.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  refs.resetGenerationButton.addEventListener("click", () => {
    refs.generationFilter.value = "all";
    renderDashboard();
    renderGrid();
  });
  refs.achievementConfirmButton.addEventListener("click", closeAchievement);
  refs.closeAchievementButton.addEventListener("click", closeAchievement);
  refs.achievementDialog.addEventListener("click", event => {
    if (event.target === refs.achievementDialog) closeAchievement();
  });
  refs.achievementDialog.addEventListener("close", () => revokeObjectUrls("achievement"));
  refs.menuButton.addEventListener("click", () => {
    updateStorageInfo();
    refs.settingsDialog.showModal();
  });
  document.querySelectorAll("[data-close-dialog]").forEach(button => {
    button.addEventListener("click", () => closeDialog(button.dataset.closeDialog));
  });
  refs.detailDialog.addEventListener("close", () => revokeObjectUrls("detail"));
  refs.seriesDialog.addEventListener("close", resetSeriesGoalForm);
  refs.recordDialog.addEventListener("close", resetRecordDialog);
  refs.addFigureButton.addEventListener("click", () => openRecordDialog());
  refs.startCameraButton.addEventListener("click", startCamera);
  refs.captureButton.addEventListener("click", captureFromVideo);
  refs.retakeButton.addEventListener("click", resetPhotoCapture);
  refs.fallbackPhotoInput.addEventListener("change", handleFallbackPhoto);
  refs.saveFigureButton.addEventListener("click", saveFigure);
  refs.exportButton.addEventListener("click", exportBackup);
  refs.importInput.addEventListener("change", importBackup);
  refs.refreshCatalogButton.addEventListener("click", refreshCatalog);
  refs.requestStorageButton.addEventListener("click", requestPersistentStorage);

  [refs.detailDialog, refs.seriesDialog, refs.settingsDialog].forEach(dialog => {
    dialog.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
    });
  });
}

async function loadAppData() {
  showLoading("포켓몬 도감을 준비하는 중", "저장된 기록을 불러오고 있습니다.");
  const [figures, prefs, seriesGoals, cachedCatalog, cacheVersion] = await Promise.all([
    FigureDB.getAllFigures(),
    FigureDB.getAllSpeciesPrefs(),
    FigureDB.getAllSeriesGoals(),
    FigureDB.getMeta("catalog"),
    FigureDB.getMeta("catalogVersion")
  ]);
  state.figures = figures || [];
  state.prefs = new Map((prefs || []).map(pref => [Number(pref.speciesId), pref]));
  state.seriesGoals = seriesGoals || [];
  indexFigures();

  if (cachedCatalog?.length && cacheVersion === CATALOG_CACHE_VERSION) {
    state.catalog = cachedCatalog;
    hideLoading();
    return;
  }

  try {
    state.catalog = await fetchCatalog();
    await FigureDB.setMeta("catalog", state.catalog);
    await FigureDB.setMeta("catalogVersion", CATALOG_CACHE_VERSION);
  } catch (error) {
    console.error(error);
    state.catalog = cachedCatalog?.length ? cachedCatalog : FALLBACK_CATALOG;
    toast("전체 목록 연결에 실패해 임시 목록을 표시합니다.");
  }
  hideLoading();
}

async function fetchCatalog() {
  showLoading("전체 포켓몬 목록을 받는 중", "한국어 이름과 세대 정보를 정리하고 있습니다.");
  const [speciesText, namesText] = await Promise.all([
    fetchText(DATA_URLS.species),
    fetchText(DATA_URLS.names)
  ]);
  const speciesRows = parseCSV(speciesText);
  const nameRows = parseCSV(namesText);
  const koreanNames = new Map();
  const englishNames = new Map();

  for (const row of nameRows) {
    const speciesId = Number(row.pokemon_species_id);
    const languageId = Number(row.local_language_id);
    if (languageId === KOREAN_LANGUAGE_ID) koreanNames.set(speciesId, row.name);
    if (languageId === 9) englishNames.set(speciesId, row.name);
  }

  return speciesRows
    .map(row => {
      const id = Number(row.id);
      return {
        id,
        name: koreanNames.get(id) || englishNames.get(id) || humanize(row.identifier),
        slug: row.identifier,
        generation: Number(row.generation_id) || 0,
        imageUrl: `${ARTWORK_BASE}/${id}.png`
      };
    })
    .filter(item => item.id > 0)
    .sort((a, b) => a.id - b.id);
}

async function fetchText(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; i++; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === "," && !quoted) { row.push(cell); cell = ""; continue; }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(value => value !== "")) rows.push(row);
      row = [];
      continue;
    }
    cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift().map(header => header.trim());
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function indexFigures() {
  state.figuresBySpecies = new Map();
  for (const figure of state.figures) {
    const id = Number(figure.speciesId);
    if (!state.figuresBySpecies.has(id)) state.figuresBySpecies.set(id, []);
    state.figuresBySpecies.get(id).push(figure);
  }
  for (const list of state.figuresBySpecies.values()) {
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }
}

function renderAll() {
  populateCollectionControls();
  renderStats();
  renderDashboard();
  renderGrid();
}

function renderStats() {
  const ownedSpecies = state.figuresBySpecies.size;
  const totalSpecies = state.catalog.length;
  const duplicateFigures = Math.max(0, state.figures.length - ownedSpecies);
  const now = new Date();
  const acquiredThisMonth = state.figures.filter(figure => {
    const date = new Date(figure.createdAt);
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  }).length;
  const rate = totalSpecies ? ownedSpecies / totalSpecies * 100 : 0;

  refs.ownedSpeciesCount.textContent = ownedSpecies.toLocaleString("ko-KR");
  refs.figureCount.textContent = state.figures.length.toLocaleString("ko-KR");
  refs.duplicateCount.textContent = duplicateFigures.toLocaleString("ko-KR");
  refs.recentCount.textContent = acquiredThisMonth.toLocaleString("ko-KR");
  refs.completionRate.textContent = formatRate(rate);
  refs.completionCount.textContent = `${ownedSpecies.toLocaleString("ko-KR")} / ${totalSpecies.toLocaleString("ko-KR")}종`;
  requestAnimationFrame(() => { refs.completionBar.style.width = `${Math.min(100, rate)}%`; });
}

function renderDashboard() {
  renderGenerationProgress();
  renderRecentFigures();
  renderCollectionOverview();
}

function renderGenerationProgress() {
  const selected = refs.generationFilter.value;
  const generations = new Map();
  for (const pokemon of state.catalog) {
    if (!generations.has(pokemon.generation)) generations.set(pokemon.generation, { total: 0, owned: 0 });
    const row = generations.get(pokemon.generation);
    row.total++;
    if (state.figuresBySpecies.has(pokemon.id)) row.owned++;
  }

  refs.generationProgress.replaceChildren();
  const fragment = document.createDocumentFragment();
  [...generations.entries()].filter(([generation]) => generation > 0).sort((a, b) => a[0] - b[0]).forEach(([generation, data]) => {
    const rate = data.total ? data.owned / data.total * 100 : 0;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `generation-row${String(generation) === selected ? " active" : ""}`;
    button.setAttribute("aria-label", `${generation}세대 ${data.owned}/${data.total}, ${formatRate(rate)}`);
    button.innerHTML = `
      <span class="generation-label">${generation}세대</span>
      <span class="generation-bar"><span style="width:${Math.min(100, rate)}%"></span></span>
      <span class="generation-value">${data.owned}/${data.total}</span>`;
    button.addEventListener("click", () => {
      refs.generationFilter.value = String(generation);
      renderDashboard();
      renderGrid();
      refs.searchInput.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    fragment.append(button);
  });
  refs.generationProgress.append(fragment);
}

function renderRecentFigures() {
  revokeObjectUrls("recent");
  const recent = [...state.figures]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 8);
  refs.recentFigures.replaceChildren();
  refs.recentSection.hidden = recent.length === 0;
  if (!recent.length) return;

  const fragment = document.createDocumentFragment();
  for (const figure of recent) {
    const pokemon = state.catalog.find(item => item.id === Number(figure.speciesId));
    if (!pokemon) continue;
    const imageUrl = figure.thumbBlob ? URL.createObjectURL(figure.thumbBlob) : pokemon.imageUrl;
    if (figure.thumbBlob) state.objectUrls.recent.add(imageUrl);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "recent-card";
    card.innerHTML = `
      <img src="${imageUrl}" alt="${escapeHTML(figure.figureName || pokemon.name)}">
      <div><strong>${escapeHTML(pokemon.name)}</strong><small>${escapeHTML(figure.figureName || "피규어")}</small></div>`;
    card.addEventListener("click", () => openDetail(pokemon.id));
    fragment.append(card);
  }
  refs.recentFigures.append(fragment);
}


function populateCollectionControls() {
  const selectedMaker = refs.makerFilter.value || "all";
  const selectedSeries = refs.seriesFilter.value || "all";
  const makers = getMakerNames();

  refs.makerFilter.replaceChildren(new Option("모든 제조사", "all"));
  for (const maker of makers) refs.makerFilter.add(new Option(maker, normalizeKey(maker)));
  refs.makerFilter.value = makers.some(maker => normalizeKey(maker) === selectedMaker) ? selectedMaker : "all";
  populateSeriesFilter(selectedSeries);

  refs.makerSuggestions.replaceChildren(...makers.map(maker => {
    const option = document.createElement("option");
    option.value = maker;
    return option;
  }));
  const seriesNames = [...new Set(getSeriesGroups().map(group => group.series).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  refs.seriesSuggestions.replaceChildren(...seriesNames.map(series => {
    const option = document.createElement("option");
    option.value = series;
    return option;
  }));
}

function populateSeriesFilter(preferred = refs.seriesFilter.value || "all") {
  const selectedMaker = refs.makerFilter.value || "all";
  const groups = getSeriesGroups().filter(group => selectedMaker === "all" || normalizeKey(group.maker) === selectedMaker);
  refs.seriesFilter.replaceChildren(new Option("모든 시리즈", "all"));
  for (const group of groups) {
    const label = selectedMaker === "all" ? `${group.maker} · ${group.series}` : group.series;
    refs.seriesFilter.add(new Option(label, group.key));
  }
  refs.seriesFilter.value = groups.some(group => group.key === preferred) ? preferred : "all";
}

function renderCollectionOverview() {
  const makers = getMakerStats();
  const seriesGroups = getSeriesGroups();
  refs.makerOverview.replaceChildren();
  refs.seriesOverview.replaceChildren();
  refs.collectionEmpty.hidden = makers.length > 0 || seriesGroups.length > 0;

  if (makers.length) {
    const makerFragment = document.createDocumentFragment();
    for (const maker of makers.slice(0, 12)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `maker-chip${refs.makerFilter.value === normalizeKey(maker.name) ? " active" : ""}`;
      button.innerHTML = `<strong>${escapeHTML(maker.name)}</strong><small>${maker.figureCount}개 · ${maker.seriesCount}시리즈</small>`;
      button.addEventListener("click", () => applyMakerFilter(maker.name));
      makerFragment.append(button);
    }
    refs.makerOverview.append(makerFragment);
  }

  if (seriesGroups.length) {
    const seriesFragment = document.createDocumentFragment();
    for (const group of seriesGroups.slice(0, 10)) {
      const rate = group.targetCount ? Math.min(100, group.uniqueCount / group.targetCount * 100) : 0;
      const card = document.createElement("button");
      card.type = "button";
      card.className = `series-card${refs.seriesFilter.value === group.key ? " active" : ""}`;
      card.innerHTML = `
        <div class="series-card-head">
          <div><small>${escapeHTML(group.maker)}</small><strong>${escapeHTML(group.series)}</strong></div>
          <b>${group.targetCount ? formatRate(rate) : `${group.uniqueCount}종류`}</b>
        </div>
        <div class="series-progress"><span style="width:${rate}%"></span></div>
        <div class="series-card-foot">
          <span>${group.targetCount ? `${group.uniqueCount} / ${group.targetCount}종류` : "목표 수량 미설정"}</span>
          <span>실물 ${group.figureCount}개</span>
        </div>`;
      card.addEventListener("click", () => applySeriesFilter(group));
      seriesFragment.append(card);
    }
    refs.seriesOverview.append(seriesFragment);
  }
}

function getMakerNames() {
  const names = new Map();
  for (const figure of state.figures) {
    const name = cleanText(figure.maker);
    if (name) names.set(normalizeKey(name), name);
  }
  for (const goal of state.seriesGoals) {
    const name = cleanText(goal.maker);
    if (name) names.set(normalizeKey(name), name);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b, "ko"));
}

function getMakerStats() {
  const stats = new Map();
  for (const figure of state.figures) {
    const maker = cleanText(figure.maker);
    if (!maker) continue;
    const key = normalizeKey(maker);
    if (!stats.has(key)) stats.set(key, { name: maker, figures: [], series: new Set(), species: new Set() });
    const row = stats.get(key);
    row.figures.push(figure);
    if (cleanText(figure.series)) row.series.add(normalizeKey(figure.series));
    row.species.add(Number(figure.speciesId));
  }
  for (const goal of state.seriesGoals) {
    const maker = cleanText(goal.maker);
    if (!maker) continue;
    const key = normalizeKey(maker);
    if (!stats.has(key)) stats.set(key, { name: maker, figures: [], series: new Set(), species: new Set() });
    if (cleanText(goal.series)) stats.get(key).series.add(normalizeKey(goal.series));
  }
  return [...stats.values()].map(row => ({
    name: row.name,
    figureCount: row.figures.length,
    seriesCount: row.series.size,
    speciesCount: row.species.size
  })).sort((a, b) => b.figureCount - a.figureCount || a.name.localeCompare(b.name, "ko"));
}

function getSeriesGroups() {
  const groups = new Map();
  const ensure = (maker, series) => {
    maker = cleanText(maker);
    series = cleanText(series);
    if (!maker || !series) return null;
    const key = seriesKey(maker, series);
    if (!groups.has(key)) groups.set(key, {
      key, maker, series, figures: [], species: new Set(), uniqueItems: new Set(), goal: null,
      figureCount: 0, uniqueCount: 0, targetCount: 0
    });
    return groups.get(key);
  };

  for (const figure of state.figures) {
    const group = ensure(figure.maker, figure.series);
    if (!group) continue;
    group.figures.push(figure);
    group.species.add(Number(figure.speciesId));
    group.uniqueItems.add(uniqueFigureKey(figure));
  }
  for (const goal of state.seriesGoals) {
    const group = ensure(goal.maker, goal.series);
    if (!group) continue;
    group.goal = goal;
    group.targetCount = Number(goal.targetCount) || 0;
  }
  return [...groups.values()].map(group => ({
    ...group,
    figureCount: group.figures.length,
    uniqueCount: group.uniqueItems.size
  })).sort((a, b) => {
    const aProgress = a.targetCount ? a.uniqueCount / a.targetCount : -1;
    const bProgress = b.targetCount ? b.uniqueCount / b.targetCount : -1;
    return bProgress - aProgress || b.figureCount - a.figureCount || a.series.localeCompare(b.series, "ko");
  });
}

function applyMakerFilter(maker) {
  refs.makerFilter.value = normalizeKey(maker);
  populateSeriesFilter();
  refs.seriesFilter.value = "all";
  renderDashboard();
  renderGrid();
  refs.searchInput.scrollIntoView({ behavior: "smooth", block: "start" });
}

function applySeriesFilter(group) {
  refs.makerFilter.value = normalizeKey(group.maker);
  populateSeriesFilter(group.key);
  refs.seriesFilter.value = group.key;
  renderDashboard();
  renderGrid();
  refs.searchInput.scrollIntoView({ behavior: "smooth", block: "start" });
}

function cleanText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeKey(value) {
  return cleanText(value).toLocaleLowerCase("ko-KR");
}

function seriesKey(maker, series) {
  return `${normalizeKey(maker)}::${normalizeKey(series)}`;
}

function uniqueFigureKey(figure) {
  const code = normalizeKey(figure.productCode);
  if (code) return `code:${code}`;
  const name = normalizeKey(figure.figureName);
  if (name) return `name:${name}`;
  return `species:${Number(figure.speciesId)}:${normalizeKey(figure.form || "기본 모습")}`;
}

async function renderGrid() {
  const token = ++state.renderToken;
  revokeObjectUrls("grid");
  const query = refs.searchInput.value.trim().toLowerCase();
  const ownership = refs.ownershipFilter.value;
  const generation = refs.generationFilter.value;
  const sort = refs.sortFilter.value;
  const maker = refs.makerFilter.value;
  const series = refs.seriesFilter.value;

  let list = state.catalog.filter(pokemon => {
    const figures = state.figuresBySpecies.get(pokemon.id) || [];
    const owned = figures.length > 0;
    const queryMatch = !query || String(pokemon.id) === query.replace(/^#/, "") ||
      pokemon.name.toLowerCase().includes(query) || pokemon.slug.toLowerCase().includes(query);
    const ownershipMatch = ownership === "all" || (ownership === "owned" && owned) || (ownership === "unowned" && !owned);
    const generationMatch = generation === "all" || Number(generation) === pokemon.generation;
    const makerMatch = maker === "all" || figures.some(figure => normalizeKey(figure.maker) === maker);
    const seriesMatch = series === "all" || figures.some(figure => seriesKey(figure.maker, figure.series) === series);
    return queryMatch && ownershipMatch && generationMatch && makerMatch && seriesMatch;
  });

  list.sort((a, b) => {
    if (sort === "name") return a.name.localeCompare(b.name, "ko");
    if (sort === "count") return (state.figuresBySpecies.get(b.id)?.length || 0) - (state.figuresBySpecies.get(a.id)?.length || 0) || a.id - b.id;
    if (sort === "recent") return getSpeciesRecentTime(b.id) - getSpeciesRecentTime(a.id) || a.id - b.id;
    return a.id - b.id;
  });

  refs.pokemonGrid.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const pokemon of list) {
    if (token !== state.renderToken) return;
    const figures = state.figuresBySpecies.get(pokemon.id) || [];
    const coverFigure = getCoverFigure(pokemon.id, figures);
    const card = document.createElement("button");
    card.type = "button";
    card.className = `pokemon-card${figures.length ? " owned" : ""}`;
    card.dataset.speciesId = pokemon.id;
    card.innerHTML = `
      <div class="pokemon-image-wrap">
        <img loading="lazy" alt="${escapeHTML(pokemon.name)}">
        <span class="card-number">#${String(pokemon.id).padStart(4, "0")}</span>
        ${figures.length ? `<span class="owned-badge">${figures.length}</span>` : ""}
      </div>
      <div class="card-info">
        <strong>${escapeHTML(pokemon.name)}</strong>
        <small>${figures.length ? `보유 ${figures.length}개` : `${pokemon.generation}세대 · 미보유`}</small>
      </div>`;
    const image = card.querySelector("img");
    if (coverFigure?.thumbBlob) {
      const url = URL.createObjectURL(coverFigure.thumbBlob);
      state.objectUrls.grid.add(url);
      image.src = url;
    } else {
      image.src = pokemon.imageUrl;
      image.onerror = () => { image.style.opacity = ".2"; };
    }
    card.addEventListener("click", () => openDetail(pokemon.id));
    fragment.append(card);
  }
  refs.pokemonGrid.append(fragment);
  refs.emptyMessage.hidden = list.length !== 0;
}

function getSpeciesRecentTime(speciesId) {
  const list = state.figuresBySpecies.get(speciesId) || [];
  return list.length ? new Date(list[0].createdAt).getTime() : 0;
}

function getCoverFigure(speciesId, figures = state.figuresBySpecies.get(speciesId) || []) {
  const pref = state.prefs.get(Number(speciesId));
  return figures.find(figure => figure.id === pref?.coverFigureId) || figures[0] || null;
}

async function openDetail(speciesId) {
  const pokemon = state.catalog.find(item => item.id === Number(speciesId));
  if (!pokemon) return;
  state.currentSpecies = pokemon;
  refs.detailNumber.textContent = `NATIONAL DEX #${String(pokemon.id).padStart(4, "0")} · ${pokemon.generation}세대`;
  refs.detailName.textContent = pokemon.name;
  const figures = state.figuresBySpecies.get(pokemon.id) || [];
  refs.detailSubtext.textContent = figures.length ? `등록한 피규어 ${figures.length}개` : "아직 등록한 피규어가 없습니다.";
  renderFigureList();
  refs.detailDialog.showModal();
}

function renderFigureList() {
  revokeObjectUrls("detail");
  const pokemon = state.currentSpecies;
  const figures = state.figuresBySpecies.get(pokemon.id) || [];
  const cover = getCoverFigure(pokemon.id, figures);
  refs.figureList.replaceChildren();
  if (!figures.length) {
    refs.figureList.innerHTML = `<div class="figure-empty">사진을 찍어 첫 번째 ${escapeHTML(pokemon.name)} 피규어를 기록하세요.</div>`;
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const figure of figures) {
    const item = document.createElement("article");
    item.className = "figure-item";
    const thumbUrl = figure.thumbBlob ? URL.createObjectURL(figure.thumbBlob) : pokemon.imageUrl;
    if (figure.thumbBlob) state.objectUrls.detail.add(thumbUrl);
    const price = formatPrice(figure.price, figure.currency);
    const meta = [figure.form || "기본 모습", figure.maker, figure.series, price, figure.source].filter(Boolean).join(" · ");
    item.innerHTML = `
      <div class="figure-thumb">
        <img src="${thumbUrl}" alt="${escapeHTML(figure.figureName || pokemon.name)}">
        ${cover?.id === figure.id ? `<span class="cover-label">대표</span>` : ""}
      </div>
      <div class="figure-content">
        <h3>${escapeHTML(figure.figureName || `${pokemon.name} 피규어`)}</h3>
        <p class="figure-meta">${escapeHTML(meta || "상세 정보 없음")}</p>
        ${figure.notes ? `<p class="figure-notes">${escapeHTML(figure.notes)}</p>` : ""}
        <div class="item-actions">
          ${cover?.id !== figure.id ? `<button class="mini-button" data-action="cover">대표 지정</button>` : ""}
          <button class="mini-button" data-action="edit">수정</button>
          <button class="mini-button danger" data-action="delete">삭제</button>
        </div>
      </div>`;
    item.querySelector('[data-action="cover"]')?.addEventListener("click", () => setCoverFigure(figure.id));
    item.querySelector('[data-action="edit"]').addEventListener("click", () => openRecordDialog(figure));
    item.querySelector('[data-action="delete"]').addEventListener("click", () => removeFigure(figure));
    fragment.append(item);
  }
  refs.figureList.append(fragment);
}

function openRecordDialog(figure = null) {
  if (!state.currentSpecies) return;
  resetRecordDialog();
  refs.recordPokemonName.textContent = state.currentSpecies.name;
  refs.recordModeText.textContent = figure ? "기록 수정" : "새 피규어 기록";
  refs.editingFigureId.value = figure?.id || "";
  refs.figureNameInput.value = figure?.figureName || "";
  refs.formInput.value = figure?.form || "기본 모습";
  refs.makerInput.value = figure?.maker || "";
  refs.seriesInput.value = figure?.series || "";
  refs.productCodeInput.value = figure?.productCode || "";
  refs.sourceInput.value = figure?.source || "";
  refs.priceInput.value = figure?.price ?? "";
  refs.currencyInput.value = figure?.currency || "KRW";
  refs.purchaseDateInput.value = figure?.purchaseDate || "";
  refs.conditionInput.value = figure?.condition || "";
  refs.locationInput.value = figure?.location || "";
  refs.notesInput.value = figure?.notes || "";
  refs.setAsCoverInput.checked = figure ? getCoverFigure(state.currentSpecies.id)?.id === figure.id : true;
  if (figure?.fullBlob) showExistingPhoto(figure.fullBlob);
  refs.recordDialog.showModal();
}


function openSeriesDialog() {
  resetSeriesGoalForm();
  renderSeriesGoalList();
  refs.seriesDialog.showModal();
}

function resetSeriesGoalForm() {
  refs.seriesGoalForm.reset();
  refs.editingSeriesGoalId.value = "";
  refs.saveSeriesGoalButton.textContent = "목표 저장";
}

function renderSeriesGoalList() {
  const groups = getSeriesGroups();
  refs.seriesGoalList.replaceChildren();
  if (!groups.length) {
    refs.seriesGoalList.innerHTML = '<p class="series-goal-empty">아직 제조사·시리즈 정보가 없습니다.</p>';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const group of groups) {
    const row = document.createElement("article");
    row.className = "series-goal-item";
    const rate = group.targetCount ? Math.min(100, group.uniqueCount / group.targetCount * 100) : 0;
    row.innerHTML = `
      <div class="series-goal-summary">
        <small>${escapeHTML(group.maker)}</small>
        <strong>${escapeHTML(group.series)}</strong>
        <span>${group.targetCount ? `${group.uniqueCount}/${group.targetCount}종류 · ${formatRate(rate)}` : `${group.uniqueCount}종류 · 목표 미설정`}</span>
      </div>
      <div class="item-actions">
        <button type="button" class="mini-button" data-action="edit">${group.goal ? "목표 수정" : "목표 설정"}</button>
        ${group.goal ? '<button type="button" class="mini-button danger" data-action="delete">목표 삭제</button>' : ''}
      </div>`;
    row.querySelector('[data-action="edit"]').addEventListener("click", () => editSeriesGoal(group));
    row.querySelector('[data-action="delete"]')?.addEventListener("click", () => removeSeriesGoal(group.goal));
    fragment.append(row);
  }
  refs.seriesGoalList.append(fragment);
}

function editSeriesGoal(group) {
  refs.editingSeriesGoalId.value = group.goal?.id || "";
  refs.goalMakerInput.value = group.maker;
  refs.goalSeriesInput.value = group.series;
  refs.goalTargetInput.value = group.targetCount || "";
  refs.goalNotesInput.value = group.goal?.notes || "";
  refs.saveSeriesGoalButton.textContent = group.goal ? "목표 수정" : "목표 저장";
  refs.goalTargetInput.focus();
  refs.seriesGoalForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function saveSeriesGoal(event) {
  event.preventDefault();
  const maker = cleanText(refs.goalMakerInput.value);
  const series = cleanText(refs.goalSeriesInput.value);
  const targetCount = Number(refs.goalTargetInput.value);
  if (!maker || !series || !Number.isInteger(targetCount) || targetCount < 1) {
    toast("제조사, 시리즈, 목표 상품 수를 입력하세요.");
    return;
  }
  const existingId = refs.editingSeriesGoalId.value;
  const sameGoal = state.seriesGoals.find(goal => seriesKey(goal.maker, goal.series) === seriesKey(maker, series));
  const now = new Date().toISOString();
  const goal = {
    id: existingId || sameGoal?.id || crypto.randomUUID(),
    maker,
    series,
    targetCount,
    notes: cleanText(refs.goalNotesInput.value),
    createdAt: sameGoal?.createdAt || now,
    updatedAt: now
  };
  await FigureDB.putSeriesGoal(goal);
  const index = state.seriesGoals.findIndex(item => item.id === goal.id);
  if (index >= 0) state.seriesGoals[index] = goal; else state.seriesGoals.push(goal);
  populateCollectionControls();
  renderDashboard();
  renderSeriesGoalList();
  resetSeriesGoalForm();
  toast("시리즈 완성 목표를 저장했습니다.");
}

async function removeSeriesGoal(goal) {
  if (!goal) return;
  if (!confirm(`‘${goal.series}’ 목표만 삭제할까요? 피규어 기록은 유지됩니다.`)) return;
  await FigureDB.deleteSeriesGoal(goal.id);
  state.seriesGoals = state.seriesGoals.filter(item => item.id !== goal.id);
  populateCollectionControls();
  renderDashboard();
  renderSeriesGoalList();
  resetSeriesGoalForm();
  toast("시리즈 목표를 삭제했습니다.");
}

async function startCamera() {
  stopCamera();
  try {
    state.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1920 } },
      audio: false
    });
    refs.cameraVideo.srcObject = state.cameraStream;
    await refs.cameraVideo.play();
    refs.cameraVideo.hidden = false;
    refs.photoPreview.hidden = true;
    refs.cameraPlaceholder.hidden = true;
    refs.startCameraButton.hidden = true;
    refs.captureButton.hidden = false;
    refs.retakeButton.hidden = true;
  } catch (error) {
    console.error(error);
    toast("카메라를 열지 못했습니다. ‘기본 카메라’를 사용하세요.");
  }
}

async function captureFromVideo() {
  const video = refs.cameraVideo;
  if (!video.videoWidth || !video.videoHeight) return;
  refs.captureCanvas.width = video.videoWidth;
  refs.captureCanvas.height = video.videoHeight;
  const ctx = refs.captureCanvas.getContext("2d");
  ctx.drawImage(video, 0, 0);
  const sourceBlob = await canvasToBlob(refs.captureCanvas, "image/jpeg", .92);
  await setPendingPhoto(sourceBlob);
  stopCamera();
}

async function handleFallbackPhoto(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await setPendingPhoto(file);
  } catch (error) {
    console.error(error);
    toast("이 사진을 읽지 못했습니다.");
  }
  event.target.value = "";
}

async function setPendingPhoto(sourceBlob) {
  refs.photoSizeText.textContent = "사진을 압축하는 중…";
  const { fullBlob, thumbBlob, width, height } = await compressImage(sourceBlob);
  state.pendingPhoto = { fullBlob, thumbBlob };
  const previewUrl = URL.createObjectURL(fullBlob);
  state.objectUrls.record.add(previewUrl);
  refs.photoPreview.src = previewUrl;
  refs.photoPreview.hidden = false;
  refs.cameraVideo.hidden = true;
  refs.cameraPlaceholder.hidden = true;
  refs.startCameraButton.hidden = true;
  refs.captureButton.hidden = true;
  refs.retakeButton.hidden = false;
  refs.photoSizeText.textContent = `${width}×${height} · 보관용 ${formatBytes(fullBlob.size)} · 썸네일 ${formatBytes(thumbBlob.size)}`;
}

function showExistingPhoto(blob) {
  state.pendingPhoto = null;
  const url = URL.createObjectURL(blob);
  state.objectUrls.record.add(url);
  refs.photoPreview.src = url;
  refs.photoPreview.hidden = false;
  refs.cameraPlaceholder.hidden = true;
  refs.startCameraButton.hidden = true;
  refs.captureButton.hidden = true;
  refs.retakeButton.hidden = false;
  refs.photoSizeText.textContent = `현재 사진 ${formatBytes(blob.size)}`;
}

async function compressImage(blob) {
  const source = await loadImage(blob);
  const full = await resizeImage(source, 1440, .78);
  const thumb = await resizeImage(source, 360, .72);
  source.close?.();
  return { fullBlob: full.blob, thumbBlob: thumb.blob, width: full.width, height: full.height };
}

async function loadImage(blob) {
  if ("createImageBitmap" in window) {
    try { return await createImageBitmap(blob, { imageOrientation: "from-image" }); } catch (_) {}
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지 로드 실패")); };
    image.src = url;
  });
}

async function resizeImage(source, maxSide, quality) {
  const sourceWidth = source.width || source.naturalWidth;
  const sourceHeight = source.height || source.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  let blob = await canvasToBlob(canvas, "image/webp", quality);
  if (!blob || blob.type !== "image/webp") blob = await canvasToBlob(canvas, "image/jpeg", quality);
  return { blob, width, height };
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("이미지 압축 실패")), type, quality);
  });
}

async function saveFigure() {
  const editingId = refs.editingFigureId.value;
  const existing = editingId ? await FigureDB.getFigure(editingId) : null;
  if (!state.pendingPhoto && !existing?.fullBlob) {
    toast("피규어 사진을 먼저 촬영하세요.");
    return;
  }

  const wasSpeciesOwned = (state.figuresBySpecies.get(state.currentSpecies.id) || []).length > 0;
  const previousOwnedCount = state.figuresBySpecies.size;
  refs.saveFigureButton.disabled = true;
  refs.saveFigureButton.textContent = "저장 중";
  try {
    const now = new Date().toISOString();
    const figure = {
      id: existing?.id || crypto.randomUUID(),
      speciesId: state.currentSpecies.id,
      speciesName: state.currentSpecies.name,
      speciesSlug: state.currentSpecies.slug,
      figureName: refs.figureNameInput.value.trim(),
      form: refs.formInput.value.trim() || "기본 모습",
      maker: refs.makerInput.value.trim(),
      series: refs.seriesInput.value.trim(),
      productCode: refs.productCodeInput.value.trim(),
      source: refs.sourceInput.value.trim(),
      price: refs.priceInput.value === "" ? null : Number(refs.priceInput.value),
      currency: refs.currencyInput.value,
      purchaseDate: refs.purchaseDateInput.value,
      condition: refs.conditionInput.value,
      location: refs.locationInput.value.trim(),
      notes: refs.notesInput.value.trim(),
      fullBlob: state.pendingPhoto?.fullBlob || existing.fullBlob,
      thumbBlob: state.pendingPhoto?.thumbBlob || existing.thumbBlob,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    await FigureDB.putFigure(figure);
    if (refs.setAsCoverInput.checked || !getCoverFigure(state.currentSpecies.id)) {
      const pref = { speciesId: state.currentSpecies.id, coverFigureId: figure.id, updatedAt: now };
      await FigureDB.putSpeciesPref(pref);
      state.prefs.set(state.currentSpecies.id, pref);
    }
    const index = state.figures.findIndex(item => item.id === figure.id);
    if (index >= 0) state.figures[index] = figure; else state.figures.push(figure);
    indexFigures();
    populateCollectionControls();
    renderStats();
    renderDashboard();
    refs.recordDialog.close();
    renderFigureList();
    renderGrid();
    requestPersistentStorage(true);
    if (!existing && !wasSpeciesOwned) {
      showAchievement(figure, previousOwnedCount);
    } else {
      toast(existing ? "피규어 기록을 수정했습니다." : "새로운 피규어를 추가했습니다.");
    }
  } catch (error) {
    console.error(error);
    toast("저장하지 못했습니다. 저장공간을 확인하세요.");
  } finally {
    refs.saveFigureButton.disabled = false;
    refs.saveFigureButton.textContent = "저장";
  }
}

function showAchievement(figure, previousOwnedCount) {
  revokeObjectUrls("achievement");
  const pokemon = state.currentSpecies;
  const total = state.catalog.length;
  const oldRate = total ? previousOwnedCount / total * 100 : 0;
  const newRate = total ? (previousOwnedCount + 1) / total * 100 : 0;
  const imageUrl = figure.thumbBlob ? URL.createObjectURL(figure.thumbBlob) : pokemon.imageUrl;
  if (figure.thumbBlob) state.objectUrls.achievement.add(imageUrl);
  refs.achievementImage.src = imageUrl;
  refs.achievementImage.alt = `${pokemon.name} 피규어`;
  refs.achievementNumber.textContent = `NATIONAL DEX #${String(pokemon.id).padStart(4, "0")}`;
  refs.achievementName.textContent = pokemon.name;
  refs.achievementOldRate.textContent = formatRate(oldRate);
  refs.achievementNewRate.textContent = formatRate(newRate);
  refs.achievementDialog.showModal();
}

function closeAchievement() {
  if (refs.achievementDialog.open) refs.achievementDialog.close();
  revokeObjectUrls("achievement");
}

async function setCoverFigure(figureId) {
  const pref = { speciesId: state.currentSpecies.id, coverFigureId: figureId, updatedAt: new Date().toISOString() };
  await FigureDB.putSpeciesPref(pref);
  state.prefs.set(state.currentSpecies.id, pref);
  renderFigureList();
  renderGrid();
  toast("대표 썸네일을 변경했습니다.");
}

async function removeFigure(figure) {
  const accepted = confirm(`‘${figure.figureName || state.currentSpecies.name}’ 기록을 삭제할까요?`);
  if (!accepted) return;
  await FigureDB.deleteFigure(figure.id);
  state.figures = state.figures.filter(item => item.id !== figure.id);
  indexFigures();
  populateCollectionControls();
  const remaining = state.figuresBySpecies.get(state.currentSpecies.id) || [];
  const pref = state.prefs.get(state.currentSpecies.id);
  if (pref?.coverFigureId === figure.id) {
    const nextPref = { speciesId: state.currentSpecies.id, coverFigureId: remaining[0]?.id || null, updatedAt: new Date().toISOString() };
    await FigureDB.putSpeciesPref(nextPref);
    state.prefs.set(state.currentSpecies.id, nextPref);
  }
  renderStats();
  renderDashboard();
  renderFigureList();
  renderGrid();
  refs.detailSubtext.textContent = remaining.length ? `등록한 피규어 ${remaining.length}개` : "아직 등록한 피규어가 없습니다.";
  toast("기록을 삭제했습니다.");
}

function resetPhotoCapture() {
  stopCamera();
  state.pendingPhoto = null;
  refs.photoPreview.hidden = true;
  refs.photoPreview.removeAttribute("src");
  refs.cameraVideo.hidden = true;
  refs.cameraPlaceholder.hidden = false;
  refs.startCameraButton.hidden = false;
  refs.captureButton.hidden = true;
  refs.retakeButton.hidden = true;
  refs.photoSizeText.textContent = "";
  revokeObjectUrls("record");
}

function resetRecordDialog() {
  stopCamera();
  state.pendingPhoto = null;
  refs.figureForm.reset();
  refs.editingFigureId.value = "";
  refs.formInput.value = "기본 모습";
  refs.currencyInput.value = "KRW";
  refs.setAsCoverInput.checked = true;
  refs.photoPreview.hidden = true;
  refs.photoPreview.removeAttribute("src");
  refs.cameraVideo.hidden = true;
  refs.cameraPlaceholder.hidden = false;
  refs.startCameraButton.hidden = false;
  refs.captureButton.hidden = true;
  refs.retakeButton.hidden = true;
  refs.photoSizeText.textContent = "";
  revokeObjectUrls("record");
}

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach(track => track.stop());
    state.cameraStream = null;
  }
  refs.cameraVideo.srcObject = null;
}

async function exportBackup() {
  refs.exportButton.disabled = true;
  refs.exportButton.querySelector("small").textContent = "사진을 묶는 중…";
  try {
    const figures = [];
    for (const figure of state.figures) {
      figures.push({
        ...figure,
        fullBlob: undefined,
        thumbBlob: undefined,
        fullImage: figure.fullBlob ? await blobToDataURL(figure.fullBlob) : null,
        thumbImage: figure.thumbBlob ? await blobToDataURL(figure.thumbBlob) : null
      });
    }
    const backup = {
      app: "pokemon-figure-archive",
      version: 2,
      exportedAt: new Date().toISOString(),
      figures,
      speciesPrefs: [...state.prefs.values()],
      seriesGoals: state.seriesGoals
    };
    const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `pokemon-figure-backup-${date}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast("사진 포함 백업 파일을 만들었습니다.");
  } catch (error) {
    console.error(error);
    toast("백업 파일을 만들지 못했습니다.");
  } finally {
    refs.exportButton.disabled = false;
    refs.exportButton.querySelector("small").textContent = "사진을 포함한 JSON 파일";
  }
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.app !== "pokemon-figure-archive" || !Array.isArray(parsed.figures)) throw new Error("지원하지 않는 파일");
    for (const row of parsed.figures) {
      const figure = {
        ...row,
        fullImage: undefined,
        thumbImage: undefined,
        fullBlob: row.fullImage ? dataURLToBlob(row.fullImage) : null,
        thumbBlob: row.thumbImage ? dataURLToBlob(row.thumbImage) : null
      };
      await FigureDB.putFigure(figure);
    }
    for (const pref of parsed.speciesPrefs || []) await FigureDB.putSpeciesPref(pref);
    for (const goal of parsed.seriesGoals || []) await FigureDB.putSeriesGoal(goal);
    state.figures = await FigureDB.getAllFigures();
    state.prefs = new Map((await FigureDB.getAllSpeciesPrefs()).map(pref => [Number(pref.speciesId), pref]));
    state.seriesGoals = await FigureDB.getAllSeriesGoals();
    indexFigures();
    renderAll();
    refs.settingsDialog.close();
    toast(`${parsed.figures.length}개 기록과 시리즈 목표를 불러왔습니다.`);
  } catch (error) {
    console.error(error);
    toast("올바른 백업 파일이 아닙니다.");
  } finally {
    event.target.value = "";
  }
}

async function refreshCatalog() {
  refs.settingsDialog.close();
  showLoading("포켓몬 목록을 갱신하는 중", "수집 기록과 사진은 그대로 유지됩니다.");
  try {
    state.catalog = await fetchCatalog();
    await FigureDB.setMeta("catalog", state.catalog);
    await FigureDB.setMeta("catalogVersion", CATALOG_CACHE_VERSION);
    renderAll();
    toast("포켓몬 목록을 최신 데이터로 갱신했습니다.");
  } catch (error) {
    console.error(error);
    toast("목록을 갱신하지 못했습니다.");
  } finally {
    hideLoading();
  }
}

async function requestPersistentStorage(silent = false) {
  if (!navigator.storage?.persist) {
    if (!silent) toast("이 브라우저는 저장공간 보호 요청을 지원하지 않습니다.");
    return;
  }
  try {
    const persisted = await navigator.storage.persist();
    refs.storageStatus.textContent = persisted ? "보호 승인됨" : "브라우저가 승인하지 않음";
    if (!silent) toast(persisted ? "브라우저에 저장공간 보호를 요청했습니다." : "보호 요청이 승인되지 않았습니다. 백업을 유지하세요.");
  } catch (error) {
    console.error(error);
  }
  updateStorageInfo();
}

async function updateStorageInfo() {
  try {
    if (navigator.storage?.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      refs.storageUsage.textContent = `${formatBytes(usage)} / ${formatBytes(quota)}`;
    } else refs.storageUsage.textContent = "확인 불가";
    if (navigator.storage?.persisted) {
      refs.storageStatus.textContent = await navigator.storage.persisted() ? "보호 승인됨" : "보호되지 않음";
    }
  } catch (_) {
    refs.storageUsage.textContent = "확인 불가";
  }
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataURLToBlob(dataURL) {
  const [header, data] = dataURL.split(",");
  const mime = header.match(/data:(.*?);base64/)?.[1] || "application/octet-stream";
  const bytes = atob(data);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type: mime });
}

function showLoading(title, message) {
  refs.loadingTitle.textContent = title;
  refs.loadingMessage.textContent = message;
  refs.loadingPanel.hidden = false;
  refs.pokemonGrid.hidden = true;
}
function hideLoading() {
  refs.loadingPanel.hidden = true;
  refs.pokemonGrid.hidden = false;
}
function closeDialog(id) {
  document.getElementById(id)?.close();
}
function revokeObjectUrls(scope) {
  const pools = scope ? [state.objectUrls[scope]] : Object.values(state.objectUrls);
  for (const pool of pools) {
    if (!pool) continue;
    for (const url of pool) URL.revokeObjectURL(url);
    pool.clear();
  }
}
function toast(message) {
  refs.toast.textContent = message;
  refs.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => refs.toast.classList.remove("show"), 2600);
}
function formatRate(rate) {
  if (!Number.isFinite(rate) || rate <= 0) return "0%";
  if (rate < 10) return `${rate.toFixed(1)}%`;
  if (rate < 100 && Math.abs(rate - Math.round(rate)) >= .05) return `${rate.toFixed(1)}%`;
  return `${Math.round(rate)}%`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}
function formatPrice(value, currency) {
  if (value === null || value === undefined || value === "") return "";
  const symbols = { KRW: "원", JPY: "엔", USD: "달러", EUR: "유로" };
  return `${Number(value).toLocaleString("ko-KR")}${symbols[currency] || currency || ""}`;
}
function humanize(value = "") {
  return value.split("-").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
function escapeHTML(value = "") {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(error => console.error("SW registration failed", error));
  }
}
