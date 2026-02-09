(() => {
  /******************************************************************
   * CONFIG + SUPABASE
   ******************************************************************/
  const SUPABASE_URL = (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_URL) || ""; // L6
  const SUPABASE_ANON_KEY = (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_ANON_KEY) || ""; // L7
  const supabase = (window.supabase && window.supabase.createClient)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null; // L10

  const TABLE = "queue_items"; // L12
  const $ = (id) => document.getElementById(id); // L13

  function escapeHtml(str) { // L15
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeTags(s) { // L24
    return (s || "").split(",").map(t => t.trim()).filter(Boolean);
  }

  function qobuzSearchUrl(query) { // L28
    const base = "https://www.qobuz.com/us-en/search";
    const q = encodeURIComponent((query || "").trim());
    return `${base}?q=${q}&i=boutique`;
  }

  function buildQueryFromFields(type, title, artist, album) { // L33
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

  function isConfigured() { // L46
    return !!(supabase && SUPABASE_URL && SUPABASE_ANON_KEY);
  }

  /******************************************************************
   * DOM
   ******************************************************************/
  const paneInput = $("paneInput"); // L55
  const paneQueue = $("paneQueue"); // L56
  const railInput = $("railInput"); // L57
  const railQueue = $("railQueue"); // L58
  const mobileViewQueueBtn = $("mobileViewQueueBtn"); // L59
  const jumpAddBtn = $("jumpAddBtn"); // L60

  const queuedRailPill = $("queuedRailPill"); // L62
  const listenedRailPill = $("listenedRailPill"); // L63

  const syncDot = $("syncDot"); // L65
  const syncLabel = $("syncLabel"); // L66
  const refreshBtn = $("refreshBtn"); // L67

  const authCard = $("authCard"); // L69
  const authEmail = $("authEmail"); // L70
  const sendLinkBtn = $("sendLinkBtn"); // L71
  const signOutBtn = $("signOutBtn"); // L72
  const authStatus = $("authStatus"); // L73
  const authHint = $("authHint"); // L74

  const typeEl = $("type"); // L76
  const titleLabelEl = $("titleLabel"); // L77
  const titleEl = $("title"); // L78
  const suggestionsEl = $("suggestions"); // L79
  const trackAlbumWrap = $("trackAlbumWrap"); // L80
  const albumEl = $("album"); // L81
  const artistEl = $("artist"); // L82
  const tagsEl = $("tags"); // L83
  const qobuzUrlEl = $("qobuzUrl"); // L84
  const notesEl = $("notes"); // L85
  const addBtn = $("addBtn"); // L86
  const clearBtn = $("clearBtn"); // L87

  const searchEl = $("search"); // L89
  const filterStatusEl = $("filterStatus"); // L90
  const sortEl = $("sort"); // L91
  const itemsEl = $("items"); // L92

  /******************************************************************
   * Status dot helpers
   ******************************************************************/
  function setDot(state) { // L97
    syncDot?.classList.remove("online", "busy", "err");
    if (state) syncDot?.classList.add(state);
  }

  function setBusy(v, label) { // L102
    addBtn && (addBtn.disabled = v);
    refreshBtn && (refreshBtn.disabled = v);
    setDot(v ? "busy" : "online");
    syncLabel && (syncLabel.textContent = label || (v ? "Working…" : "Ready"));
  }

  function setError(label) { // L110
    setDot("err");
    syncLabel && (syncLabel.textContent = label || "Error");
  }

  /******************************************************************
   * Tab behavior (12-col)
   ******************************************************************/
  function setActive(which) { // L118
    const isInput = which === "input";

    paneInput.classList.toggle("active", isInput);
    paneInput.classList.toggle("rail", !isInput);
    paneInput.classList.toggle("span11", isInput);
    paneInput.classList.toggle("span1", !isInput);

    paneQueue.classList.toggle("active", !isInput);
    paneQueue.classList.toggle("rail", isInput);
    paneQueue.classList.toggle("span11", !isInput);
    paneQueue.classList.toggle("span1", isInput);

    // Mobile: show only one pane
    if (window.matchMedia("(max-width: 900px)").matches) { // L134
      paneInput.style.display = isInput ? "" : "none";
      paneQueue.style.display = isInput ? "none" : "";
    } else {
      paneInput.style.display = "";
      paneQueue.style.display = "";
    }

    if (isInput) setTimeout(() => titleEl?.focus(), 120);
    else setTimeout(() => searchEl?.focus(), 120);
  }

  function makePaneExpandable(paneEl, which) { // L150
    paneEl?.addEventListener("click", () => {
      if (!paneEl.classList.contains("rail")) return;
      setActive(which);
    });
  }

  /******************************************************************
   * Auth (Magic Link)
   ******************************************************************/
  let session = null; // L160
  let items = []; // L161

  function setAuthUiSignedOut() { // L163
    authCard && (authCard.style.display = "");
    signOutBtn && (signOutBtn.style.display = "none");
    authStatus && (authStatus.textContent = "Sign in to sync across devices.");
    authHint && (authHint.textContent = "");
    syncLabel && (syncLabel.textContent = "Signed out");
    setDot("");
  }

  function setAuthUiSignedIn(email) { // L173
    authCard && (authCard.style.display = "none"); // hide account strip when signed in
    signOutBtn && (signOutBtn.style.display = "");
    authStatus && (authStatus.textContent = `Signed in as ${email}`);
    authHint && (authHint.textContent = "");
    syncLabel && (syncLabel.textContent = "Synced");
    setDot("online");
  }

  async function sendMagicLink() { // L184
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
        options: {
          emailRedirectTo: window.location.origin + window.location.pathname
        }
      });
      if (error) throw error;

      authHint && (authHint.textContent =
        "Check your email for the sign-in link. Open it in the same browser to complete sign-in.");
    } catch (err) {
      setError("Auth error");
      alert(err.message || String(err));
    } finally {
      setBusy(false, session ? "Synced" : "Signed out");
    }
  }

  async function signOut() { // L212
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

  /******************************************************************
   * Supabase CRUD
   ******************************************************************/
  function normalizeRow(r) { // L229
    return {
      ...r,
      qobuzUrl: r.qobuz_url || "",
      createdAt: r.created_at || "",
      listenedAt: r.listened_at || "",
      coverUrl: r.cover_url || "",
      mbType: r.mb_type || "",
      mbReleaseId: r.mb_release_id || "",
      mbReleaseGroupId: r.mb_release_group_id || ""
    };
  }

  async function refreshFromCloud() { // L243
    if (!session) { render(); return; }
    setBusy(true, "Syncing…");
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select("*")
        .order("created_at", { ascending: false });
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

  async function addItem() { // L266
    if (!session) { alert("Sign in first (email link)."); return; }

    const type = typeEl?.value || "Album";
    const title = (titleEl?.value || "").trim();
    if (!title) { alert("Title is required."); titleEl?.focus(); return; }

    const row = {
      user_id: session.user.id,
      status: "queued",
      type,
      title,
      artist: (artistEl?.value || "").trim() || null,
      album: (type === "Track") ? ((albumEl?.value || "").trim() || null) : null,
      tags: normalizeTags(tagsEl?.value || ""),
      notes: (notesEl?.value || "").trim() || null,
      qobuz_url: (qobuzUrlEl?.value || "").trim() || null,
      mbid: titleEl?.dataset.mbid || null,
      mb_type: titleEl?.dataset.mbtype || null,
      cover_url: titleEl?.dataset.coverUrl || null,
      mb_release_id: titleEl?.dataset.mbReleaseId || null,
      mb_release_group_id: titleEl?.dataset.mbReleaseGroupId || null
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

  async function toggleStatus(id) { // L315
    if (!session) return;
    const it = items.find(x => x.id === id);
    if (!it) return;

    const nextStatus = (it.status === "queued") ? "listened" : "queued";
    const listenedAt = (nextStatus === "listened") ? new Date().toISOString() : null;

    setBusy(true, "Updating…");
    try {
      const { error } = await supabase
        .from(TABLE)
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

  async function removeItem(id) { // L343
    if (!session) return;
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

  async function editNotes(id) { // L368
    if (!session) return;
    const it = items.find(x => x.id === id);
    if (!it) return;

    const updated = prompt("Edit notes:", it.notes || "");
    if (updated === null) return;

    setBusy(true, "Saving…");
    try {
      const { error } = await supabase
        .from(TABLE)
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

  /******************************************************************
   * Form UI
   ******************************************************************/
  function updateCounts() { // L402
    const queued = items.filter(x => x.status === "queued").length;
    const listened = items.filter(x => x.status === "listened").length;
    queuedRailPill && (queuedRailPill.textContent = `${queued} queued`);
    listenedRailPill && (listenedRailPill.textContent = `${listened} listened`);
  }

  function updateTypeUI() { // L410
    const t = typeEl?.value || "Album";
    trackAlbumWrap && trackAlbumWrap.classList.toggle("hidden", t !== "Track");

    if (titleLabelEl) {
      titleLabelEl.textContent =
        (t === "Artist") ? "Artist name" :
        (t === "Album") ? "Album title" :
                          "Track title";
    }

    if (titleEl) {
      titleEl.placeholder =
        (t === "Artist") ? "Start typing an artist name…" :
        (t === "Album") ? "Start typing an album title…" :
                          "Start typing a track title…";
    }
  }

  function clearForm() { // L432
    typeEl && (typeEl.value = "Album");
    titleEl && (titleEl.value = "");
    albumEl && (albumEl.value = "");
    artistEl && (artistEl.value = "");
    tagsEl && (tagsEl.value = "");
    qobuzUrlEl && (qobuzUrlEl.value = "");
    notesEl && (notesEl.value = "");

    if (titleEl) {
      titleEl.dataset.mbid = "";
      titleEl.dataset.mbtype = "";
      titleEl.dataset.coverUrl = "";
      titleEl.dataset.mbReleaseId = "";
      titleEl.dataset.mbReleaseGroupId = "";
    }

    suggestionsEl && (suggestionsEl.innerHTML = "");
    updateTypeUI();
    titleEl?.focus();
  }

  /******************************************************************
   * MusicBrainz autocomplete + cover
   ******************************************************************/
  function mbTypeForCurrentSelection() { // L460
    const t = typeEl?.value || "Album";
    if (t === "Artist") return "artist";
    if (t === "Album") return "release-group";
    return "recording";
  }

  function coverUrlForReleaseGroup(mbid) { // L467
    return mbid ? `https://coverartarchive.org/release-group/${encodeURIComponent(mbid)}/front-250` : "";
  }

  async function mbSearch(q) { // L471
    const type = mbTypeForCurrentSelection();
    const url = `https://musicbrainz.org/ws/2/${type}?query=${encodeURIComponent(q)}&fmt=json&limit=8`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return [];
    const data = await res.json();

    if (type === "artist") {
      const arr = data.artists || [];
      return arr.map(a => ({
        id: a.id,
        label: a.name,
        subtitle: a.disambiguation || "",
        artist: a.name,
        album: "",
        coverUrl: ""
      }));
    }

    if (type === "release-group") {
      const arr = data["release-groups"] || [];
      return arr.map(g => ({
        id: g.id,
        label: g.title,
        subtitle: (g["first-release-date"] || "") + (g.primary_type ? ` • ${g.primary_type}` : ""),
        artist: (g["artist-credit"]?.[0]?.name) || "",
        album: g.title,
        coverUrl: coverUrlForReleaseGroup(g.id),
        mbReleaseGroupId: g.id
      }));
    }

    // recording (track)
    const arr = data.recordings || [];
    return arr.map(r => {
      const artist = (r["artist-credit"]?.[0]?.name) || "";
      const firstRelease = (r.releases && r.releases[0]) ? r.releases[0] : null;
      const rg = firstRelease?.["release-group"]?.id || "";
      const album = firstRelease?.title || "";
      return {
        id: r.id,
        label: r.title,
        subtitle: r.length ? `${Math.round(r.length / 1000)}s` : "",
        artist,
        album,
        coverUrl: rg ? coverUrlForReleaseGroup(rg) : "",
        mbReleaseId: firstRelease?.id || "",
        mbReleaseGroupId: rg || ""
      };
    });
  }

  let suggestTimer = null; // L540
  let lastSuggestKey = ""; // L541

  function applySuggestion(r) { // L543
    const selectedType = typeEl?.value || "Album";

    titleEl && (titleEl.value = r.label || "");
    if (selectedType === "Artist") {
      artistEl && (artistEl.value = r.label || "");
      albumEl && (albumEl.value = "");
    } else if (selectedType === "Album") {
      artistEl && (artistEl.value = r.artist || "");
      albumEl && (albumEl.value = "");
    } else {
      // Track
      artistEl && (artistEl.value = r.artist || "");
      albumEl && (albumEl.value = r.album || "");
    }

    if (titleEl) {
      titleEl.dataset.mbid = r.id || "";
      titleEl.dataset.mbtype = mbTypeForCurrentSelection();
      titleEl.dataset.coverUrl = r.coverUrl || "";
      titleEl.dataset.mbReleaseId = r.mbReleaseId || "";
      titleEl.dataset.mbReleaseGroupId = r.mbReleaseGroupId || "";
    }

    suggestionsEl && (suggestionsEl.innerHTML = "");
  }

  function renderSuggestions(results) { // L579
    if (!suggestionsEl) return;
    if (!results || !results.length) { suggestionsEl.innerHTML = ""; return; }

    suggestionsEl.innerHTML = `
      <div class="suggestWrap" role="listbox" aria-label="Suggestions">
        ${results.map((r, idx) => {
          const bits = [];
          if (r.artist && (typeEl?.value !== "Artist")) bits.push(r.artist);
          if (r.album && (typeEl?.value === "Track")) bits.push("Album: " + (r.album || ""));
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
        const r = results[idx];
        if (r) applySuggestion(r);
      });
    });
  }

  function setupAutocomplete() { // L623
    if (!titleEl) return;

    titleEl.addEventListener("input", () => {
      const q = titleEl.value.trim();
      if (q.length < 2) { suggestionsEl && (suggestionsEl.innerHTML = ""); return; }

      const key = mbTypeForCurrentSelection() + "::" + q.toLowerCase();
      if (key === lastSuggestKey) return;

      clearTimeout(suggestTimer);
      suggestTimer = setTimeout(async () => {
        lastSuggestKey = key;
        try {
          const results = await mbSearch(q);
          renderSuggestions(results);
        } catch {
          suggestionsEl && (suggestionsEl.innerHTML = "");
        }
      }, 300);
    });

    typeEl?.addEventListener("change", () => {
      suggestionsEl && (suggestionsEl.innerHTML = "");
      if (titleEl) {
        titleEl.dataset.mbid = "";
        titleEl.dataset.mbtype = "";
        titleEl.dataset.coverUrl = "";
        titleEl.dataset.mbReleaseId = "";
        titleEl.dataset.mbReleaseGroupId = "";
      }
      updateTypeUI();
    });

    document.addEventListener("click", (e) => {
      if (!suggestionsEl) return;
      if (!suggestionsEl.contains(e.target) && e.target !== titleEl) {
        suggestionsEl.innerHTML = "";
      }
    });
  }

  /******************************************************************
   * Render queue
   ******************************************************************/
  function openQobuzForItem(it) { // L682
    const query = buildQueryFromFields(it.type || "Album", it.title || "", it.artist || "", it.album || "");
    const url = (it.qobuzUrl && String(it.qobuzUrl).trim())
      ? String(it.qobuzUrl).trim()
      : qobuzSearchUrl(query);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function render() { // L692
    if (!itemsEl) return;

    const q = (searchEl?.value || "").trim().toLowerCase();
    const filterStatus = filterStatusEl?.value || "queued";
    const sort = sortEl?.value || "newest";

    let view = [...items];

    if (!session) {
      itemsEl.innerHTML = `<div class="empty">Sign in to view your queue.</div>`;
      return;
    }

    if (filterStatus !== "all") view = view.filter(it => it.status === filterStatus);

    if (q) {
      view = view.filter(it => {
        const hay = [
          it.type, it.title, it.artist, it.album,
          (it.tags || []).join(" "),
          it.notes || ""
        ].join(" ").toLowerCase();
        return hay.includes(q);
      });
    }

    if (sort === "newest") view.sort((a,b) => String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
    if (sort === "oldest") view.sort((a,b) => String(a.createdAt||"").localeCompare(String(b.createdAt||"")));
    if (sort === "type") view.sort((a,b) => String(a.type||"").localeCompare(String(b.type||"")) || String(a.title||"").localeCompare(String(b.title||"")));
    if (sort === "title") view.sort((a,b) => String(a.title||"").localeCompare(String(b.title||"")));

    itemsEl.innerHTML = "";

    if (!view.length) {
      itemsEl.innerHTML = `<div class="empty">No items found.</div>`;
      return;
    }

    for (const it of view) {
      const created = it.createdAt ? new Date(it.createdAt).toLocaleString() : "";
      const tagPills = (it.tags || []).map(t => `<span class="pill">${escapeHtml(t)}</span>`).join("");

      const artistLine = (it.type !== "Artist" && it.artist)
        ? `<div class="artist">${escapeHtml(it.artist)}</div>` : "";

      const albumLine = (it.type === "Track" && it.album)
        ? `<div class="albumLine">Album: ${escapeHtml(it.album)}</div>` : "";

      const cover = it.coverUrl
        ? `<img src="${escapeHtml(it.coverUrl)}" alt="" class="coverWide"
              onerror="this.outerHTML='<div class=&quot;coverWide&quot;></div>'">`
        : `<div class="coverWide"></div>`;

      const el = document.createElement("div");
      el.className = "item";
      el.innerHTML = `
        <div class="itemRow">
          <div class="itemLeft">
            ${cover}
            <button type="button" class="btnPrimary w100" data-open="${it.id}">Open in Qobuz</button>
          </div>

          <div style="flex:1;min-width:240px;">
            <div class="metaRow">
              <span class="pill">${escapeHtml(it.type || "")}</span>
              <span class="pill">${it.status === "queued" ? "Queued" : "Listened"}</span>
              ${it.qobuzUrl ? `<span class="pill">Direct URL</span>` : ""}
              ${it.mbid ? `<span class="pill">MB</span>` : ""}
              <span style="margin-left:auto;color:var(--muted2);font-size:12px;">Added: ${escapeHtml(created)}</span>
            </div>

            <div class="title">${escapeHtml(it.title || "")}</div>
            ${artistLine}
            ${albumLine}
            ${it.notes ? `<div class="notes">${escapeHtml(it.notes)}</div>` : ""}
            ${tagPills ? `<div class="tags">${tagPills}</div>` : ""}
          </div>
        </div>

        <div class="actions">
          <button type="button" class="btnGhost" data-toggle="${it.id}">
            ${it.status === "queued" ? "Mark listened" : "Back to queue"}
          </button>
          <button type="button" class="btnGhost" data-notes="${it.id}">Edit notes</button>
          <button type="button" class="btnGhost" data-del="${it.id}">Delete</button>
        </div>
      `;

      el.querySelector("[data-open]")?.addEventListener("click", () => openQobuzForItem(it));
      el.querySelector("[data-toggle]")?.addEventListener("click", () => toggleStatus(it.id));
      el.querySelector("[data-del]")?.addEventListener("click", () => removeItem(it.id));
      el.querySelector("[data-notes]")?.addEventListener("click", () => editNotes(it.id));

      itemsEl.appendChild(el);
    }
  }

  /******************************************************************
   * Events
   ******************************************************************/
  railInput?.addEventListener("click", () => setActive("input")); // L835
  railQueue?.addEventListener("click", () => setActive("queue")); // L836
  mobileViewQueueBtn?.addEventListener("click", () => setActive("queue")); // L837
  jumpAddBtn?.addEventListener("click", () => setActive("input")); // L838

  makePaneExpandable(paneInput, "input"); // L840
  makePaneExpandable(paneQueue, "queue"); // L841

  typeEl?.addEventListener("change", updateTypeUI); // L843
  addBtn?.addEventListener("click", addItem); // L844
  clearBtn?.addEventListener("click", clearForm); // L845
  refreshBtn?.addEventListener("click", refreshFromCloud); // L846

  searchEl?.addEventListener("input", render); // L848
  filterStatusEl?.addEventListener("change", render); // L849
  sortEl?.addEventListener("change", render); // L850

  sendLinkBtn?.addEventListener("click", sendMagicLink); // L852
  signOutBtn?.addEventListener("click", signOut); // L853

  window.addEventListener("resize", () => { // L855
    const inputIsActive = paneInput?.classList.contains("active");
    setActive(inputIsActive ? "input" : "queue");
  });

  /******************************************************************
   * Boot
   ******************************************************************/
  updateTypeUI(); // L865
  setupAutocomplete(); // L866
  setActive("input"); // L867

  if (!isConfigured()) { // L869
    setError("Missing Supabase config");
    setAuthUiSignedOut();
    render();
    return;
  }

  (async () => { // L876
    const { data } = await supabase.auth.getSession();
    session = data.session || null;

    if (session?.user?.email) {
      setAuthUiSignedIn(session.user.email);
      await refreshFromCloud();
    } else {
      setAuthUiSignedOut();
      render();
    }

    supabase.auth.onAuthStateChange(async (_event, newSession) => { // L889
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
})();
