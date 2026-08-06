"use strict";

const OnlineArchive = (() => {
  let client = null;
  let user = null;
  let profile = null;
  const config = window.SUPABASE_CONFIG || {};
  const $id = id => document.getElementById(id);

  function configured() {
    return Boolean(config.url && config.anonKey && !config.url.includes("YOUR_"));
  }

  async function init() {
    injectUI();
    bind();
    if (!configured()) {
      setStatus("Supabase 설정이 필요합니다.", "warning");
      return;
    }
    client = window.supabase.createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const { data } = await client.auth.getSession();
    await handleSession(data.session);
    client.auth.onAuthStateChange((_event, session) => setTimeout(() => handleSession(session), 0));
  }

  function injectUI() {
    const menu = document.querySelector(".settings-list");
    if (menu) {
      const button = document.createElement("button");
      button.id = "onlineButton";
      button.className = "settings-item";
      button.innerHTML = '<span>온라인·친구 기능</span><small id="onlineMenuStatus">로그인 및 도감 비교</small>';
      menu.prepend(button);
    }
    document.body.insertAdjacentHTML("beforeend", `
      <dialog id="onlineDialog" class="sheet-dialog online-dialog">
        <div class="sheet-handle"></div>
        <header class="dialog-header"><div><p class="eyebrow">ONLINE BETA</p><h2>클라우드와 친구</h2></div><button class="icon-button" id="closeOnlineDialog">×</button></header>
        <section id="onlineSetupNotice" class="online-notice" hidden><strong>Supabase 연결 전</strong><p><code>supabase-config.js</code>에 프로젝트 URL과 anon key를 입력하세요.</p></section>
        <section id="authPanel" class="online-card">
          <h3>로그인</h3>
          <label>이메일<input id="onlineEmail" type="email" autocomplete="email" placeholder="name@example.com"></label>
          <label>비밀번호<input id="onlinePassword" type="password" autocomplete="current-password" minlength="6" placeholder="6자 이상"></label>
          <div class="online-actions"><button id="signInButton" class="primary-button">로그인</button><button id="signUpButton" class="secondary-button">회원가입</button></div>
          <p class="online-help">회원가입 뒤 이메일 확인이 켜져 있으면 인증 메일을 확인해야 합니다.</p>
        </section>
        <section id="accountPanel" hidden>
          <div class="online-card profile-card">
            <div><p class="eyebrow">MY PROFILE</p><h3 id="onlineNickname">-</h3><p id="onlineFriendCode" class="friend-code">-</p></div>
            <button id="signOutButton" class="secondary-button">로그아웃</button>
          </div>
          <div id="onlineStatus" class="sync-status">연결됨</div>
          <div class="online-grid-actions">
            <button id="uploadCloudButton" class="primary-button">내 도감 업로드</button>
            <button id="downloadCloudButton" class="secondary-button">클라우드 기록 받기</button>
          </div>
          <p class="online-help">업로드 시 공개용 썸네일과 피규어 정보만 서버에 저장됩니다. 가격·구입처·보관 위치·메모는 업로드하지 않습니다.</p>
          <div class="online-card">
            <h3>프로필 설정</h3>
            <label>닉네임<input id="nicknameInput" maxlength="20" placeholder="수집가 이름"></label>
            <label class="toggle-row"><span>친구에게 사진 공개</span><input id="sharePhotosInput" type="checkbox" checked></label>
            <button id="saveProfileButton" class="secondary-button">프로필 저장</button>
          </div>
          <div class="online-card">
            <h3>친구 추가</h3>
            <div class="inline-form"><input id="friendCodeInput" maxlength="12" placeholder="예: PFG-AB12CD"><button id="sendFriendButton" class="secondary-button">요청</button></div>
          </div>
          <div class="online-card"><div class="section-heading"><h3>받은 요청</h3><button id="refreshFriendsButton" class="text-button">새로고침</button></div><div id="friendRequests" class="friend-list"></div></div>
          <div class="online-card"><h3>친구 목록</h3><div id="friendList" class="friend-list"></div></div>
          <div id="comparePanel" class="online-card" hidden>
            <div class="section-heading"><div><p class="eyebrow">COMPARE</p><h3 id="compareFriendName">친구 비교</h3></div><button id="closeCompareButton" class="text-button">닫기</button></div>
            <div id="compareSummary" class="compare-summary"></div>
            <div class="compare-tabs"><button data-compare="mine" class="active">나만 보유</button><button data-compare="friend">친구만 보유</button><button data-compare="both">공통 보유</button></div>
            <div id="compareList" class="compare-list"></div>
          </div>
        </section>
      </dialog>`);
  }

  function bind() {
    $id("onlineButton")?.addEventListener("click", () => { $id("settingsDialog")?.close(); $id("onlineDialog").showModal(); });
    $id("closeOnlineDialog")?.addEventListener("click", () => $id("onlineDialog").close());
    $id("onlineDialog")?.addEventListener("click", e => { if (e.target === $id("onlineDialog")) $id("onlineDialog").close(); });
    $id("signInButton")?.addEventListener("click", signIn);
    $id("signUpButton")?.addEventListener("click", signUp);
    $id("signOutButton")?.addEventListener("click", () => client?.auth.signOut());
    $id("saveProfileButton")?.addEventListener("click", saveProfile);
    $id("uploadCloudButton")?.addEventListener("click", uploadCollection);
    $id("downloadCloudButton")?.addEventListener("click", downloadCollection);
    $id("sendFriendButton")?.addEventListener("click", sendFriendRequest);
    $id("refreshFriendsButton")?.addEventListener("click", loadFriends);
    $id("closeCompareButton")?.addEventListener("click", () => { $id("comparePanel").hidden = true; });
    document.querySelectorAll("[data-compare]").forEach(b => b.addEventListener("click", () => renderCompareList(b.dataset.compare)));
    if (!configured()) $id("onlineSetupNotice").hidden = false;
  }

  async function handleSession(session) {
    user = session?.user || null;
    $id("authPanel").hidden = Boolean(user);
    $id("accountPanel").hidden = !user;
    const menuStatus = $id("onlineMenuStatus");
    if (!user) { if (menuStatus) menuStatus.textContent = configured() ? "로그인이 필요합니다" : "Supabase 설정 필요"; return; }
    if (menuStatus) menuStatus.textContent = user.email;
    await ensureProfile();
    await loadFriends();
  }

  async function signIn() {
    if (!client) return setStatus("Supabase 설정이 필요합니다.", "error");
    const email = $id("onlineEmail").value.trim();
    const password = $id("onlinePassword").value;
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) setStatus(error.message, "error");
  }

  async function signUp() {
    if (!client) return setStatus("Supabase 설정이 필요합니다.", "error");
    const email = $id("onlineEmail").value.trim();
    const password = $id("onlinePassword").value;
    const { error } = await client.auth.signUp({ email, password });
    setStatus(error ? error.message : "회원가입 요청을 보냈습니다. 이메일 인증 설정을 확인하세요.", error ? "error" : "success");
  }

  async function ensureProfile() {
    let { data, error } = await client.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (error) return setStatus(error.message, "error");
    if (!data) {
      const nickname = (user.email || "collector").split("@")[0].slice(0, 20);
      const { data: created, error: createError } = await client.from("profiles").insert({ id: user.id, nickname }).select().single();
      if (createError) return setStatus(createError.message, "error");
      data = created;
    }
    profile = data;
    $id("onlineNickname").textContent = profile.nickname;
    $id("onlineFriendCode").textContent = profile.friend_code;
    $id("nicknameInput").value = profile.nickname || "";
    $id("sharePhotosInput").checked = profile.share_photos !== false;
  }

  async function saveProfile() {
    const patch = { nickname: $id("nicknameInput").value.trim().slice(0,20), share_photos: $id("sharePhotosInput").checked, updated_at: new Date().toISOString() };
    const { data, error } = await client.from("profiles").update(patch).eq("id", user.id).select().single();
    if (error) return setStatus(error.message, "error");
    profile = data; $id("onlineNickname").textContent = data.nickname; setStatus("프로필을 저장했습니다.", "success");
  }

  function publicFigureRow(figure, thumbPath) {
    return {
      id: figure.id, user_id: user.id, species_id: figure.speciesId, species_name: figure.speciesName,
      form_key: figure.formKey || "default", form_name: figure.form || "기본 모습",
      figure_name: figure.figureName || "", maker: figure.maker || "", series: figure.series || "",
      product_code: figure.productCode || "", condition: figure.condition || "", purchase_date: figure.purchaseDate || null,
      thumb_path: thumbPath || null, created_at: figure.createdAt, updated_at: figure.updatedAt || new Date().toISOString()
    };
  }

  async function uploadCollection() {
    if (!user) return;
    const btn = $id("uploadCloudButton"); btn.disabled = true;
    try {
      setStatus(`0 / ${state.figures.length} 업로드 중`, "working");
      const rows = [];
      for (let i=0;i<state.figures.length;i++) {
        const figure = state.figures[i];
        let thumbPath = null;
        if (profile.share_photos && figure.thumbBlob) {
          const ext = figure.thumbBlob.type.includes("png") ? "png" : figure.thumbBlob.type.includes("jpeg") ? "jpg" : "webp";
          thumbPath = `${user.id}/${figure.id}.${ext}`;
          const { error } = await client.storage.from("figure-thumbs").upload(thumbPath, figure.thumbBlob, { upsert: true, contentType: figure.thumbBlob.type, cacheControl: "3600" });
          if (error) throw error;
        }
        rows.push(publicFigureRow(figure, thumbPath));
        if ((i+1)%10===0 || i===state.figures.length-1) setStatus(`${i+1} / ${state.figures.length} 업로드 중`, "working");
      }
      if (rows.length) {
        const { error } = await client.from("public_figures").upsert(rows, { onConflict: "id" });
        if (error) throw error;
      }
      const localIds = state.figures.map(f=>f.id);
      const { data: remote } = await client.from("public_figures").select("id").eq("user_id", user.id);
      const stale = (remote || []).map(r=>r.id).filter(id=>!localIds.includes(id));
      if (stale.length) await client.from("public_figures").delete().in("id", stale);
      setStatus(`동기화 완료 · ${rows.length}개`, "success");
    } catch (e) { console.error(e); setStatus(`업로드 실패: ${e.message}`, "error"); }
    finally { btn.disabled = false; }
  }

  async function downloadCollection() {
    if (!confirm("클라우드의 공개 기록을 현재 기기에 합칠까요? 사진은 공개 썸네일 품질로 내려받습니다.")) return;
    const { data, error } = await client.from("public_figures").select("*").eq("user_id", user.id);
    if (error) return setStatus(error.message, "error");
    let count = 0;
    for (const row of data || []) {
      if (state.figures.some(f=>f.id===row.id)) continue;
      let blob = null;
      if (row.thumb_path) {
        const result = await client.storage.from("figure-thumbs").download(row.thumb_path);
        if (!result.error) blob = result.data;
      }
      const figure = { id: row.id, speciesId: row.species_id, speciesName: row.species_name, speciesSlug: "", figureName: row.figure_name,
        form: row.form_name, formKey: row.form_key, formImageUrl:"", formIsOfficial:false, maker:row.maker, series:row.series,
        productCode:row.product_code, source:"", price:null, currency:"KRW", purchaseDate:row.purchase_date || "", condition:row.condition || "",
        location:"", notes:"", fullBlob:blob, thumbBlob:blob, createdAt:row.created_at, updatedAt:row.updated_at };
      await FigureDB.putFigure(figure); state.figures.push(figure); count++;
    }
    if (count) { indexFigures(); populateCollectionControls(); renderAll(); }
    setStatus(`${count}개 기록을 추가했습니다.`, "success");
  }

  async function sendFriendRequest() {
    const code = $id("friendCodeInput").value.trim().toUpperCase();
    if (!code || code === profile.friend_code) return setStatus("다른 사용자의 친구 코드를 입력하세요.", "error");
    const { data: target, error } = await client.from("profiles").select("id,nickname").eq("friend_code", code).maybeSingle();
    if (error || !target) return setStatus("해당 친구 코드를 찾지 못했습니다.", "error");
    const { error: reqError } = await client.from("friendships").insert({ requester_id:user.id, addressee_id:target.id });
    setStatus(reqError ? reqError.message : `${target.nickname}님에게 요청했습니다.`, reqError ? "error" : "success");
    loadFriends();
  }

  async function loadFriends() {
    if (!user) return;
    const { data, error } = await client.rpc("get_my_friend_overview");
    if (error) return setStatus(error.message, "error");
    const incoming = (data || []).filter(x=>x.direction==="incoming" && x.status==="pending");
    const accepted = (data || []).filter(x=>x.status==="accepted");
    $id("friendRequests").innerHTML = incoming.length ? incoming.map(friendRowRequest).join("") : '<p class="empty-inline">받은 요청이 없습니다.</p>';
    $id("friendList").innerHTML = accepted.length ? accepted.map(friendRowAccepted).join("") : '<p class="empty-inline">아직 친구가 없습니다.</p>';
    document.querySelectorAll("[data-accept]").forEach(b=>b.addEventListener("click",()=>respondFriend(b.dataset.accept,"accepted")));
    document.querySelectorAll("[data-reject]").forEach(b=>b.addEventListener("click",()=>respondFriend(b.dataset.reject,"rejected")));
    document.querySelectorAll("[data-compare-friend]").forEach(b=>b.addEventListener("click",()=>openCompare(b.dataset.compareFriend,b.dataset.name)));
  }

  const friendRowRequest = f => `<div class="friend-row"><div><strong>${escapeHtml(f.nickname)}</strong><small>${f.friend_code}</small></div><div><button data-accept="${f.friendship_id}" class="mini-button">수락</button><button data-reject="${f.friendship_id}" class="mini-button danger">거절</button></div></div>`;
  const friendRowAccepted = f => `<div class="friend-row"><div><strong>${escapeHtml(f.nickname)}</strong><small>${f.figure_count}개 · ${f.species_count}종</small></div><button data-compare-friend="${f.friend_id}" data-name="${escapeHtml(f.nickname)}" class="mini-button">비교</button></div>`;

  async function respondFriend(id,status) { const { error } = await client.from("friendships").update({status,responded_at:new Date().toISOString()}).eq("id",id); if(error)setStatus(error.message,"error"); else loadFriends(); }

  let compareData = null;
  async function openCompare(friendId, name) {
    const { data, error } = await client.rpc("compare_collections", { other_user: friendId });
    if (error) return setStatus(error.message,"error");
    compareData = data || [];
    $id("compareFriendName").textContent = `${name}님과 비교`;
    const mine = compareData.filter(x=>x.mine && !x.theirs).length, theirs=compareData.filter(x=>!x.mine&&x.theirs).length, both=compareData.filter(x=>x.mine&&x.theirs).length;
    $id("compareSummary").innerHTML = `<div><strong>${mine}</strong><span>나만 보유</span></div><div><strong>${theirs}</strong><span>친구만 보유</span></div><div><strong>${both}</strong><span>공통 보유</span></div>`;
    $id("comparePanel").hidden=false; renderCompareList("mine"); $id("comparePanel").scrollIntoView({behavior:"smooth"});
  }

  function renderCompareList(mode) {
    document.querySelectorAll("[data-compare]").forEach(b=>b.classList.toggle("active",b.dataset.compare===mode));
    if(!compareData)return;
    const rows=compareData.filter(x=>mode==="mine"?x.mine&&!x.theirs:mode==="friend"?!x.mine&&x.theirs:x.mine&&x.theirs);
    $id("compareList").innerHTML=rows.length?rows.map(x=>`<div class="compare-item"><img src="${ARTWORK_BASE}/${x.species_id}.png" alt=""><div><strong>${String(x.species_id).padStart(4,"0")} ${escapeHtml(x.species_name)}</strong><small>${x.mine_count||0}개 / ${x.their_count||0}개</small></div></div>`).join(""):'<p class="empty-inline">해당 포켓몬이 없습니다.</p>';
  }

  function setStatus(text, kind="") { const el=$id("onlineStatus"); if(el){el.textContent=text;el.dataset.kind=kind;} else console.log(text); }
  function escapeHtml(value="") { return String(value).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }
  return { init, uploadCollection };
})();

window.addEventListener("DOMContentLoaded", () => OnlineArchive.init());
