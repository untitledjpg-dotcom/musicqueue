window.__MQ_LOADED__ = true;

document.addEventListener("DOMContentLoaded", () => {
  const SUPABASE_URL = (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_URL) || "";
  const SUPABASE_ANON_KEY = (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_ANON_KEY) || "";
  const supabase = (window.supabase && window.supabase.createClient)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

  const TABLE = "queue_items";
  const $ = (id) => document.getElementById(id);

  // --- Required DOM (hard check) ---
  const requiredIds = ["paneInput","paneQueue","addBtn","mobileViewQueueBtn","railInput","railQueue","jumpAddBtn","refreshBtn"];
  const missing = requiredIds.filter(id => !$(id));
  if (missing.length) {
    alert("UI mismatch: missing element IDs: " + missing.join(", ") +
      "\n\nThis means GitHub Pages is serving an older index.html or you edited the wrong folder (root vs /docs).");
    console.error("Missing IDs:", missing);
    return;
  }

  // DOM
  const paneInput = $("paneInput");
  const paneQueue = $("paneQueue");
  const railInput = $("railInput");
  const railQueue = $("railQueue");
  const mobileViewQueueBtn = $("mobileViewQueueBtn");
  const jumpAddBtn = $("jumpAddBtn");

  const syncDot = $("syncDot");
  const syncLabel = $("syncLabel");
  const refreshBtn = $("refreshBtn");

  const authCard = $("authCard");
  const authEmail = $("authEmail");
  const sendLinkBtn = $("sendLinkBtn");
  const signOutBtn = $("signOutBtn");
  const authStatus = $("authStatus");
  const authHint = $("authHint");

  const typeEl = $("type");
  const titleLabelEl = $("titleLabel");
  const titleEl = $("title");
  const suggestionsEl = $("suggestions");
  const trackAlbumWrap = $("trackAlbumWrap");
  const albumEl = $("album");
  const artistEl = $("artist");
  const tagsEl = $("tags");
  const qobuzUrlEl = $("qobuzUrl");
  const notesEl = $("notes");
  const addBtn = $("addBtn");
  const clearBtn = $("clearBtn");

  const queuedRailPill = $("queuedRailPill");
  const listenedRailPill = $("listenedRailPill");

  const searchEl = $("search");
  const filterStatusEl = $("filterStatus");
  const sortEl = $("sort");
  const itemsEl = $("items");

  // Helpers
  function isConfigured() {
    return !!(supabase && SUPABASE_URL && SUPABASE_ANON_KEY);
  }
  function setDot(state) {
    syncDot?.classList.remove("online","busy","err");
    if (state) syncDot?.classList.add(state);
  }
  function setBusy(v, label) {
    addBtn.disabled = v;
    refreshBtn.disabled = v;
    setDot(v ? "busy" : "online");
    syncLabel.textContent = label || (v ? "Working…" : "Ready");
  }
  function setError(label) {
    setDot("err");
    syncLabel.textContent = label || "Error";
  }
  function normalizeTags(s) {
    return (s || "").split(",").map(t => t.trim()).filter(Boolean);
  }
  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
  function qobuzSearchUrl(query) {
    const base = "https://www.qobuz.com/us-en/search";
    const q = encodeURIComponent((query || "").trim());
    return `${base}?q=${q}&i=boutique`;
  }
  function buildQueryFromFields(type, title, artist, album) {
    title = (title || "").trim();
    artist = (artist || "").trim();
    album = (album || "").trim();
    if (!title) return "";
    if (type === "Artist") return title;
    if (type === "Album") return artist ? `${title} ${artist}` : title;
    let q = title;
    if (artist) q += ` ${artist}`;
    if (album) q += ` ${album}`;
    return q;
  }

  // Tabs
  function setActive(which) {
    const isInput = which === "input";

    paneInput.classList.toggle("active", isInput);
    paneInput.classList.toggle("rail", !isInput);
    paneInput.classList.toggle("span11", isInput);
    paneInput.classList.toggle("span1", !isInput);

    paneQueue.classList.toggle("active", !isInput);
    paneQueue.classList.toggle("rail", isInput);
    paneQueue.classList.toggle("span11", !isInput);
    paneQueue.classList.toggle("span1", isInput);

    if (window.matchMedia("(max-width: 900px)").matches) {
      paneInput.style.display = isInput ? "" : "none";
      paneQueue.style.display = isInput ? "none" : "";
    } else {
      paneInput.style.display = "";
      paneQueue.style.display = "";
    }
  }

  // Form UI
  function updateTypeUI() {
    const t = typeEl.value;
    trackAlbumWrap.classList.toggle("hidden", t !== "Track");
    titleLabelEl.textContent = (t === "Artist") ? "Artist name" : (t === "Album") ? "Album title" : "Track title";
    titleEl.placeholder = (t === "Artist") ? "Start typing an artist name…" : (t === "Album") ? "Start typing an album title…" : "Start typing a track title…";
  }
  function clearForm() {
    typeEl.value = "Album";
    titleEl.value = "";
    albumEl.value = "";
    artistEl.value = "";
    tagsEl.value = "";
    qobuzUrlEl.value = "";
    notesEl.value = "";
    titleEl.dataset.mbid = "";
    titleEl.dataset.mbtype = "";
    titleEl.dataset.coverUrl = "";
    titleEl.dataset.mbReleaseId = "";
    titleEl.dataset.mbReleaseGroupId = "";
    suggestionsEl.innerHTML = "";
    updateTypeUI();
    titleEl.focus();
  }

  // MusicBrainz
  function mbTypeForCurrentSelection() {
    const t = typeEl.value;
    if (t === "Artist") return "artist";
    if (t === "Album") return "release-group";
    return "recording";
  }
  function coverUrlForReleaseGroup(mbid) {
    return mbid ? `https://coverartarchive.org/release-group/${encodeURIComponent(mbid)}/front-250` : "";
  }
  async function mbSearch(q) {
    const type = mbTypeForCurrentSelection();
    const url = `https://musicbrainz.org/ws/2/${type}?query=${encodeURIComponent(q)}&fmt=json&limit=8`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();

    if (type === "artist") {
      return (data.artists || []).map(a => ({
        id: a.id, label: a.name, subtitle: a.disambiguation || "",
        artist: a.name, album: "", coverUrl: ""
      }));
    }
    if (type === "release-group") {
      return (data["release-groups"] || []).map(g => ({
        id: g.id, label: g.title,
        subtitle: (g["first-release-date"] || "") + (g.primary_type ? ` • ${g.primary_type}` : ""),
        artist: (g["artist-credit"]?.[0]?.name) || "",
        album: g.title,
        coverUrl: coverUrlForReleaseGroup(g.id),
        mbReleaseGroupId: g.id
      }));
    }
    return (data.recordings || []).map(r => {
      const artist = (r["artist-credit"]?.[0]?.name) || "";
      const firstRelease = (r.releases && r.releases[0]) ? r.releases[0] : null;
      const rg = firstRelease?.["release-group"]?.id || "";
      const album = firstRelease?.title || "";
      return {
        id: r.id, label: r.title,
        subtitle: r.length ? `${Math.round(r.length/1000)}s` : "",
        artist, album,
        coverUrl: rg ? coverUrlForReleaseGroup(rg) : "",
        mbReleaseId: firstRelease?.id || "",
        mbReleaseGroupId: rg || ""
      };
    });
  }

  let suggestTimer = null;
  let lastKey = "";
  function applySuggestion(r) {
    const selectedType = typeEl.value;
    titleEl.value = r.label || "";

    if (selectedType === "Artist") {
      artistEl.value = r.label || "";
      albumEl.value = "";
    } else if (selectedType === "Album") {
      artistEl.value = r.artist || "";
      albumEl.value = "";
    } else {
      artistEl.value = r.artist || "";
      albumEl.value = r.album || "";
    }

    titleEl.dataset.mbid = r.id || "";
    titleEl.dataset.mbtype = mbTypeForCurrentSelection();
    titleEl.dataset.coverUrl = r.coverUrl || "";
    titleEl.dataset.mbReleaseId = r.mbReleaseId || "";
    titleEl.dataset.mbReleaseGroupId = r.mbReleaseGroupId || "";
    suggestionsEl.innerHTML = "";
  }

  function renderSuggestions(results) {
    if (!results.length) { suggestionsEl.innerHTML = ""; return; }
    suggestionsEl.innerHTML = `
      <div class="suggestWrap">
        ${results.map((r, idx) => {
          const bits = [];
          if (r.artist && typeEl.value !== "Artist") bits.push(r.artist);
          if (r.album && typeEl.value === "Track") bits.push("Album: " + r.album);
          if (r.subtitle) bits.push(r.subtitle);
          return `
            <button type="button" class="suggestBtn" data-sel="${idx}">
              <div class="suggestTitle">${escapeHtml(r.label)}</div>
              <div class="suggestSub">${escapeHtml(bits.join(" • "))}</div>
            </button>
          `;
        }).join("")}
      </div>
    `;
    suggestionsEl.querySelectorAll("[data-sel]").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.getAttribute("data-sel"));
        applySuggestion(results[idx]);
      });
    });
  }

  function setupAutocomplete() {
    titleEl.addEventListener("input", () => {
      const q = titleEl.value.trim();
      if (q.length < 2) { suggestionsEl.innerHTML = ""; return; }
      const key = mbTypeForCurrentSelection() + "::" + q.toLowerCase();
      if (key === lastKey) return;

      clearTimeout(suggestTimer);
      suggestTimer = setTimeout(async () => {
        lastKey = key;
        try {
          renderSuggestions(await mbSearch(q));
        } catch {
          suggestionsEl.innerHTML = "";
        }
      }, 300);
    });

    typeEl.addEventListener("change", () => {
      titleEl.dataset.mbid = "";
      titleEl.dataset.mbtype = "";
      titleEl.dataset.coverUrl = "";
      titleEl.dataset.mbReleaseId = "";
      titleEl.dataset.mbReleaseGroupId = "";
      suggestionsEl.innerHTML = "";
      updateTypeUI();
    });

    document.addEventListener("click", (e) => {
      if (!suggestionsEl.contains(e.target) && e.target !== titleEl) suggestionsEl.innerHTML = "";
    });
  }

  // Data
  let session = null;
  let items = [];

  function updateCounts() {
    const queued = items.filter(x => x.status === "queued").length;
    const listened = items.filter(x => x.status === "listened").length;
    queuedRailPill.textContent = `${queued} queued`;
    listenedRailPill.textContent = `${listened} listened`;
  }

  function normalizeRow(r) {
    return {
      ...r,
      qobuzUrl: r.qobuz_url || "",
      createdAt: r.created_at || "",
      listenedAt: r.listened_at || "",
      coverUrl: r.cover_url || ""
    };
  }

  async function refreshFromCloud() {
    if (!session) { render(); return; }
    setBusy(true, "Syncing…");
    try {
      const { data, error } = await supabase
        .from(TABLE).select("*").order("created_at", { ascending: false });
      if (error) throw error;
      items = (data || []).map(normalizeRow);
      updateCounts();
      render();
      setBusy(false, "Synced");
    } catch (err) {
      setError("Sync error");
      alert(err.message || String(err));
    } finally {
      setBusy(false, "Synced");
    }
  }

  async function addItem() {
    if (!session) { alert("Sign in first (email link)."); return; }
    const type = typeEl.value;
    const title = titleEl.value.trim();
    if (!title) { alert("Title is required."); titleEl.focus(); return; }

    const row = {
      user_id: session.user.id,
      status: "queued",
      type,
      title,
      artist: artistEl.value.trim() || null,
      album: (type === "Track") ? (albumEl.value.trim() || null) : null,
      tags: normalizeTags(tagsEl.value || ""),
      notes: notesEl.value.trim() || null,
      qobuz_url: qobuzUrlEl.value.trim() || null,
      mbid: titleEl.dataset.mbid || null,
      mb_type: titleEl.dataset.mbtype || null,
      cover_url: titleEl.dataset.coverUrl || null,
      mb_release_id: titleEl.dataset.mbReleaseId || null,
      mb_release_group_id: titleEl.dataset.mbReleaseGroupId || null
    };

    setBusy(true, "Adding…");
    try {
      const { error } = await supabase.from(TABLE).insert(row);
      if (error) throw error;
      clearForm();
      await refreshFromCloud();
      setActive("queue");
    } catch (err) {
      setError("Add error");
      alert(err.message || String(err));
    } finally {
      setBusy(false, "Synced");
    }
  }

  async function toggleStatus(id) {
    const it = items.find(x => x.id === id);
    if (!it) return;
    const nextStatus = it.status === "queued" ? "listened" : "queued";
    const listenedAt = nextStatus === "listened" ? new Date().toISOString() : null;

    setBusy(true, "Updating…");
    try {
      const { error } = await supabase.from(TABLE)
        .update({ status: nextStatus, listened_at: listenedAt })
        .eq("id", id);
      if (error) throw error;
      await refreshFromCloud();
    } catch (err) {
      setError("Update error");
      alert(err.message || String(err));
    } finally {
      setBusy(false, "Synced");
    }
  }

  async function removeItem(id) {
    if (!confirm("Delete this item?")) return;
    setBusy(true, "Deleting…");
    try {
      const { error } = await supabase.from(TABLE).delete().eq("id", id);
      if (error) throw error;
      await refreshFromCloud();
    } catch (err) {
      setError("Delete error");
      alert(err.message || String(err));
    } finally {
      setBusy(false, "Synced");
    }
  }

  async function editNotes(id) {
    const it = items.find(x => x.id === id);
    if (!it) return;
    const updated = prompt("Edit notes:", it.notes || "");
    if (updated === null) return;

    setBusy(true, "Saving…");
    try {
      const { error } = await supabase.from(TABLE)
        .update({ notes: updated.trim() || null })
        .eq("id", id);
      if (error) throw error;
      await refreshFromCloud();
    } catch (err) {
      setError("Save error");
      alert(err.message || String(err));
    } finally {
      setBusy(false, "Synced");
    }
  }

  function openQobuzForItem(it) {
    const query = buildQueryFromFields(it.type, it.title, it.artist, it.album);
    const url = it.qobuzUrl?.trim() ? it.qobuzUrl.trim() : qobuzSearchUrl(query);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function render() {
    if (!itemsEl) return;

    if (!session) {
      itemsEl.innerHTML = `<div class="empty">Sign in to view your queue.</div>`;
      return;
    }

    const q = (searchEl?.value || "").trim().toLowerCase();
    const filter = filterStatusEl?.value || "queued";
    const sort = sortEl?.value || "newest";

    let view = [...items];
    if (filter !== "all") view = view.filter(it => it.status === filter);
    if (q) {
      view = view.filter(it => {
        const hay = [it.type,it.title,it.artist,it.album,(it.tags||[]).join(" "),it.notes||""].join(" ").toLowerCase();
        return hay.includes(q);
      });
    }
    if (sort === "newest") view.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
    if (sort === "oldest") view.sort((a,b)=>String(a.createdAt||"").localeCompare(String(b.createdAt||"")));
    if (sort === "type") view.sort((a,b)=>String(a.type||"").localeCompare(String(b.type||"")) || String(a.title||"").localeCompare(String(b.title||"")));
    if (sort === "title") view.sort((a,b)=>String(a.title||"").localeCompare(String(b.title||"")));

    if (!view.length) {
      itemsEl.innerHTML = `<div class="empty">No items found.</div>`;
      return;
    }

    itemsEl.innerHTML = "";
    for (const it of view) {
      const created = it.createdAt ? new Date(it.createdAt).toLocaleString() : "";

      const cover = it.coverUrl
        ? `<img src="${escapeHtml(it.coverUrl)}" class="coverWide" alt=""
              onerror="this.outerHTML='<div class=&quot;coverWide&quot;></div>'">`
        : `<div class="coverWide"></div>`;

      const el = document.createElement("div");
      el.className = "item";
      el.innerHTML = `
        <div class="itemRow">
          <div class="itemLeft">
            ${cover}
            <button class="btnPrimary w100" data-open="${it.id}">Open in Qobuz</button>
          </div>
          <div style="flex:1;min-width:240px;">
            <div class="metaRow">
              <span class="pill">${escapeHtml(it.type||"")}</span>
              <span class="pill">${it.status === "queued" ? "Queued" : "Listened"}</span>
              <span style="margin-left:auto;color:rgba(255,255,255,.45);font-size:12px;">Added: ${escapeHtml(created)}</span>
            </div>
            <div class="title">${escapeHtml(it.title||"")}</div>
            ${it.type !== "Artist" && it.artist ? `<div class="artist">${escapeHtml(it.artist)}</div>` : ""}
            ${it.type === "Track" && it.album ? `<div class="albumLine">Album: ${escapeHtml(it.album)}</div>` : ""}
            ${it.notes ? `<div class="notes">${escapeHtml(it.notes)}</div>` : ""}
            ${(it.tags||[]).length ? `<div class="tags">${(it.tags||[]).map(t=>`<span class="pill">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
          </div>
        </div>
        <div class="actions">
          <button class="btnGhost" data-toggle="${it.id}">${it.status === "queued" ? "Mark listened" : "Back to queue"}</button>
          <button class="btnGhost" data-notes="${it.id}">Edit notes</button>
          <button class="btnGhost" data-del="${it.id}">Delete</button>
        </div>
      `;

      el.querySelector("[data-open]")?.addEventListener("click", () => openQobuzForItem(it));
      el.querySelector("[data-toggle]")?.addEventListener("click", () => toggleStatus(it.id));
      el.querySelector("[data-del]")?.addEventListener("click", () => removeItem(it.id));
      el.querySelector("[data-notes]")?.addEventListener("click", () => editNotes(it.id));

      itemsEl.appendChild(el);
    }
  }

  // Auth UI
  function setAuthUiSignedOut() {
    if (authCard) authCard.style.display = "";
    if (signOutBtn) signOutBtn.style.display = "none";
    if (authStatus) authStatus.textContent = "Sign in to sync across devices.";
    if (authHint) authHint.textContent = "";
    syncLabel.textContent = "Signed out";
    setDot("");
  }

  function setAuthUiSignedIn(email) {
    if (authCard) authCard.style.display = "none";
    if (signOutBtn) signOutBtn.style.display = "";
    syncLabel.textContent = "Synced";
    setDot("online");
    if (authStatus) authStatus.textContent = `Signed in as ${email}`;
  }

  async function sendMagicLink() {
    if (!isConfigured()) {
      alert("Missing Supabase config in config.js (SUPABASE_URL + SUPABASE_ANON_KEY).");
      return;
    }
    const email = (authEmail?.value || "").trim();
    if (!email) { alert("Enter your email."); authEmail?.focus(); return; }

    setBusy(true, "Sending link…");
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + window.location.pathname }
      });
      if (error) throw error;
      if (authHint) authHint.textContent = "Check your email for the sign-in link (open in the same browser).";
    } catch (err) {
      setError("Auth error");
      alert(err.message || String(err));
    } finally {
      setBusy(false, session ? "Synced" : "Signed out");
    }
  }

  async function doSignOut() {
    if (!supabase) return;
    setBusy(true, "Signing out…");
    await supabase.auth.signOut();
    session = null;
    items = [];
    updateCounts();
    render();
    setAuthUiSignedOut();
    setBusy(false, "Signed out");
  }

  // Wire events (THIS is what was missing when things “don’t click”)
  railInput.addEventListener("click", (e) => { e.stopPropagation(); setActive("input"); });
  railQueue.addEventListener("click", (e) => { e.stopPropagation(); setActive("queue"); });
  mobileViewQueueBtn.addEventListener("click", (e) => { e.stopPropagation(); setActive("queue"); });
  jumpAddBtn.addEventListener("click", (e) => { e.stopPropagation(); setActive("input"); });

  paneInput.addEventListener("click", () => { if (paneInput.classList.contains("rail")) setActive("input"); });
  paneQueue.addEventListener("click", () => { if (paneQueue.classList.contains("rail")) setActive("queue"); });

  typeEl.addEventListener("change", updateTypeUI);
  addBtn.addEventListener("click", addItem);
  clearBtn.addEventListener("click", clearForm);
  refreshBtn.addEventListener("click", refreshFromCloud);

  searchEl?.addEventListener("input", render);
  filterStatusEl?.addEventListener("change", render);
  sortEl?.addEventListener("change", render);

  sendLinkBtn?.addEventListener("click", sendMagicLink);
  signOutBtn?.addEventListener("click", doSignOut);

  window.addEventListener("resize", () => {
    const inputIsActive = paneInput.classList.contains("active");
    setActive(inputIsActive ? "input" : "queue");
  });

  // Boot
  updateTypeUI();
  setupAutocomplete();
  setActive("input");

  if (!isConfigured()) {
    setError("Missing Supabase config");
    setAuthUiSignedOut();
    render();
    return;
  }

  (async () => {
    const { data } = await supabase.auth.getSession();
    session = data.session || null;

    if (session?.user?.email) {
      setAuthUiSignedIn(session.user.email);
      await refreshFromCloud();
    } else {
      setAuthUiSignedOut();
      render();
    }

    supabase.auth.onAuthStateChange(async (_event, newSession) => {
      session = newSession;
      if (session?.user?.email) {
        setAuthUiSignedIn(session.user.email);
        await refreshFromCloud();
      } else {
        items = [];
        updateCounts();
        render();
        setAuthUiSignedOut();
      }
    });
  })();
});
