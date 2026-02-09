// app.js
(() => {
  /******************************************************************
   * CONFIG + SUPABASE CLIENT
   ******************************************************************/
  const SUPABASE_URL = (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_URL) || ""; // L7
  const SUPABASE_ANON_KEY = (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_ANON_KEY) || ""; // L8
  const supabase = (window.supabase && window.supabase.createClient)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null; // L11

  const TABLE = "queue_items"; // L13

  /******************************************************************
   * HELPERS
   ******************************************************************/
  const $ = (id) => document.getElementById(id); // L19
  function escapeHtml(str) { // L20
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
  function normalizeTags(s) { // L28
    return (s || "").split(",").map(t => t.trim()).filter(Boolean);
  }
  function qobuzSearchUrl(query) { // L31
    const base = "https://www.qobuz.com/us-en/search";
    const q = encodeURIComponent((query || "").trim());
    return `${base}?q=${q}&i=boutique`;
  }
  function buildQueryFromFields(type, title, artist, album) { // L36
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

  function isConfigured() { // L50
    return !!(supabase && SUPABASE_URL && SUPABASE_ANON_KEY);
  }

  /******************************************************************
   * DOM REFS
   ******************************************************************/
  const paneInput = $("paneInput"); // L58
  const paneQueue = $("paneQueue"); // L59
  const railInput = $("railInput"); // L60
  const railQueue = $("railQueue"); // L61
  const mobileViewQueueBtn = $("mobileViewQueueBtn"); // L62
  const jumpAddBtn = $("jumpAddBtn"); // L63

  const queuedRailPill = $("queuedRailPill"); // L65
  const listenedRailPill = $("listenedRailPill"); // L66

  const syncDot = $("syncDot"); // L68
  const syncLabel = $("syncLabel"); // L69
  const refreshBtn = $("refreshBtn"); // L70

  // Auth
  const authEmail = $("authEmail"); // L73
  const sendLinkBtn = $("sendLinkBtn"); // L74
  const signOutBtn = $("signOutBtn"); // L75
  const authStatus = $("authStatus"); // L76
  const authHint = $("authHint"); // L77

  // Form
  const typeEl = $("type"); // L80
  const titleLabelEl = $("titleLabel"); // L81
  const titleEl = $("title"); // L82
  const trackAlbumWrap = $("trackAlbumWrap"); // L83
  const albumEl = $("album"); // L84
  const artistEl = $("artist"); // L85
  const tagsEl = $("tags"); // L86
  const qobuzUrlEl = $("qobuzUrl"); // L87
  const notesEl = $("notes"); // L88
  const suggestionsEl = $("suggestions"); // L89

  const addBtn = $("addBtn"); // L91
  const clearBtn = $("clearBtn"); // L92
  const exportBtn = $("exportBtn"); // L93
  const importBtn = $("importBtn"); // L94
  const importFile = $("importFile"); // L95

  // Queue tools
  const searchEl = $("search"); // L98
  const filterStatusEl = $("filterStatus"); // L99
  const sortEl = $("sort"); // L100
  const itemsEl = $("items"); // L101

  /******************************************************************
   * TAB / PANE BEHAVIOR
   ******************************************************************/
  function setActive(which) { // L107
    const isInput = (which === "input");

    paneInput.classList.toggle("active", isInput);
    paneInput.classList.toggle("rail", !isInput);
    paneInput.classList.toggle("span11", isInput);
    paneInput.classList.toggle("span1", !isInput);

    paneQueue.classList.toggle("active", !isInput);
    paneQueue.classList.toggle("rail", isInput);
    paneQueue.classList.toggle("span11", !isInput);
    paneQueue.classList.toggle("span1", isInput);

    if (window.matchMedia("(max-width: 900px)").matches) { // L123
      paneInput.style.display = isInput ? "" : "none";
      paneQueue.style.display = isInput ? "none" : "";
    } else {
      paneInput.style.display = "";
      paneQueue.style.display = "";
    }

    if (isInput) setTimeout(() => titleEl?.focus(), 120);
    else setTimeout(() => searchEl?.focus(), 120);
  }

  function makePaneExpandable(paneEl, which) { // L137
    paneEl?.addEventListener("click", (e) => {
      if (!paneEl.classList.contains("rail")) return;
      const t = e.target;
      if (t && t.closest && t.closest("a, input, textarea, select")) return;
      setActive(which);
    });
  }

  /******************************************************************
   * STATUS DOT
   ******************************************************************/
  function setDot(state) { // L149
    syncDot?.classList.remove("online", "busy", "err");
    if (state) syncDot?.classList.add(state);
  }
  function setBusy(v, label) { // L154
    addBtn && (addBtn.disabled = v);
    refreshBtn && (refreshBtn.disabled = v);
    setDot(v ? "busy" : "online");
    syncLabel && (syncLabel.textContent = label || (v ? "Working…" : "Ready"));
  }
  function setError(label) { // L161
    setDot("err");
    syncLabel && (syncLabel.textContent = label || "Error");
  }

  /******************************************************************
   * AUTH (MAGIC LINK)
   ******************************************************************/
  let session = null; // L170

  function setAuthUiSignedOut() { // L172
    authStatus && (authStatus.textContent = "Sign in to sync across devices.");
    authHint && (authHint.textContent = "");
    signOutBtn && (signOutBtn.style.display = "none");
    syncLabel && (syncLabel.textContent = "Signed out");
    setDot("");
  }

  function setAuthUiSignedIn(email) { // L180
    authStatus && (authStatus.textContent = `Signed in as ${email}`);
    authHint && (authHint.textContent = "");
    signOutBtn && (signOutBtn.style.display = "");
    syncLabel && (syncLabel.textContent = "Synced");
    setDot("online");
  }

  async function sendMagicLink() { // L189
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
          emailRedirectTo: window.location.origin + window.location.pathname // L204
        }
      });
      if (error) throw error;

      authHint && (authHint.textContent =
        "Check your email for the sign-in link. Open it on this same device/browser to complete sign-in.");
    } catch (err) {
      alert(err.message || String(err));
      setError("Auth error");
    } finally {
      setBusy(false, session ? "Synced" : "Signed out");
    }
  }

  async function signOut() { // L219
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
   * DATA (SUPABASE CRUD)
   ******************************************************************/
  let items = []; // L236

  function updateCounts() { // L238
    const queued = items.filter(x => x.status === "queued").length;
    const listened = items.filter(x => x.status === "listened").length;
    queuedRailPill && (queuedRailPill.textContent = `${queued} queued`);
    listenedRailPill && (listenedRailPill.textContent = `${listened} listened`);
  }

  async function refreshFromCloud() { // L246
    if (!session) return;
    setBusy(true, "Syncing…");
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      items = (data || []).map(r => ({
        ...r,
        // Normalize names used in UI
        qobuzUrl: r.qobuz_url,
        createdAt: r.created_at,
        listenedAt: r.listened_at,
        coverUrl: r.cover_url,
        mbReleaseId: r.mb_release_id,
        mbReleaseGroupId: r.mb_release_group_id,
        mbType: r.mb_type
      }));
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

  async function addItem() { // L284
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

  async function toggleStatus(id) { // L333
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

  async function removeItem(id) { // L362
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

  async function editNotes(id) { // L385
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
   * FORM + TYPE UI
   ******************************************************************/
  function updateTypeUI() { // L418
    const t = typeEl?.value || "Album";
    trackAlbumWrap && (trackAlbumWrap.style.display = (t === "Track") ? "block" : "none");

    titleLabelEl && (titleLabelEl.textContent =
      (t === "Artist") ? "Artist name" :
      (t === "Album") ? "Album title" : "Track title");

    if (titleEl) {
      titleEl.placeholder =
        (t === "Artist") ? "Start typing an artist name…" :
        (t === "Album") ? "Start typing an album title…" :
                          "Start typing a track title…";
    }
  }

  function clearForm() { // L437
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
   * MUSICBRAINZ AUTOCOMPLETE (DIRECT)
   ******************************************************************/
  function mbTypeForCurrentSelection() { // L466
    const t = typeEl?.value || "Album";
    if (t === "Artist") return "artist";
    if (t === "Album") return "release-group";
    return "recording"; // Track
  }

  // Very lightweight “best effort” cover URLs via Cover Art Archive.
  function coverUrlForReleaseGroup(mbid) { // L475
    // 250px thumbnail; if missing, it 404s and our onerror hides it.
    return mbid ? `https://coverartarchive.org/release-group/${encodeURIComponent(mbid)}/front-250` : "";
  }

  async function mbSearch(q) { // L480
    const type = mbTypeForCurrentSelection();
    const url = `https://musicbrainz.org/ws/2/${type}?query=${encodeURIComponent(q)}&fmt=json&limit=8`;

    // NOTE: MusicBrainz prefers a proper User-Agent. Browsers can't set it.
    // In practice, light usage usually works. If you ever get rate-limited,
    // we can add a tiny serverless proxy later.
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
        coverUrl: "" // no cover for artist
      }));
    }

    if (type === "release-group") {
      const arr = data["release-groups"] || [];
      return arr.map(g => ({
        id: g.id,
        label: g.title,
        subtitle: (g["first-release-date"] || "") + (g.primary_type ? ` • ${g.primary_type}` : ""),
        artist: (g["artist-credit"]?.[0]?.name) || "",
        coverUrl: coverUrlForReleaseGroup(g.id),
        mbReleaseGroupId: g.id
      }));
    }

    // recording (track)
    const arr = data.recordings || [];
    return arr.map(r => {
      const artist = (r["artist-credit"]?.[0]?.name) || "";
      const firstRelease = r.releases && r.releases[0] ? r.releases[0] : null;
      const rg = firstRelease?.["release-group"]?.id || "";
      const album = firstRelease?.title || "";
      return {
        id: r.id,
        label: r.title,
        subtitle: (r.length ? `${Math.round(r.length/1000)}s` : "") || "",
        artist,
        album,
        coverUrl: rg ? coverUrlForReleaseGroup(rg) : "",
        mbReleaseId: firstRelease?.id || "",
        mbReleaseGroupId: rg || ""
      };
    });
  }

  let suggestTimer = null; // L551
  let lastSuggestKey = ""; // L552

  function applySuggestion(r) { // L554
    const selectedType = typeEl?.value || "Album";
    titleEl && (titleEl.value = r.label || "");
    artistEl && (artistEl.value = "");
    albumEl && (albumEl.value = "");

    if (selectedType === "Artist") {
      artistEl && (artistEl.value = r.label || "");
    }
    if (selectedType === "Album") {
      artistEl && (artistEl.value = r.artist || "");
    }
    if (selectedType === "Track") {
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

  function renderSuggestions(results) { // L586
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

  function setupAutocomplete() { // L625
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
      if (!suggestionsEl.contains(e.target) && e.target !== titleEl) suggestionsEl.innerHTML = "";
    });
  }

  /******************************************************************
   * RENDER
   ******************************************************************/
  function openQobuzForItem(it) { // L678
    const query = buildQueryFromFields(it.type || "Album", it.title || "", it.artist || "", it.album || "");
    const url = (it.qobuzUrl && String(it.qobuzUrl).trim())
      ? String(it.qobuzUrl).trim()
      : qobuzSearchUrl(query);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function render() { // L688
    if (!itemsEl) return;

    const q = (searchEl?.value || "").trim().toLowerCase();
    const filterStatus = filterStatusEl?.value || "queued";
    const sort = sortEl?.value || "newest";

    let view = [...items];

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

    if (!session) {
      itemsEl.innerHTML = `<div style="color:rgba(255,255,255,.6);font-size:13px;padding:10px 2px;">Sign in to view your queue.</div>`;
      return;
    }

    if (!view.length) {
      itemsEl.innerHTML = `<div style="color:rgba(255,255,255,.6);font-size:13px;padding:10px 2px;">No items found.</div>`;
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
        <div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap;">
          <div class="itemLeft">
            ${cover}
            <button type="button" class="btnPrimary" data-open="${it.id}">Open in Qobuz</button>
          </div>

          <div style="flex:1;min-width:240px;">
            <div class="metaRow">
              <span class="pill">${escapeHtml(it.type || "")}</span>
              <span class="pill">${it.status === "queued" ? "Queued" : "Listened"}</span>
              ${it.qobuzUrl ? `<span class="pill">Direct URL</span>` : ""}
              ${it.mbid ? `<span class="pill">MB</span>` : ""}
              <span style="margin-left:auto;color:rgba(255,255,255,.45);font-size:12px;">Added: ${escapeHtml(created)}</span>
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
   * EXPORT / IMPORT (writes into Supabase)
   ******************************************************************/
  function exportJson() { // L819
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "music-queue-export.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importJsonFile(file) { // L829
    if (!session) { alert("Sign in first."); return; }

    try {
      const text = await file.text();
      const incoming = JSON.parse(text);
      if (!Array.isArray(incoming)) throw new Error("Invalid JSON format (expected an array).");

      setBusy(true, "Importing…");

      for (const raw of incoming) {
        if (!raw || typeof raw !== "object") continue;
        const title = String(raw.title || "").trim();
        if (!title) continue;

        const row = {
          user_id: session.user.id,
          status: raw.status || "queued",
          type: raw.type || "Album",
          title,
          artist: raw.artist || null,
          album: raw.album || null,
          tags: Array.isArray(raw.tags) ? raw.tags : normalizeTags(raw.tags || ""),
          notes: raw.notes || null,
          qobuz_url: raw.qobuzUrl || raw.qobuz_url || null,
          mbid: raw.mbid || null,
          mb_type: raw.mbType || raw.mb_type || null,
          cover_url: raw.coverUrl || raw.cover_url || null,
          mb_release_id: raw.mbReleaseId || raw.mb_release_id || null,
          mb_release_group_id: raw.mbReleaseGroupId || raw.mb_release_group_id || null
        };

        const { error } = await supabase.from(TABLE).insert(row);
        if (error) throw error;
      }

      await refreshFromCloud();
      alert("Import complete.");
    } catch (err) {
      setError("Import error");
      alert("Import failed: " + (err.message || String(err)));
    } finally {
      setBusy(false, "Synced");
      importFile && (importFile.value = "");
    }
  }

  /******************************************************************
   * EVENTS
   ******************************************************************/
  railInput?.addEventListener("click", () => setActive("input")); // L900
  railQueue?.addEventListener("click", () => setActive("queue")); // L901
  mobileViewQueueBtn?.addEventListener("click", () => setActive("queue")); // L902
  jumpAddBtn?.addEventListener("click", () => setActive("input")); // L903
  makePaneExpandable(paneInput, "input"); // L904
  makePaneExpandable(paneQueue, "queue"); // L905

  typeEl?.addEventListener("change", updateTypeUI); // L907
  addBtn?.addEventListener("click", addItem); // L908
  clearBtn?.addEventListener("click", clearForm); // L909
  refreshBtn?.addEventListener("click", refreshFromCloud); // L910

  searchEl?.addEventListener("input", render); // L912
  filterStatusEl?.addEventListener("change", render); // L913
  sortEl?.addEventListener("change", render); // L914

  exportBtn?.addEventListener("click", exportJson); // L916
  importBtn?.addEventListener("click", () => importFile?.click()); // L917
  importFile?.addEventListener("change", async (e) => { // L918
    const file = e.target.files?.[0];
    if (!file) return;
    await importJsonFile(file);
  });

  sendLinkBtn?.addEventListener("click", sendMagicLink); // L926
  signOutBtn?.addEventListener("click", signOut); // L927

  window.addEventListener("resize", () => { // L929
    const inputIsActive = paneInput?.classList.contains("active");
    setActive(inputIsActive ? "input" : "queue");
  });

  /******************************************************************
   * BOOT
   ******************************************************************/
  updateTypeUI(); // L940
  setupAutocomplete(); // L941
  setActive("input"); // L942

  if (!isConfigured()) { // L944
    setError("Missing Supabase config");
    setAuthUiSignedOut();
    render();
    return;
  }

  // Hydrate session, handle auth changes
  (async () => { // L952
    const { data } = await supabase.auth.getSession();
    session = data.session || null;

    if (session?.user?.email) {
      setAuthUiSignedIn(session.user.email);
      signOutBtn && (signOutBtn.style.display = "");
      await refreshFromCloud();
    } else {
      setAuthUiSignedOut();
      items = [];
      updateCounts();
      render();
    }

    supabase.auth.onAuthStateChange(async (_event, newSession) => { // L966
      session = newSession;
      if (session?.user?.email) {
        setAuthUiSignedIn(session.user.email);
        signOutBtn && (signOutBtn.style.display = "");
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
