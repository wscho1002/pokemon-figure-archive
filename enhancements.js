"use strict";

const ArchiveEnhancements = (() => {
  const $ = selector => document.querySelector(selector);
  const $id = id => document.getElementById(id);
  const THEME_KEY = "pokemon-figure-theme-v2";
  const LAYOUT_KEY = "pokemon-figure-dashboard-layout-v2";
  const AUTO_SYNC_KEY = "pokemon-figure-auto-sync-v1";
  const WIFI_SYNC_KEY = "pokemon-figure-wifi-sync-v1";
  const DIRTY_KEY = "pokemon-figure-sync-dirty";
  const LAST_SYNC_KEY = "pokemon-figure-last-sync";
  const DEFAULT_LAYOUT = ["generation", "recent", "collection"];
  const SECTION_MAP = {
    generation: { selector: '[aria-labelledby="generationTitle"]', label: "세대별 완성률" },
    recent: { selector: "#recentSection", label: "최근 획득" },
    collection: { selector: "#collectionSection", label: "제조사·시리즈 도감" }
  };
  let layout = loadLayout();
  let autoSyncTimer = null;
  let compareContext = null;
  let friendDexRows = [];
  let friendDexUrls = [];

  function init() {
    if (!window.FigureArchiveApp) return;
    injectDashboardControls();
    injectBottomNavigation();
    injectQuickAddDialog();
    injectDisplayDialog();
    applyTheme(localStorage.getItem(THEME_KEY) || "system");
    applyDashboardLayout();
    enhanceCollapsedSummaries();
    setTimeout(enhanceOnlineUI, 50);
    bindGlobalEvents();
    refreshNavigationState();
  }

  function loadLayout() {
    try {
      const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "null");
      if (saved && Array.isArray(saved.order)) {
        return {
          order: [...saved.order.filter(key => DEFAULT_LAYOUT.includes(key)), ...DEFAULT_LAYOUT.filter(key => !saved.order.includes(key))],
          hidden: Array.isArray(saved.hidden) ? saved.hidden.filter(key => DEFAULT_LAYOUT.includes(key)) : []
        };
      }
    } catch (_) {}
    return { order: [...DEFAULT_LAYOUT], hidden: [] };
  }

  function saveLayout() { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); }

  function injectDashboardControls() {
    const completion = $(".completion-card");
    if (!completion || $id("dashboardUtilityBar")) return;
    completion.insertAdjacentHTML("beforebegin", `
      <section id="dashboardUtilityBar" class="dashboard-utility-bar" aria-label="대시보드 표시 설정">
        <div><strong>내 도감 대시보드</strong><small>필요한 정보만 펼쳐서 보세요.</small></div>
        <div class="dashboard-utility-actions">
          <button id="collapseAllDashboard" type="button">모두 접기</button>
          <button id="expandAllDashboard" type="button">모두 펼치기</button>
          <button id="customizeDashboard" type="button">화면 편집</button>
        </div>
      </section>`);
    $id("collapseAllDashboard").addEventListener("click", () => setAllCollapsed(true));
    $id("expandAllDashboard").addEventListener("click", () => setAllCollapsed(false));
    $id("customizeDashboard").addEventListener("click", openDisplayDialog);
  }

  function setAllCollapsed(collapsed) {
    document.querySelectorAll(".collapse-button[data-collapse-target]").forEach(button => {
      const target = $id(button.dataset.collapseTarget);
      if (target && target.hidden !== collapsed) button.click();
    });
  }

  function injectBottomNavigation() {
    if ($id("bottomNavigation")) return;
    document.body.insertAdjacentHTML("beforeend", `
      <nav id="bottomNavigation" class="bottom-navigation" aria-label="주요 메뉴">
        <button type="button" data-bottom-nav="home" class="active"><span>⌂</span><em>홈</em></button>
        <button type="button" data-bottom-nav="dex"><span>▦</span><em>도감</em></button>
        <button type="button" data-bottom-nav="friends"><span>♧</span><em>친구</em><b id="friendNavBadge" hidden>0</b></button>
        <button type="button" data-bottom-nav="settings"><span>⚙</span><em>설정</em><i id="syncDirtyDot" hidden></i></button>
      </nav>
      <button id="quickAddFab" type="button" class="quick-add-fab" aria-label="피규어 빠른 등록">＋</button>`);
    $id("bottomNavigation").addEventListener("click", event => {
      const button = event.target.closest("[data-bottom-nav]");
      if (!button) return;
      document.querySelectorAll("[data-bottom-nav]").forEach(item => item.classList.toggle("active", item === button));
      const action = button.dataset.bottomNav;
      if (action === "home") window.scrollTo({ top: 0, behavior: "smooth" });
      if (action === "dex") $(".sticky-toolbar")?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (action === "friends") { OnlineArchive.open?.(); setTimeout(() => { refreshSyncCenter(); refreshQrCode(); }, 100); }
      if (action === "settings") { $id("settingsDialog")?.showModal(); setTimeout(updateDisplayControls, 0); }
    });
    $id("quickAddFab").addEventListener("click", openQuickAddDialog);
  }

  function injectQuickAddDialog() {
    if ($id("quickAddDialog")) return;
    document.body.insertAdjacentHTML("beforeend", `
      <dialog id="quickAddDialog" class="sheet-dialog quick-add-dialog">
        <div class="sheet-handle"></div>
        <header class="dialog-header"><div><p class="eyebrow">QUICK ADD</p><h2>피규어 빠른 등록</h2></div><button type="button" id="closeQuickAdd" class="icon-button">×</button></header>
        <label class="search-box quick-add-search"><span>⌕</span><input id="quickAddSearch" type="search" placeholder="포켓몬 이름 또는 도감 번호"></label>
        <div class="quick-add-hint">포켓몬을 선택하면 상세 화면에서 바로 기록할 수 있습니다.</div>
        <div id="quickAddResults" class="quick-add-results"></div>
      </dialog>`);
    $id("closeQuickAdd").addEventListener("click", () => $id("quickAddDialog").close());
    $id("quickAddDialog").addEventListener("click", event => { if (event.target === $id("quickAddDialog")) $id("quickAddDialog").close(); });
    $id("quickAddSearch").addEventListener("input", renderQuickAddResults);
  }

  function openQuickAddDialog() {
    $id("quickAddDialog").showModal();
    $id("quickAddSearch").value = "";
    renderQuickAddResults();
    setTimeout(() => $id("quickAddSearch").focus(), 100);
  }

  function renderQuickAddResults() {
    const state = FigureArchiveApp.getState();
    const query = $id("quickAddSearch").value.trim().toLowerCase();
    const recentSpecies = [...new Set([...state.figures].sort((a,b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)).map(row => Number(row.speciesId)))];
    let list = query ? state.catalog.filter(item => item.name.toLowerCase().includes(query) || item.slug.toLowerCase().includes(query) || String(item.id) === query.replace(/^#/, "")) : [...recentSpecies.map(id => state.catalog.find(item => item.id === id)).filter(Boolean), ...state.catalog].filter((item,index,array) => array.findIndex(row => row.id === item.id) === index);
    list = list.slice(0, 18);
    $id("quickAddResults").innerHTML = list.length ? list.map(item => `<button type="button" data-quick-species="${item.id}"><img src="${item.imageUrl}" alt=""><span><strong>${escapeHtml(item.name)}</strong><small>No.${String(item.id).padStart(4,"0")} · ${item.generation}세대</small></span><b>›</b></button>`).join("") : '<p class="empty-inline">검색 결과가 없습니다.</p>';
    $id("quickAddResults").querySelectorAll("[data-quick-species]").forEach(button => button.addEventListener("click", async () => { $id("quickAddDialog").close(); await FigureArchiveApp.openDetail(Number(button.dataset.quickSpecies)); }));
  }

  function injectDisplayDialog() {
    if ($id("displayDialog")) return;
    document.body.insertAdjacentHTML("beforeend", `
      <dialog id="displayDialog" class="sheet-dialog display-dialog">
        <div class="sheet-handle"></div>
        <header class="dialog-header"><div><p class="eyebrow">APPEARANCE</p><h2>화면 설정</h2></div><button id="closeDisplayDialog" class="icon-button">×</button></header>
        <section class="display-setting-block"><h3>테마</h3><div class="segmented-control" id="themeSelector"><button type="button" data-theme-choice="system">기기 설정</button><button type="button" data-theme-choice="dark">다크</button><button type="button" data-theme-choice="light">라이트</button></div></section>
        <section class="display-setting-block"><div class="online-card-heading"><div><h3>대시보드 구성</h3><p>표시 여부와 순서를 조정합니다.</p></div><button id="resetDashboardLayout" type="button" class="text-button">초기화</button></div><div id="dashboardLayoutList" class="dashboard-layout-list"></div></section>
      </dialog>`);
    $id("closeDisplayDialog").addEventListener("click", () => $id("displayDialog").close());
    $id("themeSelector").addEventListener("click", event => { const button = event.target.closest("[data-theme-choice]"); if (button) { applyTheme(button.dataset.themeChoice); updateDisplayControls(); } });
    $id("resetDashboardLayout").addEventListener("click", () => { layout = { order: [...DEFAULT_LAYOUT], hidden: [] }; saveLayout(); applyDashboardLayout(); updateDisplayControls(); });
  }

  function openDisplayDialog() { updateDisplayControls(); $id("displayDialog").showModal(); }

  function updateDisplayControls() {
    const theme = localStorage.getItem(THEME_KEY) || "system";
    document.querySelectorAll("[data-theme-choice]").forEach(button => button.classList.toggle("active", button.dataset.themeChoice === theme));
    const list = $id("dashboardLayoutList");
    if (!list) return;
    list.innerHTML = layout.order.map((key,index) => `<div class="dashboard-layout-row"><label><input type="checkbox" data-layout-visible="${key}" ${layout.hidden.includes(key) ? "" : "checked"}><span>${SECTION_MAP[key].label}</span></label><div><button type="button" data-layout-up="${key}" ${index === 0 ? "disabled" : ""}>↑</button><button type="button" data-layout-down="${key}" ${index === layout.order.length - 1 ? "disabled" : ""}>↓</button></div></div>`).join("");
    list.querySelectorAll("[data-layout-visible]").forEach(input => input.addEventListener("change", () => { const key = input.dataset.layoutVisible; layout.hidden = input.checked ? layout.hidden.filter(item => item !== key) : [...new Set([...layout.hidden,key])]; saveLayout(); applyDashboardLayout(); }));
    list.querySelectorAll("[data-layout-up]").forEach(button => button.addEventListener("click", () => moveLayout(button.dataset.layoutUp,-1)));
    list.querySelectorAll("[data-layout-down]").forEach(button => button.addEventListener("click", () => moveLayout(button.dataset.layoutDown,1)));
  }

  function moveLayout(key,direction) { const index = layout.order.indexOf(key); const target = index + direction; if (index < 0 || target < 0 || target >= layout.order.length) return; [layout.order[index],layout.order[target]] = [layout.order[target],layout.order[index]]; saveLayout(); applyDashboardLayout(); updateDisplayControls(); }

  function applyDashboardLayout() {
    const toolbar = $(".sticky-toolbar");
    if (!toolbar) return;
    for (const key of layout.order) {
      const section = $(SECTION_MAP[key].selector);
      if (!section) continue;
      const hasRecent = FigureArchiveApp.getState().figures.length > 0;
      section.hidden = layout.hidden.includes(key) || (key === "recent" && !hasRecent);
      toolbar.parentElement.insertBefore(section, toolbar);
    }
  }

  function applyTheme(theme) {
    localStorage.setItem(THEME_KEY, theme);
    const resolved = theme === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : theme;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = resolved === "light" ? "#f4f5f8" : "#16181d";
  }

  function enhanceCollapsedSummaries() {
    Object.entries(SECTION_MAP).forEach(([key,item]) => { const section = $(item.selector); const heading = section?.querySelector(".section-heading > div:first-child"); if (!section || !heading || heading.querySelector(".collapsed-summary")) return; const summary = document.createElement("small"); summary.className = "collapsed-summary"; summary.dataset.summaryKey = key; heading.append(summary); });
    updateCollapsedSummaries();
  }

  function updateCollapsedSummaries() {
    const state = FigureArchiveApp.getState();
    const generationTotals = new Map(); state.catalog.forEach(item => generationTotals.set(item.generation,(generationTotals.get(item.generation)||0)+1));
    const owned = new Set(state.figures.map(item => Number(item.speciesId)));
    const best = [...generationTotals].map(([generation,total]) => ({ generation, rate: [...owned].filter(id => state.catalog.find(item => item.id === id)?.generation === generation).length / total * 100 })).sort((a,b) => b.rate-a.rate)[0];
    const generation = $('[data-summary-key="generation"]'); if (generation) generation.textContent = best ? `최고 ${best.generation}세대 ${best.rate.toFixed(1)}%` : "아직 등록 없음";
    const recent = $('[data-summary-key="recent"]'); if (recent) recent.textContent = state.figures.length ? `최근 ${Math.min(10,state.figures.length)}개 기록` : "아직 등록 없음";
    const collection = $('[data-summary-key="collection"]'); if (collection) { const makers = new Set(state.figures.map(item => item.maker?.trim()).filter(Boolean)); const series = new Set(state.figures.map(item => `${item.maker?.trim()}::${item.series?.trim()}`).filter(item => !item.includes("undefined") && !item.endsWith("::"))); collection.textContent = `${makers.size}개 제조사 · ${series.size}개 시리즈`; }
  }

  function enhanceOnlineUI() {
    const dialog = $id("onlineDialog");
    if (!dialog || $id("syncCenterStats")) return;
    const syncCard = dialog.querySelector(".sync-card");
    syncCard?.querySelector(".online-card-heading")?.insertAdjacentHTML("afterend", `<div id="syncCenterStats" class="sync-center-stats"><div><strong id="syncLocalCount">0</strong><span>로컬</span></div><div><strong id="syncCloudCount">-</strong><span>클라우드</span></div><div><strong id="syncPendingCount">0</strong><span>대기</span></div></div><div class="sync-progress-track"><span id="syncProgressBar"></span></div><div class="sync-meta-row"><span id="lastSyncText">아직 동기화하지 않음</span><button id="compareCloudButton" type="button" class="text-button accent">상태 비교</button></div><div class="sync-options"><label class="toggle-row"><span><b>자동 동기화</b><small>기록 변경 후 자동 업로드</small></span><input id="autoSyncInput" type="checkbox"></label><label class="toggle-row"><span><b>Wi-Fi에서만 사진 업로드</b><small>지원되는 브라우저에서 적용</small></span><input id="wifiSyncInput" type="checkbox"></label></div>`);
    dialog.querySelector(".online-profile-card")?.insertAdjacentHTML("afterend", `<details class="online-card qr-card"><summary>친구 코드 QR·공유</summary><div class="qr-card-body"><img id="friendQrImage" alt="친구 코드 QR"><p id="friendQrCode">-</p><div><button id="copyCodeAgain" class="secondary-button">코드 복사</button><button id="shareCollectionCard" class="secondary-button">도감 카드 공유</button></div><label class="secondary-button qr-scan-button">QR 사진 읽기<input id="qrScanInput" type="file" accept="image/*" capture="environment"></label></div></details>`);
    const comparePanel = $id("comparePanel");
    comparePanel?.querySelector(".compare-tabs")?.insertAdjacentHTML("beforebegin", `<div class="compare-filter-row"><input id="compareSearchInput" type="search" placeholder="포켓몬 검색"><select id="compareGenerationFilter"><option value="all">모든 세대</option>${[1,2,3,4,5,6,7,8,9].map(n => `<option value="${n}">${n}세대</option>`).join("")}</select></div>`);
    comparePanel?.querySelector(".compare-tabs")?.insertAdjacentHTML("beforeend", '<button data-compare="neither">둘 다 미보유</button>');
    dialog.querySelector("#accountPanel")?.insertAdjacentHTML("beforeend", `<div id="friendDexPanel" class="online-card friend-dex-panel" hidden><div class="online-card-heading"><div><p class="eyebrow">FRIEND DEX</p><h3 id="friendDexTitle">친구 공개 도감</h3></div><button id="closeFriendDex" class="text-button">닫기</button></div><div class="friend-dex-controls"><input id="friendDexSearch" type="search" placeholder="포켓몬·상품 검색"><select id="friendDexMaker"><option value="all">모든 제조사</option></select></div><div id="friendDexStats" class="friend-dex-stats"></div><div id="friendDexGrid" class="friend-dex-grid"></div></div><details class="online-card online-details account-data-details"><summary>계정·클라우드 데이터 관리</summary><div class="online-details-body"><button id="exportCloudButton" class="secondary-button">클라우드 기록 JSON 저장</button><button id="globalSignOutButton" class="secondary-button">모든 기기에서 로그아웃</button><button id="deleteCloudButton" class="danger-button">클라우드 공개 기록 삭제</button></div></details>`);

    $id("autoSyncInput").checked = localStorage.getItem(AUTO_SYNC_KEY) === "true";
    $id("wifiSyncInput").checked = localStorage.getItem(WIFI_SYNC_KEY) === "true";
    $id("autoSyncInput").addEventListener("change", event => localStorage.setItem(AUTO_SYNC_KEY,String(event.target.checked)));
    $id("wifiSyncInput").addEventListener("change", event => localStorage.setItem(WIFI_SYNC_KEY,String(event.target.checked)));
    $id("compareCloudButton").addEventListener("click", compareCloudState);
    $id("copyCodeAgain").addEventListener("click", () => $id("copyFriendCodeButton")?.click());
    $id("shareCollectionCard").addEventListener("click", shareCollectionCard);
    $id("qrScanInput").addEventListener("change", scanFriendQr);
    $id("compareSearchInput").addEventListener("input", () => renderEnhancedCompare());
    $id("compareGenerationFilter").addEventListener("change", () => renderEnhancedCompare());
    comparePanel?.querySelector(".compare-tabs")?.addEventListener("click", event => { const button = event.target.closest("[data-compare]"); if (button) setTimeout(() => renderEnhancedCompare(button.dataset.compare),0); });
    $id("friendList").addEventListener("click", handleFriendListAction);
    $id("closeFriendDex").addEventListener("click", closeFriendDex);
    $id("friendDexSearch").addEventListener("input", renderFriendDex);
    $id("friendDexMaker").addEventListener("change", renderFriendDex);
    $id("exportCloudButton").addEventListener("click", exportCloudData);
    $id("globalSignOutButton").addEventListener("click", globalSignOut);
    $id("deleteCloudButton").addEventListener("click", deleteCloudData);
    refreshSyncCenter(); refreshQrCode(); [250,800,1800].forEach(delay => setTimeout(() => { refreshSyncCenter(); refreshQrCode(); },delay));
  }

  function bindGlobalEvents() {
    window.addEventListener("figurearchive:changed", event => { localStorage.setItem(DIRTY_KEY,"true"); applyDashboardLayout(); refreshNavigationState(); refreshSyncCenter(); updateCollapsedSummaries(); scheduleAutoSync(event.detail?.type); });
    window.addEventListener("figurearchive:sync-progress", event => { const bar = $id("syncProgressBar"); if (bar) bar.style.width = `${event.detail.total ? event.detail.current/event.detail.total*100 : 0}%`; });
    window.addEventListener("figurearchive:synced", () => { const bar = $id("syncProgressBar"); if (bar) bar.style.width = "100%"; refreshNavigationState(); refreshSyncCenter(); });
    window.addEventListener("figurearchive:sync-error", refreshNavigationState);
    window.addEventListener("figurearchive:friends", event => { const badge = $id("friendNavBadge"); const count = Number(event.detail?.incoming || 0); if (badge) { badge.textContent = String(count); badge.hidden = count === 0; } });
    window.addEventListener("figurearchive:compare-loaded", event => { compareContext = event.detail; const rows = compareContext.rows || []; const mine = rows.filter(row => row.mine && !row.theirs).length; const friend = rows.filter(row => !row.mine && row.theirs).length; const both = rows.filter(row => row.mine && row.theirs).length; const neither = Math.max(0,FigureArchiveApp.getState().catalog.length-new Set(rows.map(row => Number(row.species_id))).size); const summary = $id("compareSummary"); if (summary) summary.innerHTML = `<div><strong>${mine}</strong><span>나만 보유</span></div><div><strong>${friend}</strong><span>친구만 보유</span></div><div><strong>${both}</strong><span>공통 보유</span></div><div><strong>${neither}</strong><span>둘 다 미보유</span></div>`; renderEnhancedCompare("mine"); });
    window.addEventListener("figurearchive:auth", () => setTimeout(() => { refreshSyncCenter(); refreshQrCode(); },100));
    matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", () => { if ((localStorage.getItem(THEME_KEY)||"system") === "system") applyTheme("system"); });
    window.addEventListener("online", () => scheduleAutoSync("online"));
  }

  function refreshNavigationState() { const dot = $id("syncDirtyDot"); if (dot) dot.hidden = localStorage.getItem(DIRTY_KEY) !== "true"; }

  async function refreshSyncCenter() {
    const localCount = FigureArchiveApp.getState().figures.length;
    if ($id("syncLocalCount")) $id("syncLocalCount").textContent = String(localCount);
    if ($id("syncPendingCount")) $id("syncPendingCount").textContent = localStorage.getItem(DIRTY_KEY) === "true" ? String(localCount) : "0";
    const last = localStorage.getItem(LAST_SYNC_KEY); if ($id("lastSyncText")) $id("lastSyncText").textContent = last ? `마지막 동기화 ${formatDateTime(last)}` : "아직 동기화하지 않음";
    const client = OnlineArchive.getClient?.(), user = OnlineArchive.getUser?.();
    if (!client || !user || !$id("syncCloudCount")) return;
    const { count,error } = await client.from("public_figures").select("id",{count:"exact",head:true}).eq("user_id",user.id);
    $id("syncCloudCount").textContent = error ? "!" : String(count || 0);
  }

  async function compareCloudState() {
    const client = OnlineArchive.getClient?.(), user = OnlineArchive.getUser?.(); if (!client || !user) return OnlineArchive.setStatus?.("로그인이 필요합니다.","error");
    OnlineArchive.setStatus?.("로컬과 클라우드를 비교하는 중","working");
    const { data,error } = await client.from("public_figures").select("id,updated_at").eq("user_id",user.id); if (error) return OnlineArchive.setStatus?.(error.message,"error");
    const localRows = FigureArchiveApp.getState().figures, localIds = new Set(localRows.map(row => row.id)), cloudIds = new Set((data||[]).map(row => row.id));
    const localOnly = [...localIds].filter(id => !cloudIds.has(id)).length, cloudOnly = [...cloudIds].filter(id => !localIds.has(id)).length, same = [...localIds].filter(id => cloudIds.has(id)).length;
    const localById = new Map(localRows.map(row => [row.id,row])); const conflicts = (data||[]).filter(row => { const local = localById.get(row.id); return local && Math.abs(new Date(local.updatedAt||0)-new Date(row.updated_at||0))>1500; }).length;
    OnlineArchive.setStatus?.(`비교 완료 · 공통 ${same}개 · 로컬만 ${localOnly}개 · 클라우드만 ${cloudOnly}개 · 수정 차이 ${conflicts}개`,localOnly||cloudOnly||conflicts?"warning":"success");
  }

  function scheduleAutoSync(reason) { if (localStorage.getItem(AUTO_SYNC_KEY) !== "true" || !navigator.onLine) return; if (localStorage.getItem(WIFI_SYNC_KEY) === "true" && !isWifiConnection()) return; clearTimeout(autoSyncTimer); autoSyncTimer = setTimeout(() => OnlineArchive.uploadCollection?.({automatic:true,reason}),2500); }
  function isWifiConnection() { const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection; return !connection?.type || connection.type === "wifi" || connection.type === "ethernet"; }

  function refreshQrCode() { const profile = OnlineArchive.getProfile?.(), img = $id("friendQrImage"), text = $id("friendQrCode"); if (!img || !text || !profile?.friend_code) return; img.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=${encodeURIComponent(`PFA-FRIEND:${profile.friend_code}`)}`; text.textContent = profile.friend_code; }

  async function scanFriendQr(event) { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; if (!("BarcodeDetector" in window)) return OnlineArchive.setStatus?.("이 브라우저는 QR 사진 인식을 지원하지 않습니다. 코드를 직접 입력하세요.","warning"); try { const detector = new BarcodeDetector({formats:["qr_code"]}); const bitmap = await createImageBitmap(file); const codes = await detector.detect(bitmap); bitmap.close?.(); const match = (codes[0]?.rawValue || "").match(/PFG-[A-Z0-9]{6}/i); if (!match) throw new Error("친구 코드가 포함된 QR이 아닙니다."); $id("friendCodeInput").value = match[0].toUpperCase(); $id("friendCodeInput").scrollIntoView({behavior:"smooth",block:"center"}); OnlineArchive.setStatus?.("QR에서 친구 코드를 불러왔습니다.","success"); } catch (error) { OnlineArchive.setStatus?.(error.message || "QR을 읽지 못했습니다.","error"); } }

  async function handleFriendListAction(event) { const view = event.target.closest("[data-view-friend]"), remove = event.target.closest("[data-remove-friend]"); if (view) return openFriendDex(view.dataset.viewFriend,view.dataset.name); if (remove) return removeFriend(remove.dataset.removeFriend,remove.dataset.name); }
  async function removeFriend(id,name) { if (!confirm(`${name}님을 친구 목록에서 삭제할까요?`)) return; const { error } = await OnlineArchive.getClient().from("friendships").delete().eq("id",id); if (error) return OnlineArchive.setStatus?.(error.message,"error"); OnlineArchive.setStatus?.(`${name}님을 친구 목록에서 삭제했습니다.`,"success"); OnlineArchive.loadFriends?.(); }

  async function openFriendDex(friendId,name) {
    const client = OnlineArchive.getClient?.(); if (!client) return; closeFriendDex(); $id("friendDexPanel").hidden = false; $id("friendDexTitle").textContent = `${name}님의 공개 도감`; $id("friendDexGrid").innerHTML = '<div class="loading-skeleton-list"><i></i><i></i><i></i></div>'; $id("friendDexPanel").scrollIntoView({behavior:"smooth",block:"start"});
    const { data,error } = await client.from("public_figures").select("*").eq("user_id",friendId).order("updated_at",{ascending:false}); if (error) { $id("friendDexGrid").innerHTML = `<p class="empty-inline">${escapeHtml(error.message)}</p>`; return; }
    friendDexRows = data || []; const makers = [...new Set(friendDexRows.map(row => row.maker).filter(Boolean))].sort((a,b) => a.localeCompare(b,"ko")); $id("friendDexMaker").innerHTML = '<option value="all">모든 제조사</option>' + makers.map(maker => `<option value="${escapeHtml(maker)}">${escapeHtml(maker)}</option>`).join(""); await hydrateFriendDexThumbs(client); renderFriendDex();
  }

  async function hydrateFriendDexThumbs(client) { friendDexUrls.forEach(URL.revokeObjectURL); friendDexUrls=[]; await Promise.all(friendDexRows.filter(row => row.thumb_path).slice(0,80).map(async row => { const { data,error } = await client.storage.from("figure-thumbs").download(row.thumb_path); if (!error && data) { row._thumbUrl = URL.createObjectURL(data); friendDexUrls.push(row._thumbUrl); } })); }

  function renderFriendDex() { const query = ($id("friendDexSearch")?.value||"").trim().toLowerCase(), maker = $id("friendDexMaker")?.value||"all"; const rows = friendDexRows.filter(row => (!query || `${row.species_name} ${row.figure_name} ${row.series} ${row.product_code}`.toLowerCase().includes(query)) && (maker === "all" || row.maker === maker)); const species = new Set(friendDexRows.map(row => row.species_id)); if ($id("friendDexStats")) $id("friendDexStats").innerHTML = `<span><strong>${friendDexRows.length}</strong>개 피규어</span><span><strong>${species.size}</strong>종</span>`; $id("friendDexGrid").innerHTML = rows.length ? rows.map(row => `<article><img src="${row._thumbUrl || `${ARTWORK_BASE}/${row.species_id}.png`}" alt=""><div><small>No.${String(row.species_id).padStart(4,"0")}</small><strong>${escapeHtml(row.species_name)}</strong><span>${escapeHtml(row.figure_name || row.form_name || "피규어")}</span><em>${escapeHtml([row.maker,row.series].filter(Boolean).join(" · "))}</em></div></article>`).join("") : '<p class="empty-inline">조건에 맞는 공개 기록이 없습니다.</p>'; }
  function closeFriendDex() { if ($id("friendDexPanel")) $id("friendDexPanel").hidden = true; friendDexUrls.forEach(URL.revokeObjectURL); friendDexUrls=[]; }

  function renderEnhancedCompare(mode) { if (!compareContext?.rows) return; mode = mode || $(".compare-tabs [data-compare].active")?.dataset.compare || "mine"; document.querySelectorAll("[data-compare]").forEach(button => button.classList.toggle("active",button.dataset.compare===mode)); const query = ($id("compareSearchInput")?.value||"").trim().toLowerCase(), generation = $id("compareGenerationFilter")?.value||"all"; let rows = compareContext.rows; if (mode === "neither") { const ownedIds = new Set(rows.map(row => Number(row.species_id))); rows = FigureArchiveApp.getState().catalog.filter(item => !ownedIds.has(item.id)).map(item => ({species_id:item.id,species_name:item.name,mine:false,theirs:false,mine_count:0,their_count:0})); } else rows = rows.filter(row => mode === "mine" ? row.mine && !row.theirs : mode === "friend" ? !row.mine && row.theirs : row.mine && row.theirs); rows = rows.filter(row => { const catalog = FigureArchiveApp.getState().catalog.find(item => item.id === Number(row.species_id)); return (!query || `${row.species_name} ${row.species_id}`.toLowerCase().includes(query)) && (generation === "all" || catalog?.generation === Number(generation)); }); $id("compareList").innerHTML = rows.length ? rows.map(row => `<div class="compare-item"><img src="${ARTWORK_BASE}/${row.species_id}.png" alt=""><div><strong>${String(row.species_id).padStart(4,"0")} ${escapeHtml(row.species_name)}</strong><small>나 ${row.mine_count||0}개 · 친구 ${row.their_count||0}개</small></div></div>`).join("") : '<p class="empty-inline">해당 포켓몬이 없습니다.</p>'; }

  async function shareCollectionCard() { const state = FigureArchiveApp.getState(), profile = OnlineArchive.getProfile?.(); const owned = new Set(state.figures.map(row => Number(row.speciesId))).size; const canvas = document.createElement("canvas"); canvas.width=1080; canvas.height=1350; const ctx=canvas.getContext("2d"), light=document.documentElement.dataset.theme === "light"; ctx.fillStyle=light?"#f4f5f8":"#121419"; ctx.fillRect(0,0,1080,1350); ctx.fillStyle="#ffca36"; ctx.fillRect(70,70,940,14); ctx.fillStyle=light?"#17191e":"#f6f7fb"; ctx.font="700 70px sans-serif"; ctx.fillText(`${profile?.nickname||"나"}의 피규어 도감`,70,190); ctx.font="500 32px sans-serif"; ctx.fillStyle=light?"#626873":"#aeb4c0"; ctx.fillText("POKÉMON FIGURE ARCHIVE",70,245); const stats=[[owned,"보유 포켓몬"],[state.figures.length,"피규어"],[state.catalog.length?`${(owned/state.catalog.length*100).toFixed(1)}%`:"0%","도감 완성률"]]; stats.forEach(([value,label],index) => { const x=70+index*315; ctx.fillStyle=light?"#ffffff":"#20232a"; roundRect(ctx,x,330,280,210,30); ctx.fill(); ctx.fillStyle="#ffca36"; ctx.font="800 56px sans-serif"; ctx.fillText(String(value),x+28,420); ctx.fillStyle=light?"#4d535e":"#c4c8d0"; ctx.font="500 28px sans-serif"; ctx.fillText(label,x+28,480); }); ctx.fillStyle=light?"#17191e":"#f6f7fb"; ctx.font="700 42px sans-serif"; ctx.fillText("최근 획득",70,650); [...state.figures].sort((a,b) => new Date(b.updatedAt||b.createdAt)-new Date(a.updatedAt||a.createdAt)).slice(0,5).forEach((row,index) => { ctx.fillStyle=light?"#ffffff":"#20232a"; roundRect(ctx,70,700+index*105,940,82,22); ctx.fill(); ctx.fillStyle=light?"#17191e":"#f6f7fb"; ctx.font="600 30px sans-serif"; ctx.fillText(`${row.speciesName} · ${row.figureName||row.form||"피규어"}`,100,752+index*105); }); ctx.fillStyle=light?"#626873":"#aeb4c0"; ctx.font="500 25px sans-serif"; ctx.fillText(new Date().toLocaleDateString("ko-KR"),70,1300); const blob = await new Promise(resolve => canvas.toBlob(resolve,"image/png")); if (!blob) return; const file = new File([blob],"pokemon-figure-dex.png",{type:"image/png"}); if (navigator.canShare?.({files:[file]})) await navigator.share({files:[file],title:"포켓몬 피규어 도감"}); else downloadBlob(blob,"pokemon-figure-dex.png"); }

  async function exportCloudData() { const client=OnlineArchive.getClient?.(), user=OnlineArchive.getUser?.(); if (!client||!user) return; const { data,error } = await client.from("public_figures").select("*").eq("user_id",user.id); if (error) return OnlineArchive.setStatus?.(error.message,"error"); downloadBlob(new Blob([JSON.stringify({exportedAt:new Date().toISOString(),figures:data},null,2)],{type:"application/json"}),`pokemon-cloud-${new Date().toISOString().slice(0,10)}.json`); }
  async function globalSignOut() { const client=OnlineArchive.getClient?.(); if (client && confirm("모든 기기에서 로그아웃할까요?")) await client.auth.signOut({scope:"global"}); }
  async function deleteCloudData() { const client=OnlineArchive.getClient?.(), user=OnlineArchive.getUser?.(); if (!client||!user||!confirm("클라우드의 공개 피규어 기록과 썸네일을 모두 삭제할까요? 로컬 도감은 유지됩니다.")) return; OnlineArchive.setStatus?.("클라우드 기록을 삭제하는 중","working"); const { data:files } = await client.storage.from("figure-thumbs").list(user.id,{limit:1000}); if (files?.length) await client.storage.from("figure-thumbs").remove(files.map(file => `${user.id}/${file.name}`)); const { error } = await client.from("public_figures").delete().eq("user_id",user.id); if (error) return OnlineArchive.setStatus?.(error.message,"error"); localStorage.setItem(DIRTY_KEY,"true"); OnlineArchive.setStatus?.("클라우드 공개 기록을 삭제했습니다.","success"); refreshSyncCenter(); refreshNavigationState(); }

  function roundRect(ctx,x,y,width,height,radius) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x,y,width,height,radius); else ctx.rect(x,y,width,height); }
  function downloadBlob(blob,name) { const url=URL.createObjectURL(blob), a=document.createElement("a"); a.href=url; a.download=name; a.click(); setTimeout(() => URL.revokeObjectURL(url),1500); }
  function formatDateTime(value) { const date=new Date(value); return Number.isNaN(date.getTime())?"-":date.toLocaleString("ko-KR",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}); }
  function escapeHtml(value="") { return String(value).replace(/[&<>'"]/g,char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]); }

  return { init };
})();

window.addEventListener("DOMContentLoaded", () => setTimeout(ArchiveEnhancements.init,0));
