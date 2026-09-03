import { useEffect, useState, useRef } from "react";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
} from "firebase/firestore";
import { ref, uploadString, getDownloadURL } from "firebase/storage";
import { db, storage } from "../lib/firebase";

const EMPTY_FORM = {
  title: "", type: "TV Show", year: "", service: "", genres: "", cast: "",
  rtScore: "", rtLink: "", episode: "", notes: "",
};

export default function Home() {
  const [entries, setEntries] = useState([]);
  const [currentTab, setCurrentTab] = useState("all");
  const [viewMode, setViewMode] = useState("flat"); // flat | genre | service
  const [layout, setLayout] = useState("tiles"); // tiles | list
  const [filterService, setFilterService] = useState("");
  const [filterGenre, setFilterGenre] = useState("");
  const [activeTags, setActiveTags] = useState([]);
  const [sortBy, setSortBy] = useState("alpha"); // alpha | recent
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [tags, setTags] = useState([]);
  const [status, setStatus] = useState("want");
  const [method, setMethod] = useState("type");
  const [thumbPreview, setThumbPreview] = useState(null);
  const [pendingBackdrop, setPendingBackdrop] = useState(null);
  const [aiStatus, setAiStatus] = useState("");
  const [syncStatus, setSyncStatus] = useState("Connecting…");
  const [serviceLogos, setServiceLogos] = useState({});
  const [candidates, setCandidates] = useState([]);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [discoverData, setDiscoverData] = useState(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const cameraRef = useRef(null);
  const uploadRef = useRef(null);

  // ---------- Realtime sync ----------
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "entries"),
      (snap) => {
        setEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setSyncStatus("Synced across devices");
      },
      (err) => {
        console.error(err);
        setSyncStatus("Couldn't connect to the shared list — check your connection");
      }
    );
    return () => unsub();
  }, []);

  async function handlePasteButton() {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      setAiStatus("Pasting isn't supported here — try Take a pic or Screenshot instead.");
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (imageType) {
          const blob = await item.getType(imageType);
          analyzePhoto(blob);
          return;
        }
      }
      setAiStatus("No image found on the clipboard — copy a screenshot first, then tap paste.");
    } catch (e) {
      setAiStatus("Couldn't access the clipboard here — try Take a pic or Screenshot instead.");
    }
  }

  // Listen for clipboard paste (e.g. Cmd+V / Ctrl+V of a screenshot) while the sheet is open
  useEffect(() => {
    if (!sheetOpen) return;
    function handlePaste(e) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type && item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            setMethod("paste");
            analyzePhoto(blob);
          }
          break;
        }
      }
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [sheetOpen]);

  // Fetch the official logo for each unique streaming service as new ones show up
  useEffect(() => {
    const services = [...new Set(entries.map((e) => e.service).filter(Boolean))];
    const missing = services.filter((s) => !(s in serviceLogos));
    if (missing.length === 0) return;
    missing.forEach(async (s) => {
      try {
        const res = await fetch("/api/provider-logo?service=" + encodeURIComponent(s));
        const data = await res.json();
        setServiceLogos((prev) => ({ ...prev, [s]: data.logoUrl || null }));
      } catch (e) {
        setServiceLogos((prev) => ({ ...prev, [s]: null }));
      }
    });
  }, [entries]);

  // ---------- Helpers ----------
  async function callApi(path, body, isGet) {
    const res = await fetch(path + (isGet ? "?" + new URLSearchParams(body) : ""), {
      method: isGet ? "GET" : "POST",
      headers: isGet ? {} : { "Content-Type": "application/json" },
      body: isGet ? undefined : JSON.stringify(body),
    });
    return res.json();
  }

  async function startLookup(title) {
    if (!title) return;
    setCandidates([]);
    setAiStatus("Searching…");
    try {
      const data = await callApi("/api/search-titles", { title }, true);
      const results = data.results || [];
      if (results.length <= 1) {
        setAiStatus("");
        runEnrichment(title, results[0]?.year || "");
      } else {
        setAiStatus("");
        setCandidates(results);
      }
    } catch (e) {
      setAiStatus("");
      runEnrichment(title);
    }
  }

  function pickCandidate(c) {
    setForm((f) => ({ ...f, title: c.title, type: c.type, year: c.year || f.year }));
    if (c.posterUrl) setPendingBackdrop(c.posterUrl);
    setCandidates([]);
    runEnrichment(c.title, c.year);
  }

  async function runEnrichment(title, year) {
    setAiStatus("Looking up details…");
    try {
      const data = await callApi("/api/enrich", { title, year: year || "" });
      setForm((f) => ({
        ...f,
        type: data.type || f.type,
        year: data.year ? String(data.year) : f.year,
        service: data.service || f.service,
        genres: data.genres ? data.genres.join(", ") : f.genres,
        cast: data.cast ? data.cast.join(", ") : f.cast,
        rtScore: data.rtScore ?? f.rtScore,
        rtLink: data.rtLink || f.rtLink,
      }));
      // fetch backdrop in parallel, non-blocking
      callApi("/api/backdrop", { title, type: data.type || "TV Show", year: data.year || year || "" }, true)
        .then((b) => setPendingBackdrop(b.backdropUrl || null))
        .catch(() => {});
      setAiStatus("");
    } catch (e) {
      setAiStatus("Couldn't look that up — fill in manually");
    }
  }

  async function analyzePhoto(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.split(",")[1];
      const mediaType = file.type || "image/jpeg";
      setThumbPreview(dataUrl);
      setAiStatus("Reading the screen…");
      try {
        const result = await callApi("/api/analyze-image", { base64, mediaType });
        if (result && result.title) {
          setForm((f) => ({
            ...f,
            title: result.title,
            episode: result.episode && result.episode !== "null" ? result.episode : f.episode,
            service: result.service && result.service !== "null" ? result.service : f.service,
          }));
          if (result.episode && result.episode !== "null") {
            setStatus("watching");
          }
          await runEnrichment(result.title);
        } else {
          setAiStatus("Couldn't read the image — type the title instead");
        }
      } catch (e) {
        setAiStatus("Couldn't read the image — type the title instead");
      }
    };
    reader.readAsDataURL(file);
  }

  async function findRelated(entry) {
    try {
      const arr = await callApi("/api/related", { title: entry.title, genres: entry.genres || [] });
      await updateDoc(doc(db, "entries", entry.id), { related: arr });
    } catch (e) {
      console.error(e);
    }
  }

  async function openDiscover() {
    setDiscoverOpen(true);
    if (discoverData) return;
    setDiscoverLoading(true);
    try {
      const data = await callApi("/api/discover", {}, true);
      setDiscoverData(data);
    } catch (e) {
      setDiscoverData({ trending: [], nowPlaying: [], upcoming: [] });
    }
    setDiscoverLoading(false);
  }

  function quickAddFromDiscover(item, presetStatus) {
    setCandidates([]);
    setEditingId(null);
    setForm({ ...EMPTY_FORM, title: item.title, type: item.type });
    setTags([]);
    setStatus(presetStatus || "consider");
    setMethod("type");
    setThumbPreview(null);
    setPendingBackdrop(item.backdropUrl || item.posterUrl || null);
    setShowLinkInput(false);
    setDiscoverOpen(false);
    setSheetOpen(true);
    runEnrichment(item.title, item.year);
  }

  // ---------- Form open/close ----------
  function openAdd() {
    setCandidates([]);
    setShowLinkInput(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setTags([]);
    setStatus("want");
    setMethod("type");
    setThumbPreview(null);
    setPendingBackdrop(null);
    setAiStatus("");
    setSheetOpen(true);
  }
  function openEdit(entry) {
    setCandidates([]);
    setShowLinkInput(false);
    setEditingId(entry.id);
    setForm({
      title: entry.title, type: entry.type, year: entry.year || "", service: entry.service || "",
      genres: (entry.genres || []).join(", "), cast: entry.cast || "",
      rtScore: entry.rtScore ?? "", rtLink: entry.rtLink || "",
      episode: entry.episode || "", notes: entry.notes || "",
    });
    setTags(entry.tags || []);
    setStatus(entry.status);
    setMethod("type");
    setThumbPreview(entry.backdropUrl || null);
    setPendingBackdrop(entry.backdropUrl || null);
    setAiStatus("");
    setSheetOpen(true);
  }
  function closeSheet() { setSheetOpen(false); setCandidates([]); }

  function prefillFromRelated(title, type) {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, title, type: type || "TV Show" });
    setTags([]); setStatus("want"); setMethod("type");
    setThumbPreview(null); setPendingBackdrop(null);
    setSheetOpen(true);
    runEnrichment(title);
  }

  async function handleSave() {
    if (!form.title.trim()) return;
    const genres = form.genres.split(",").map((s) => s.trim()).filter(Boolean);
    const payload = {
      title: form.title.trim(),
      type: form.type,
      year: form.year.trim(),
      service: form.service.trim(),
      genres,
      cast: form.cast.trim(),
      rtScore: form.rtScore === "" ? null : Number(form.rtScore),
      rtLink: form.rtLink.trim(),
      episode: form.episode.trim(),
      notes: form.notes.trim(),
      tags,
      status,
      backdropUrl: pendingBackdrop || null,
    };
    setSyncStatus("Saving…");
    try {
      if (editingId) {
        await updateDoc(doc(db, "entries", editingId), payload);
      } else {
        await addDoc(collection(db, "entries"), { ...payload, related: [], createdAt: Date.now() });
      }
      setSyncStatus("Synced across devices");
      setCurrentTab(status);
      closeSheet();
    } catch (e) {
      console.error(e);
      setSyncStatus("Couldn't save — try again");
    }
  }

  async function moveStatus(id, newStatus) {
    try { await updateDoc(doc(db, "entries", id), { status: newStatus }); }
    catch (e) { console.error(e); }
  }
  async function removeEntry(id) {
    try { await deleteDoc(doc(db, "entries", id)); }
    catch (e) { console.error(e); }
  }
  async function updateEpisode(id, val) {
    try { await updateDoc(doc(db, "entries", id), { episode: val }); }
    catch (e) { console.error(e); }
  }

  // ---------- Derived data ----------
  const services = [...new Set(entries.map((e) => e.service).filter(Boolean))].sort();
  const allGenres = [...new Set(entries.flatMap((e) => e.genres || []))].sort();

  let filtered = currentTab === "all" ? [...entries] : entries.filter((e) => e.status === currentTab);
  if (filterService) filtered = filtered.filter((e) => e.service === filterService);
  if (filterGenre) filtered = filtered.filter((e) => (e.genres || []).includes(filterGenre));
  if (activeTags.length) filtered = filtered.filter((e) => activeTags.every((t) => (e.tags || []).includes(t)));

  filtered = [...filtered].sort((a, b) => {
    if (sortBy === "recent") return (b.createdAt || 0) - (a.createdAt || 0);
    return (a.title || "").localeCompare(b.title || "");
  });

  function toggleTagFilter(t) {
    setActiveTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  function groupBy(field) {
    const groups = {};
    filtered.forEach((e) => {
      let keys;
      if (field === "genres") {
        keys = filterGenre ? [filterGenre] : (e.genres && e.genres.length ? e.genres : ["Uncategorized"]);
      } else {
        keys = filterService ? [filterService] : [e.service || "Unlisted"];
      }
      keys.forEach((k) => {
        if (!groups[k]) groups[k] = [];
        groups[k].push(e);
      });
    });
    return Object.keys(groups).sort().map((k) => ({ key: k, items: groups[k] }));
  }

  const editingEntry = editingId ? entries.find((x) => x.id === editingId) : null;

  function renderItems(items) {
    if (layout === "tiles") {
      return (
        <div className="tile-grid">
          {items.map((e) => <Tile key={e.id} e={e} onOpen={openEdit} logo={serviceLogos[e.service]} />)}
        </div>
      );
    }
    return (
      <div className="list">
        {items.map((e) => (
          <Card key={e.id} e={e} onEdit={openEdit} onDelete={removeEntry} onMove={moveStatus}
            onEpisode={updateEpisode} onRelated={findRelated} onPickRelated={prefillFromRelated}
            logo={serviceLogos[e.service]} />
        ))}
      </div>
    );
  }

  return (
    <>
      <header>
        <div style={{ fontSize: "12px", letterSpacing: "0.15em", color: "var(--gold-dim)", marginBottom: "2px" }}>CVD</div>
        <h1 className="marquee-font">🍿 WHAT TO WATCH</h1>
        <p>Snap it, type it, never lose it again.</p>
        <div className="sync-row">
          <div className={`sync-line ${syncStatus.startsWith("Couldn't") ? "error" : ""}`}>{syncStatus}</div>
          <button className="refresh-btn" onClick={() => window.location.reload()} title="Refresh">
            ⟳ Refresh
          </button>
        </div>
      </header>

      <div style={{ padding: "16px 16px 0", display: "flex", justifyContent: "center", gap: "10px", flexWrap: "wrap" }}>
        <button className="add-pill" onClick={openAdd}>
          <span style={{ fontSize: "16px" }}>➕</span> Add something
        </button>
        <button className="discover-pill" onClick={openDiscover}>
          🎬 New &amp; Upcoming
        </button>
      </div>

      <div className="tabs">
        {["all", "consider", "theaters", "want", "watching", "watched"].map((s) => (
          <div key={s} className={`tab ${currentTab === s ? "active" : ""}`} onClick={() => setCurrentTab(s)}>
            {s === "all" ? "All" : s === "consider" ? "Considering" : s === "theaters" ? "In Theaters" : s === "want" ? "Want to Watch" : s === "watching" ? "Watching" : "Watched"}
            <span className="count">
              ({s === "all" ? entries.length : entries.filter((e) => e.status === s).length})
            </span>
          </div>
        ))}
      </div>

      <div className="mode-row">
        <div className={`mode-btn ${viewMode === "flat" ? "active" : ""}`} onClick={() => setViewMode("flat")}>All</div>
        <div className={`mode-btn ${viewMode === "genre" ? "active" : ""}`} onClick={() => setViewMode("genre")}>By Genre</div>
        <div className={`mode-btn ${viewMode === "service" ? "active" : ""}`} onClick={() => setViewMode("service")}>By Service</div>
      </div>

      <div className="mode-row mode-row-divided">
        <div className={`mode-btn ${layout === "tiles" ? "active" : ""}`} onClick={() => setLayout("tiles")}>🔳 Tiles</div>
        <div className={`mode-btn ${layout === "list" ? "active" : ""}`} onClick={() => setLayout("list")}>☰ List</div>
      </div>

      <div className="filters">
        <select className="chip" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="alpha">Sort: A–Z</option>
          <option value="recent">Sort: Recently added</option>
        </select>
        <select className="chip" value={filterService} onChange={(e) => setFilterService(e.target.value)}>
          <option value="">Any service</option>
          {services.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="chip" value={filterGenre} onChange={(e) => setFilterGenre(e.target.value)}>
          <option value="">Any genre</option>
          {allGenres.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        {["Larra", "Eric", "Family"].map((t) => (
          <div key={t} className={`chip ${activeTags.includes(t) ? "active" : ""}`} onClick={() => toggleTagFilter(t)}>{t}</div>
        ))}
        {(filterService || filterGenre || activeTags.length > 0) && (
          <div className="chip clear-chip" onClick={() => { setFilterService(""); setFilterGenre(""); setActiveTags([]); }}>
            ✕ Clear filters
          </div>
        )}
      </div>

      {viewMode === "flat" && (
        filtered.length === 0 ? <EmptyState tab={currentTab} /> : renderItems(filtered)
      )}

      {viewMode !== "flat" && (
        filtered.length === 0 ? <EmptyState tab={currentTab} /> :
          groupBy(viewMode === "genre" ? "genres" : "service").map((group) => (
            <div key={group.key}>
              <div className="shelf-heading">{group.key}</div>
              {renderItems(group.items)}
            </div>
          ))
      )}

      {discoverOpen && (
        <div className="overlay show" onClick={(e) => { if (e.target.classList.contains("overlay")) setDiscoverOpen(false); }}>
          <div className="sheet">
            <div className="sheet-header-bar">
              <h2>🎬 New &amp; Upcoming</h2>
              <button className="sheet-close" onClick={() => setDiscoverOpen(false)}>✕ Close</button>
            </div>
            <div className="sheet-inner" style={{ paddingBottom: "28px" }}>
              {discoverLoading && (
                <div className="status-line"><div className="spinner"></div><span>Loading…</span></div>
              )}
              {discoverData && !discoverLoading && (
                <>
                  <DiscoverRow title="In Theaters Now" items={discoverData.nowPlaying}
                    onPick={(item) => quickAddFromDiscover(item, "theaters")} />
                  <DiscoverRow title="Trending This Week" items={discoverData.trending}
                    onPick={(item) => quickAddFromDiscover(item, "consider")} />
                  <DiscoverRow title="Coming Soon" items={discoverData.upcoming}
                    onPick={(item) => quickAddFromDiscover(item, "consider")} />
                  {discoverData.trending.length === 0 && discoverData.nowPlaying.length === 0 && discoverData.upcoming.length === 0 && (
                    <div className="empty"><div className="big">Couldn't load right now</div>Check your connection and try again.</div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {sheetOpen && (
        <div className="overlay show" onClick={(e) => { if (e.target.classList.contains("overlay")) closeSheet(); }}>
          <div className="sheet">
            <div className="sheet-header-bar">
              <h2>{editingId ? "Edit" : "Add something"}</h2>
              <button className="sheet-close" onClick={closeSheet}>✕ Close</button>
            </div>
            {(thumbPreview || pendingBackdrop) && (
              <img className="sheet-hero" src={thumbPreview || pendingBackdrop} alt="" />
            )}
            <div className="sheet-inner">
              {editingEntry && (
                <div className="card-actions" style={{ marginBottom: "8px" }}>
                  {editingEntry.status === "consider" && (
                    <>
                      <button className="btn-mini primary" onClick={() => { moveStatus(editingId, "want"); setStatus("want"); }}>Add to my list</button>
                      <button className="btn-mini" onClick={() => { moveStatus(editingId, "watching"); setStatus("watching"); }}>Start watching</button>
                    </>
                  )}
                  {editingEntry.status === "theaters" && (
                    <>
                      <button className="btn-mini primary" onClick={() => { moveStatus(editingId, "watched"); setStatus("watched"); }}>Saw it</button>
                      <button className="btn-mini" onClick={() => { moveStatus(editingId, "want"); setStatus("want"); }}>Wait for streaming</button>
                    </>
                  )}
                  {editingEntry.status === "want" && (
                    <button className="btn-mini primary" onClick={() => { moveStatus(editingId, "watching"); setStatus("watching"); }}>Start watching</button>
                  )}
                  {editingEntry.status === "watching" && (
                    <>
                      <button className="btn-mini primary" onClick={() => { moveStatus(editingId, "watched"); setStatus("watched"); }}>Mark watched</button>
                      <button className="btn-mini" onClick={() => { moveStatus(editingId, "want"); setStatus("want"); }}>Back to list</button>
                    </>
                  )}
                  {editingEntry.status === "watched" && (
                    <button className="btn-mini" onClick={() => { moveStatus(editingId, "watching"); setStatus("watching"); }}>Watch again</button>
                  )}
                  <button className="btn-mini" onClick={() => findRelated(editingEntry)}>Find similar</button>
                  <button className="btn-mini" onClick={() => { removeEntry(editingId); closeSheet(); }}>Remove</button>
                </div>
              )}

              <div className="method-row">
                {[["type", "⌨", "Type it"], ["photo", "📷", "Take a pic"], ["upload", "🖼", "Screenshot"], ["paste", "📋", "Paste image"]].map(([m, ic, label]) => (
                  <div key={m} className={`method-btn ${method === m ? "active" : ""}`}
                    onClick={() => {
                      setMethod(m);
                      if (m === "photo") cameraRef.current?.click();
                      if (m === "upload") uploadRef.current?.click();
                    }}>
                    <span className="ic">{ic}</span>{label}
                  </div>
                ))}
              </div>
              {method === "paste" && (
                <div style={{ marginTop: "6px" }}>
                  <div className="status-line" style={{ color: "var(--text-muted)", marginBottom: "8px" }}>
                    On a computer: copy a screenshot, then press ⌘V or Ctrl+V anywhere on this screen.
                  </div>
                  <button type="button" className="btn-mini primary" onClick={handlePasteButton}>
                    📋 Tap to paste
                  </button>
                </div>
              )}
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }}
                onChange={(e) => e.target.files[0] && analyzePhoto(e.target.files[0])} />
              <input ref={uploadRef} type="file" accept="image/*" style={{ display: "none" }}
                onChange={(e) => e.target.files[0] && analyzePhoto(e.target.files[0])} />

              <label>Title</label>
              <div style={{ display: "flex", gap: "8px" }}>
                <input type="text" value={form.title} style={{ flex: 1 }}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && form.title.trim()) {
                      e.preventDefault();
                      startLookup(form.title.trim());
                    }
                  }}
                  placeholder="e.g. Desperate Housewives" />
                <button type="button" className="btn-mini primary" style={{ flexShrink: 0 }}
                  onClick={() => form.title.trim() && startLookup(form.title.trim())}>
                  Look up
                </button>
              </div>

              {candidates.length > 0 && (
                <div className="candidate-picker">
                  <div className="candidate-picker-label">More than one match — which one?</div>
                  {candidates.map((c) => (
                    <div key={c.id} className="candidate-row" onClick={() => pickCandidate(c)}>
                      {c.posterUrl ? (
                        <img src={c.posterUrl} alt="" className="candidate-poster" />
                      ) : (
                        <div className="candidate-poster candidate-poster-fallback">🎬</div>
                      )}
                      <div>
                        <div className="candidate-title">{c.title}</div>
                        <div className="candidate-sub">{c.type}{c.year ? " · " + c.year : ""}</div>
                      </div>
                    </div>
                  ))}
                  <div className="candidate-dismiss" onClick={() => { setCandidates([]); runEnrichment(form.title.trim()); }}>
                    None of these — search anyway
                  </div>
                </div>
              )}


              {aiStatus && <div className="status-line"><div className="spinner"></div><span>{aiStatus}</span></div>}

              <label>Status</label>
              <div className="multichip-row">
                {[["consider", "Considering"], ["theaters", "In Theaters"], ["want", "Want to Watch"], ["watching", "Watching"], ["watched", "Watched"]].map(([s, label]) => (
                  <div key={s} className={`multichip ${status === s ? "on" : ""}`} onClick={() => setStatus(s)}>{label}</div>
                ))}
              </div>

              <label>Type</label>
              <select className="full" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="Movie">Movie</option>
                <option value="TV Show">TV Show</option>
              </select>

              <label>Streaming service / network</label>
              <input type="text" value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })} placeholder="e.g. Hulu, Netflix, ABC" />

              <label>Rotten Tomatoes score</label>
              {form.rtScore !== "" && (
                <a className="rt-badge" href={form.rtLink || "#"} target="_blank" rel="noopener noreferrer" style={{ marginBottom: "8px" }}>
                  <span className={rtClass(form.rtScore)}>🍅</span>{form.rtScore}%
                </a>
              )}
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <input type="text" value={form.rtScore} style={{ flex: "0 0 90px" }}
                  onChange={(e) => setForm({ ...form, rtScore: e.target.value })} placeholder="e.g. 81" />
                {showLinkInput ? (
                  <input type="text" value={form.rtLink} style={{ flex: 1 }} autoFocus
                    onChange={(e) => setForm({ ...form, rtLink: e.target.value })} placeholder="Link to reviews (https://...)" />
                ) : (
                  <span className="edit-link-toggle" onClick={() => setShowLinkInput(true)}>✎ Edit link</span>
                )}
              </div>

              <label>Genres (comma separated)</label>
              <input type="text" value={form.genres} onChange={(e) => setForm({ ...form, genres: e.target.value })} placeholder="e.g. Drama, Mystery, Dark Comedy" />

              <label>Top cast</label>
              <input type="text" value={form.cast} onChange={(e) => setForm({ ...form, cast: e.target.value })} placeholder="e.g. Teri Hatcher, Felicity Huffman" />

              <label>Who's it for</label>
              <div className="multichip-row">
                {["Larra", "Eric", "Family"].map((t) => (
                  <div key={t} className={`multichip ${tags.includes(t) ? "on" : ""}`}
                    onClick={() => setTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])}>{t}</div>
                ))}
              </div>

              {(status === "watching" || status === "watched") && form.type === "TV Show" && (
                <>
                  <label>Where you left off (e.g. Season 3, Ep 7)</label>
                  <input type="text" value={form.episode} onChange={(e) => setForm({ ...form, episode: e.target.value })} placeholder="Season 3, Episode 7" />
                </>
              )}

              <label>Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Anything worth remembering..." />

              <div className="sheet-actions">
                <button className="btn-full ghost" onClick={closeSheet}>Cancel</button>
                <button className="btn-full primary" onClick={handleSave}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function DiscoverRow({ title, items, onPick }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginBottom: "22px" }}>
      <div className="discover-heading">{title}</div>
      <div className="discover-scroll">
        {items.map((item) => (
          <div key={item.id + item.type} className="discover-card" onClick={() => onPick(item)}>
            {item.posterUrl ? (
              <img src={item.posterUrl} alt="" />
            ) : (
              <div className="discover-fallback">🎬</div>
            )}
            <div className="discover-add">+</div>
            <div className="discover-title">{item.title}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ tab }) {
  const msg = {
    all: "Nothing tracked yet. Tap + to add the first thing.",
    consider: "Nothing to weigh in on yet. Add something you're on the fence about.",
    theaters: "Nothing on the big screen radar. Add a movie you want to catch before it's gone.",
    want: "Nothing on the list yet. Tap + to add the next thing you hear about.",
    watching: "Nothing in progress. Move something here once you start it.",
    watched: "Nothing watched yet — your history will collect here.",
  };
  return (
    <div className="empty">
      <div style={{ fontSize: "40px", marginBottom: "10px" }}>🍿</div>
      <div className="big">Empty for now</div>{msg[tab]}
    </div>
  );
}

function rtClass(score) {
  if (score === null || score === undefined || score === "") return "";
  return Number(score) >= 60 ? "rt-fresh" : "rt-rotten";
}

function Tile({ e, onOpen, logo }) {
  return (
    <div className="tile" onClick={() => onOpen(e)}>
      <div className="tile-media">
        <div className={`tile-status-dot ${e.status}`}></div>
        {e.rtScore !== null && e.rtScore !== undefined && e.rtScore !== "" && (
          <a className={`tile-rt ${rtClass(e.rtScore)}`} href={e.rtLink || "#"} target="_blank" rel="noopener noreferrer"
            onClick={(ev) => ev.stopPropagation()}>
            🍅 {e.rtScore}% <span className="rt-link-icon">↗</span>
          </a>
        )}
        {e.backdropUrl ? (
          <img src={e.backdropUrl} alt="" />
        ) : (
          <div className="tile-fallback">🍿</div>
        )}
      </div>
      <div className="tile-caption">
        <div className="tile-title">{e.title}</div>
        <div className="tile-sub">
          {logo ? <img className="service-logo" src={logo} alt={e.service} /> : <span>{e.service || e.type}</span>}
          {e.episode ? <span>{" · " + e.episode}</span> : null}
        </div>
      </div>
    </div>
  );
}

function Card({ e, onEdit, onDelete, onMove, onEpisode, onRelated, onPickRelated, logo }) {
  const [epVal, setEpVal] = useState(e.episode || "");
  useEffect(() => setEpVal(e.episode || ""), [e.episode]);

  return (
    <div className={`card ${e.status}`}>
      {e.backdropUrl && (
        <div className="card-backdrop-wrap">
          <img className="card-backdrop" src={e.backdropUrl} alt="" />
          <div className="card-backdrop-fade"></div>
        </div>
      )}
      <div className="card-body">
        <div className="card-top">
          <div>
            <p className="card-title">{e.title}</p>
            <p className="card-sub">
              {e.type}{e.year ? " (" + e.year + ")" : ""}{e.cast ? " · " + e.cast : ""}
              {" · "}<span style={{ color: e.status === "watching" ? "var(--gold)" : e.status === "watched" ? "var(--green)" : e.status === "consider" ? "var(--teal)" : e.status === "theaters" ? "var(--red)" : "var(--text-muted)" }}>
                {e.status === "consider" ? "Considering" : e.status === "theaters" ? "In Theaters" : e.status === "want" ? "Want to Watch" : e.status === "watching" ? "Watching" : "Watched"}
              </span>
            </p>
          </div>
          {e.rtScore !== null && e.rtScore !== undefined && e.rtScore !== "" && (
            <a className="rt-badge" href={e.rtLink || "#"} target="_blank" rel="noopener noreferrer">
              <span className={rtClass(e.rtScore)}>🍅</span>{e.rtScore}% <span className="rt-link-icon">↗</span>
            </a>
          )}
        </div>
        <div className="chips-row">
          {e.service && (logo ? <img className="service-logo-chip" src={logo} alt={e.service} title={e.service} /> : <span className="tagchip">{e.service}</span>)}
          {(e.genres || []).map((g) => <span key={g} className="tagchip">{g}</span>)}
          {(e.tags || []).map((t) => <span key={t} className="tagchip person">{t}</span>)}
        </div>

        {e.status === "watching" && e.type === "TV Show" ? (
          <div className="progress-row">📍
            <input type="text" value={epVal} onChange={(ev) => setEpVal(ev.target.value)}
              onBlur={() => onEpisode(e.id, epVal)} placeholder="Season / episode" />
          </div>
        ) : e.episode ? (
          <div className="progress-row">📍 Stopped at {e.episode}</div>
        ) : null}

        {e.related && e.related.length > 0 && (
          <div className="related-box">
            <div className="lbl">Because you liked this</div>
            {e.related.map((r) => (
              <span key={r.title} className="related-item" onClick={() => onPickRelated(r.title, r.type)}>{r.title}</span>
            ))}
          </div>
        )}

        <div className="card-actions">
          {e.status === "consider" && <>
            <button className="btn-mini primary" onClick={() => onMove(e.id, "want")}>Add to my list</button>
            <button className="btn-mini" onClick={() => onMove(e.id, "watching")}>Start watching</button>
          </>}
          {e.status === "theaters" && <>
            <button className="btn-mini primary" onClick={() => onMove(e.id, "watched")}>Saw it</button>
            <button className="btn-mini" onClick={() => onMove(e.id, "want")}>Wait for streaming</button>
          </>}
          {e.status === "want" && <button className="btn-mini primary" onClick={() => onMove(e.id, "watching")}>Start watching</button>}
          {e.status === "watching" && <>
            <button className="btn-mini primary" onClick={() => onMove(e.id, "watched")}>Mark watched</button>
            <button className="btn-mini" onClick={() => onMove(e.id, "want")}>Back to list</button>
          </>}
          {e.status === "watched" && <button className="btn-mini" onClick={() => onMove(e.id, "watching")}>Watch again</button>}
          <button className="btn-mini" onClick={() => onRelated(e)}>Find similar</button>
          <button className="btn-mini" onClick={() => onEdit(e)}>Edit</button>
          <button className="btn-mini" onClick={() => onDelete(e.id)}>Remove</button>
        </div>
      </div>
    </div>
  );
}
