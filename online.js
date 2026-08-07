"use strict";

const OnlineArchive = (() => {
  let client = null;
  let user = null;
  let profile = null;
  let compareData = null;
  const config = window.SUPABASE_CONFIG || {};
  const $id = id => document.getElementById(id);

  function configured() {
    return Boolean(config.url && config.anonKey && !config.url.includes("YOUR_"));
  }

  async function init() {
    injectUI();
    bind();
    if (!configured()) {
      $id("onlineSetupNotice").hidden = false;
      setStatus("Supabase 설정이 필요합니다.", "warning");
      return;
    }

    client = window.supabase.createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    const { data } = await client.auth.getSession();
    await handleSession(data.session);
    client.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => handleSession(session), 0);
    });
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
        <header class="dialog-header">
          <div><p class="eyebrow">ONLINE BETA</p><h2>클라우드와 친구</h2></div>
          <button class="icon-button" id="closeOnlineDialog" aria-label="닫기">×</button>
        </header>

        <section id="onlineSetupNotice" class="online-notice" hidden>
          <strong>Supabase 연결 전</strong>
          <p><code>supabase-config.js</code>에 프로젝트 URL과 Publishable key를 입력하세요.</p>
        </section>

        <section id="authPanel" class="online-card auth-card">
          <h3>로그인</h3>
          <label>이메일<input id="onlineEmail" type="email" autocomplete="email" placeholder="name@example.com"></label>
          <label>비밀번호<input id="onlinePassword" type="password" autocomplete="current-password" minlength="6" placeholder="6자 이상"></label>
          <div class="online-actions">
            <button id="signInButton" class="primary-button">로그인</button>
            <button id="signUpButton" class="secondary-button">회원가입</button>
          </div>
          <p class="online-help">이메일 확인 기능을 켰다면 가입 뒤 인증 메일을 확인해야 합니다.</p>
        </section>

        <section id="accountPanel" hidden>
          <div class="online-card online-profile-card">
            <div class="profile-identity">
              <div id="onlineAvatar" class="profile-avatar" aria-hidden="true">?</div>
              <div class="profile-text">
                <p class="eyebrow">MY PROFILE</p>
                <h3 id="onlineNickname">프로필 불러오는 중</h3>
                <button id="copyFriendCodeButton" type="button" class="friend-code-button" aria-label="친구 코드 복사">
                  <span id="onlineFriendCode">-</span><em>복사</em>
                </button>
              </div>
            </div>
            <button id="signOutButton" class="secondary-button compact-button">로그아웃</button>
          </div>

          <div id="onlineStatus" class="sync-status" role="status" aria-live="polite">연결됨</div>

          <div class="online-card sync-card">
            <div class="online-card-heading">
              <div><h3>클라우드 동기화</h3><p>공개용 기록과 작은 썸네일만 저장합니다.</p></div>
            </div>
            <div class="online-grid-actions">
              <button id="uploadCloudButton" class="primary-button">내 도감 업로드</button>
              <button id="downloadCloudButton" class="secondary-button">클라우드 기록 받기</button>
            </div>
            <p class="online-help">가격·구입처·보관 위치·개인 메모와 고화질 사진은 서버에 올리지 않습니다.</p>
          </div>

          <div class="online-card friend-connect-card">
            <div class="online-card-heading">
              <div><h3>친구 연결</h3><p>상대방의 친구 코드를 입력해 요청을 보냅니다.</p></div>
              <button id="shareFriendCodeButton" type="button" class="text-button accent">내 코드 공유</button>
            </div>
            <div class="inline-form friend-code-form">
              <input id="friendCodeInput" maxlength="12" inputmode="text" autocomplete="off" autocapitalize="characters" placeholder="예: PFG-AB12CD">
              <button id="sendFriendButton" class="secondary-button">요청 보내기</button>
            </div>
          </div>

          <div class="online-card friend-center-card">
            <div class="friend-tabs" role="tablist" aria-label="친구 메뉴">
              <button type="button" class="active" data-friend-tab="friends" role="tab" aria-selected="true">
                친구 <span id="friendCountBadge">0</span>
              </button>
              <button type="button" data-friend-tab="requests" role="tab" aria-selected="false">
                요청 <span id="friendRequestCountBadge">0</span>
              </button>
              <button id="refreshFriendsButton" type="button" class="friend-refresh-button" aria-label="친구 목록 새로고침">↻</button>
            </div>

            <div id="friendsTabPanel" class="friend-tab-panel" role="tabpanel">
              <div id="friendList" class="friend-list"></div>
            </div>

            <div id="requestsTabPanel" class="friend-tab-panel" role="tabpanel" hidden>
              <div class="friend-subsection">
                <h4>받은 요청</h4>
                <div id="friendRequests" class="friend-list"></div>
              </div>
              <div class="friend-subsection">
                <h4>보낸 요청</h4>
                <div id="sentFriendRequests" class="friend-list"></div>
              </div>
            </div>
          </div>

          <details class="online-card online-details">
            <summary>프로필 및 공개 설정</summary>
            <div class="online-details-body">
              <label>닉네임<input id="nicknameInput" maxlength="20" placeholder="수집가 이름"></label>
              <label class="toggle-row"><span>친구에게 사진 공개</span><input id="sharePhotosInput" type="checkbox" checked></label>
              <button id="saveProfileButton" class="secondary-button">프로필 저장</button>
            </div>
          </details>

          <div id="comparePanel" class="online-card compare-panel" hidden>
            <div class="online-card-heading">
              <div><p class="eyebrow">COMPARE</p><h3 id="compareFriendName">친구 비교</h3></div>
              <button id="closeCompareButton" class="text-button">닫기</button>
            </div>
            <div id="compareSummary" class="compare-summary"></div>
            <div class="compare-tabs">
              <button data-compare="mine" class="active">나만 보유</button>
              <button data-compare="friend">친구만 보유</button>
              <button data-compare="both">공통 보유</button>
            </div>
            <div id="compareList" class="compare-list"></div>
          </div>
        </section>
      </dialog>`);
  }

  function bind() {
    $id("onlineButton")?.addEventListener("click", () => {
      $id("settingsDialog")?.close();
      $id("onlineDialog").showModal();
    });
    $id("closeOnlineDialog")?.addEventListener("click", () => $id("onlineDialog").close());
    $id("onlineDialog")?.addEventListener("click", event => {
      if (event.target === $id("onlineDialog")) $id("onlineDialog").close();
    });
    $id("signInButton")?.addEventListener("click", signIn);
    $id("signUpButton")?.addEventListener("click", signUp);
    $id("signOutButton")?.addEventListener("click", () => client?.auth.signOut());
    $id("saveProfileButton")?.addEventListener("click", saveProfile);
    $id("uploadCloudButton")?.addEventListener("click", uploadCollection);
    $id("downloadCloudButton")?.addEventListener("click", downloadCollection);
    $id("sendFriendButton")?.addEventListener("click", sendFriendRequest);
    $id("refreshFriendsButton")?.addEventListener("click", loadFriends);
    $id("copyFriendCodeButton")?.addEventListener("click", copyFriendCode);
    $id("shareFriendCodeButton")?.addEventListener("click", shareFriendCode);
    $id("friendCodeInput")?.addEventListener("input", event => {
      event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "");
    });
    $id("friendCodeInput")?.addEventListener("keydown", event => {
      if (event.key === "Enter") sendFriendRequest();
    });
    $id("closeCompareButton")?.addEventListener("click", () => {
      $id("comparePanel").hidden = true;
    });
    document.querySelectorAll("[data-compare]").forEach(button => {
      button.addEventListener("click", () => renderCompareList(button.dataset.compare));
    });
    document.querySelectorAll("[data-friend-tab]").forEach(button => {
      button.addEventListener("click", () => selectFriendTab(button.dataset.friendTab));
    });
  }

  async function handleSession(session) {
    user = session?.user || null;
    profile = null;
    $id("authPanel").hidden = Boolean(user);
    $id("accountPanel").hidden = !user;
    const menuStatus = $id("onlineMenuStatus");

    if (!user) {
      if (menuStatus) menuStatus.textContent = configured() ? "로그인이 필요합니다" : "Supabase 설정 필요";
      return;
    }

    if (menuStatus) menuStatus.textContent = user.email;
    setStatus("프로필을 확인하는 중", "working");
    const ready = await ensureProfile();
    if (ready) {
      setStatus("클라우드 연결됨", "success");
      await loadFriends();
    }
  }

  async function signIn() {
    if (!client) return setStatus("Supabase 설정이 필요합니다.", "error");
    const email = $id("onlineEmail").value.trim();
    const password = $id("onlinePassword").value;
    if (!email || !password) return setStatus("이메일과 비밀번호를 입력하세요.", "error");
    setStatus("로그인 중", "working");
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) setStatus(readableError(error), "error");
  }

  async function signUp() {
    if (!client) return setStatus("Supabase 설정이 필요합니다.", "error");
    const email = $id("onlineEmail").value.trim();
    const password = $id("onlinePassword").value;
    if (!email || password.length < 6) return setStatus("이메일과 6자 이상의 비밀번호를 입력하세요.", "error");
    setStatus("회원가입 처리 중", "working");
    const { error } = await client.auth.signUp({ email, password });
    setStatus(error ? readableError(error) : "회원가입 완료. 이메일 인증 설정을 확인하세요.", error ? "error" : "success");
  }

  async function ensureProfile() {
    if (!client || !user) return false;
    let { data, error } = await client.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (error) {
      setStatus(`프로필 불러오기 실패: ${readableError(error)}`, "error");
      return false;
    }

    if (!data) {
      const nickname = (user.email || "collector").split("@")[0].slice(0, 20);
      const result = await client.from("profiles").insert({ id: user.id, nickname }).select().single();
      if (result.error) {
        setStatus(`프로필 생성 실패: ${readableError(result.error)}`, "error");
        return false;
      }
      data = result.data;
    }

    profile = data;
    renderProfile();
    return true;
  }

  function renderProfile() {
    if (!profile) return;
    const nickname = profile.nickname || "수집가";
    $id("onlineNickname").textContent = nickname;
    $id("onlineFriendCode").textContent = profile.friend_code || "코드 생성 중";
    $id("onlineAvatar").textContent = nickname.trim().charAt(0).toUpperCase() || "?";
    $id("nicknameInput").value = nickname;
    $id("sharePhotosInput").checked = profile.share_photos !== false;
    $id("copyFriendCodeButton").disabled = !profile.friend_code;
    $id("shareFriendCodeButton").disabled = !profile.friend_code;
  }

  async function requireProfile() {
    if (!user) throw new Error("로그인이 필요합니다.");
    if (!profile) await ensureProfile();
    if (!profile) throw new Error("프로필을 불러오지 못했습니다. 로그아웃 후 다시 로그인해 보세요.");
    return profile;
  }

  async function saveProfile() {
    try {
      await requireProfile();
      const nickname = $id("nicknameInput").value.trim().slice(0, 20);
      if (!nickname) return setStatus("닉네임을 입력하세요.", "error");
      const patch = {
        nickname,
        share_photos: $id("sharePhotosInput").checked,
        updated_at: new Date().toISOString()
      };
      const { data, error } = await client.from("profiles").update(patch).eq("id", user.id).select().single();
      if (error) throw error;
      profile = data;
      renderProfile();
      setStatus("프로필을 저장했습니다.", "success");
    } catch (error) {
      setStatus(readableError(error), "error");
    }
  }

  async function copyFriendCode() {
    try {
      const current = await requireProfile();
      if (!current.friend_code) throw new Error("친구 코드가 아직 생성되지 않았습니다.");
      await copyText(current.friend_code);
      const button = $id("copyFriendCodeButton");
      const label = button.querySelector("em");
      if (label) label.textContent = "복사됨";
      setStatus("친구 코드를 복사했습니다.", "success");
      setTimeout(() => { if (label) label.textContent = "복사"; }, 1400);
    } catch (error) {
      setStatus(readableError(error), "error");
    }
  }

  async function shareFriendCode() {
    try {
      const current = await requireProfile();
      if (!current.friend_code) throw new Error("친구 코드가 아직 생성되지 않았습니다.");
      const text = `포켓몬 피규어 도감 친구 코드: ${current.friend_code}`;
      if (navigator.share) {
        await navigator.share({ title: "포켓몬 피규어 도감 친구 코드", text });
      } else {
        await copyText(current.friend_code);
        setStatus("공유 기능을 지원하지 않아 친구 코드를 복사했습니다.", "success");
      }
    } catch (error) {
      if (error?.name !== "AbortError") setStatus(readableError(error), "error");
    }
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    if (!copied) throw new Error("복사하지 못했습니다.");
  }

  function publicFigureRow(figure, thumbPath) {
    return {
      id: figure.id,
      user_id: user.id,
      species_id: figure.speciesId,
      species_name: figure.speciesName,
      form_key: figure.formKey || "default",
      form_name: figure.form || "기본 모습",
      figure_name: figure.figureName || "",
      maker: figure.maker || "",
      series: figure.series || "",
      product_code: figure.productCode || "",
      condition: figure.condition || "",
      purchase_date: figure.purchaseDate || null,
      thumb_path: thumbPath || null,
      created_at: figure.createdAt,
      updated_at: figure.updatedAt || new Date().toISOString()
    };
  }

  async function uploadCollection() {
    if (!user) return setStatus("로그인이 필요합니다.", "error");
    const button = $id("uploadCloudButton");
    button.disabled = true;
    try {
      const currentProfile = await requireProfile();
      const total = state.figures.length;
      setStatus(total ? `0 / ${total} 업로드 중` : "빈 도감을 동기화하는 중", "working");
      const rows = [];

      for (let index = 0; index < total; index++) {
        const figure = state.figures[index];
        let thumbPath = null;
        if (currentProfile.share_photos && figure.thumbBlob) {
          const ext = figure.thumbBlob.type.includes("png") ? "png" : figure.thumbBlob.type.includes("jpeg") ? "jpg" : "webp";
          thumbPath = `${user.id}/${figure.id}.${ext}`;
          const { error } = await client.storage.from("figure-thumbs").upload(thumbPath, figure.thumbBlob, {
            upsert: true,
            contentType: figure.thumbBlob.type,
            cacheControl: "3600"
          });
          if (error) throw error;
        }
        rows.push(publicFigureRow(figure, thumbPath));
        if ((index + 1) % 10 === 0 || index === total - 1) {
          setStatus(`${index + 1} / ${total} 업로드 중`, "working");
        }
      }

      if (rows.length) {
        const { error } = await client.from("public_figures").upsert(rows, { onConflict: "id" });
        if (error) throw error;
      }

      const localIds = state.figures.map(figure => figure.id);
      const { data: remote, error: remoteError } = await client.from("public_figures").select("id").eq("user_id", user.id);
      if (remoteError) throw remoteError;
      const stale = (remote || []).map(row => row.id).filter(id => !localIds.includes(id));
      if (stale.length) {
        const { error } = await client.from("public_figures").delete().in("id", stale);
        if (error) throw error;
      }

      setStatus(`동기화 완료 · ${rows.length}개`, "success");
      await loadFriends();
    } catch (error) {
      console.error(error);
      setStatus(`업로드 실패: ${readableError(error)}`, "error");
    } finally {
      button.disabled = false;
    }
  }

  async function downloadCollection() {
    if (!user) return setStatus("로그인이 필요합니다.", "error");
    if (!confirm("클라우드의 공개 기록을 현재 기기에 합칠까요? 사진은 공개 썸네일 품질로 내려받습니다.")) return;
    setStatus("클라우드 기록을 확인하는 중", "working");
    const { data, error } = await client.from("public_figures").select("*").eq("user_id", user.id);
    if (error) return setStatus(readableError(error), "error");

    let count = 0;
    for (const row of data || []) {
      if (state.figures.some(figure => figure.id === row.id)) continue;
      let blob = null;
      if (row.thumb_path) {
        const result = await client.storage.from("figure-thumbs").download(row.thumb_path);
        if (!result.error) blob = result.data;
      }
      const figure = {
        id: row.id,
        speciesId: row.species_id,
        speciesName: row.species_name,
        speciesSlug: "",
        figureName: row.figure_name,
        form: row.form_name,
        formKey: row.form_key,
        formImageUrl: "",
        formIsOfficial: false,
        maker: row.maker,
        series: row.series,
        productCode: row.product_code,
        source: "",
        price: null,
        currency: "KRW",
        purchaseDate: row.purchase_date || "",
        condition: row.condition || "",
        location: "",
        notes: "",
        fullBlob: blob,
        thumbBlob: blob,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
      await FigureDB.putFigure(figure);
      state.figures.push(figure);
      count++;
    }

    if (count) {
      indexFigures();
      populateCollectionControls();
      renderAll();
    }
    setStatus(`${count}개 기록을 추가했습니다.`, "success");
  }

  async function sendFriendRequest() {
    try {
      const currentProfile = await requireProfile();
      const input = $id("friendCodeInput");
      const code = input.value.trim().toUpperCase();
      if (!code || code === currentProfile.friend_code) throw new Error("다른 사용자의 친구 코드를 입력하세요.");

      setStatus("친구 코드를 확인하는 중", "working");
      const { data: target, error } = await client.from("profiles").select("id,nickname").eq("friend_code", code).maybeSingle();
      if (error || !target) throw new Error("해당 친구 코드를 찾지 못했습니다.");

      const { error: requestError } = await client.from("friendships").insert({
        requester_id: user.id,
        addressee_id: target.id
      });
      if (requestError) throw requestError;

      input.value = "";
      setStatus(`${target.nickname}님에게 친구 요청을 보냈습니다.`, "success");
      selectFriendTab("requests");
      await loadFriends();
    } catch (error) {
      const message = /duplicate key|friendships_unique_pair/i.test(error?.message || "")
        ? "이미 친구이거나 요청을 보낸 사용자입니다."
        : readableError(error);
      setStatus(message, "error");
    }
  }

  async function loadFriends() {
    if (!user) return;
    const refresh = $id("refreshFriendsButton");
    refresh?.classList.add("spinning");
    const { data, error } = await client.rpc("get_my_friend_overview");
    refresh?.classList.remove("spinning");
    if (error) return setStatus(readableError(error), "error");

    const rows = data || [];
    const incoming = rows.filter(row => row.direction === "incoming" && row.status === "pending");
    const outgoing = rows.filter(row => row.direction === "outgoing" && row.status === "pending");
    const accepted = rows.filter(row => row.status === "accepted");

    $id("friendCountBadge").textContent = accepted.length;
    $id("friendRequestCountBadge").textContent = incoming.length + outgoing.length;
    $id("friendRequests").innerHTML = incoming.length
      ? incoming.map(friendRowRequest).join("")
      : '<p class="empty-inline">받은 요청이 없습니다.</p>';
    $id("sentFriendRequests").innerHTML = outgoing.length
      ? outgoing.map(friendRowOutgoing).join("")
      : '<p class="empty-inline">보낸 요청이 없습니다.</p>';
    $id("friendList").innerHTML = accepted.length
      ? accepted.map(friendRowAccepted).join("")
      : '<div class="empty-friend-state"><span>◇</span><strong>아직 친구가 없습니다</strong><p>친구 코드를 공유하거나 위에서 코드를 입력하세요.</p></div>';

    document.querySelectorAll("[data-accept]").forEach(button => {
      button.addEventListener("click", () => respondFriend(button.dataset.accept, "accepted"));
    });
    document.querySelectorAll("[data-reject]").forEach(button => {
      button.addEventListener("click", () => respondFriend(button.dataset.reject, "rejected"));
    });
    document.querySelectorAll("[data-compare-friend]").forEach(button => {
      button.addEventListener("click", () => openCompare(button.dataset.compareFriend, button.dataset.name));
    });
  }

  function friendAvatar(name = "?") {
    return escapeHtml(name.trim().charAt(0).toUpperCase() || "?");
  }

  const friendRowRequest = friend => `
    <div class="friend-row request-row">
      <div class="friend-avatar">${friendAvatar(friend.nickname)}</div>
      <div class="friend-main">
        <strong>${escapeHtml(friend.nickname)}</strong>
        <small>${escapeHtml(friend.friend_code)}</small>
      </div>
      <div class="friend-row-actions">
        <button data-accept="${friend.friendship_id}" class="mini-button positive">수락</button>
        <button data-reject="${friend.friendship_id}" class="mini-button danger">거절</button>
      </div>
    </div>`;

  const friendRowOutgoing = friend => `
    <div class="friend-row waiting-row">
      <div class="friend-avatar muted-avatar">${friendAvatar(friend.nickname)}</div>
      <div class="friend-main">
        <strong>${escapeHtml(friend.nickname)}</strong>
        <small>${escapeHtml(friend.friend_code)}</small>
      </div>
      <span class="pending-badge">수락 대기</span>
    </div>`;

  const friendRowAccepted = friend => `
    <div class="friend-row accepted-row">
      <div class="friend-avatar">${friendAvatar(friend.nickname)}</div>
      <div class="friend-main">
        <strong>${escapeHtml(friend.nickname)}</strong>
        <div class="friend-stat-line"><span>${Number(friend.figure_count || 0)}개</span><span>${Number(friend.species_count || 0)}종</span></div>
      </div>
      <button data-compare-friend="${friend.friend_id}" data-name="${escapeHtml(friend.nickname)}" class="mini-button compare-button">도감 비교</button>
    </div>`;

  async function respondFriend(id, status) {
    const { error } = await client.from("friendships").update({
      status,
      responded_at: new Date().toISOString()
    }).eq("id", id);
    if (error) setStatus(readableError(error), "error");
    else {
      setStatus(status === "accepted" ? "친구 요청을 수락했습니다." : "친구 요청을 거절했습니다.", "success");
      await loadFriends();
    }
  }

  function selectFriendTab(tab) {
    document.querySelectorAll("[data-friend-tab]").forEach(button => {
      const active = button.dataset.friendTab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    $id("friendsTabPanel").hidden = tab !== "friends";
    $id("requestsTabPanel").hidden = tab !== "requests";
  }

  async function openCompare(friendId, name) {
    setStatus(`${name}님의 도감을 비교하는 중`, "working");
    const { data, error } = await client.rpc("compare_collections", { other_user: friendId });
    if (error) return setStatus(readableError(error), "error");

    compareData = data || [];
    $id("compareFriendName").textContent = `${name}님과 비교`;
    const mine = compareData.filter(row => row.mine && !row.theirs).length;
    const theirs = compareData.filter(row => !row.mine && row.theirs).length;
    const both = compareData.filter(row => row.mine && row.theirs).length;
    $id("compareSummary").innerHTML = `
      <div><strong>${mine}</strong><span>나만 보유</span></div>
      <div><strong>${theirs}</strong><span>친구만 보유</span></div>
      <div><strong>${both}</strong><span>공통 보유</span></div>`;
    $id("comparePanel").hidden = false;
    renderCompareList("mine");
    setStatus("도감 비교를 불러왔습니다.", "success");
    $id("comparePanel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderCompareList(mode) {
    document.querySelectorAll("[data-compare]").forEach(button => {
      button.classList.toggle("active", button.dataset.compare === mode);
    });
    if (!compareData) return;
    const rows = compareData.filter(row => mode === "mine"
      ? row.mine && !row.theirs
      : mode === "friend"
        ? !row.mine && row.theirs
        : row.mine && row.theirs);
    $id("compareList").innerHTML = rows.length
      ? rows.map(row => `
        <div class="compare-item">
          <img src="${ARTWORK_BASE}/${row.species_id}.png" alt="">
          <div><strong>${String(row.species_id).padStart(4, "0")} ${escapeHtml(row.species_name)}</strong><small>나 ${row.mine_count || 0}개 · 친구 ${row.their_count || 0}개</small></div>
        </div>`).join("")
      : '<p class="empty-inline">해당 포켓몬이 없습니다.</p>';
  }

  function setStatus(text, kind = "") {
    const element = $id("onlineStatus");
    if (element) {
      element.textContent = text;
      element.dataset.kind = kind;
    } else {
      console.log(text);
    }
  }

  function readableError(error) {
    const message = typeof error === "string" ? error : error?.message || "처리 중 오류가 발생했습니다.";
    if (/invalid login credentials/i.test(message)) return "이메일 또는 비밀번호가 맞지 않습니다.";
    if (/row-level security/i.test(message)) return "서버 접근 권한 설정을 확인해야 합니다.";
    return message;
  }

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>'"]/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    })[character]);
  }

  return { init, uploadCollection };
})();

window.addEventListener("DOMContentLoaded", () => OnlineArchive.init());
