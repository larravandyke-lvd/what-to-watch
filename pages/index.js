import { useEffect, useState, useRef } from "react";
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDoc, setDoc, arrayUnion, arrayRemove,
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
  const [sortBy, setSortBy] = useState("recent"); // alpha | recent
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
  const [discoverFilter, setDiscoverFilter] = useState("movies"); // movies | shows
  const [dismissedIds, setDismissedIds] = useState([]);
  const [showDismissed, setShowDismissed] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickCandidates, setQuickCandidates] = useState([]);
  const [quickResult, setQuickResult] = useState(null);
  const [quickLogo, setQuickLogo] = useState(null);
  const [quickStatus, setQuickStatus] = useState("");
  const [archivedOpen, setArchivedOpen] = useState(false);
  const cameraRef = useRef(null);
  const uploadRef = useRef(null);

  // Always start at the top — prevents the browser from restoring a scrolled
  // position from a previous visit, which hides the header on reopen.
  useEffect(() => {
    if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
    window.scrollTo(0, 0);
    // Content (like the Firestore list) can load in a moment after mount and
    // shift page height, which can nudge scroll position — re-assert after a beat.
    const t1 = setTimeout(() => window.scrollTo(0, 0), 150);
    const t2 = setTimeout(() => window.scrollTo(0, 0), 600);
    // pageshow fires even when a page is restored from cache (e.g. reopening
    // a link inside the Messages in-app browser), unlike a normal mount effect.
    function handlePageShow() { window.scrollTo(0, 0); }
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  // Show a floating "back to top" button once scrolled down a bit
  useEffect(() => {
    function handleScroll() {
      setShowScrollTop(window.scrollY > 400);
    }
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

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

  async function startLookup(title, serviceHint) {
    if (!title) return;
    setCandidates([]);
    setAiStatus("Searching…");
    try {
      const data = await callApi("/api/search-titles", { title }, true);
      const results = data.results || [];
      if (results.length <= 1) {
        setAiStatus("");
        const canonicalTitle = results[0]?.title || title;
        if (canonicalTitle !== title) setForm((f) => ({ ...f, title: canonicalTitle }));
        runEnrichment(canonicalTitle, results[0]?.year || "", serviceHint);
      } else {
        setAiStatus("");
        setCandidates(results);
      }
    } catch (e) {
      setAiStatus("");
      runEnrichment(title, "", serviceHint);
    }
  }

  function pickCandidate(c) {
    setForm((f) => ({ ...f, title: c.title, type: c.type, year: c.year || f.year }));
    if (c.posterUrl) setPendingBackdrop(c.posterUrl);
    setCandidates([]);
    runEnrichment(c.title, c.year);
  }

  async function runEnrichment(title, year, serviceHint) {
    setAiStatus("Looking up details…");
    try {
      const data = await callApi("/api/enrich", { title, year: year || "", serviceHint: serviceHint || "" });
      const gotSomething = data && (data.type || data.service || (data.genres && data.genres.length) || (data.cast && data.cast.length));
      setForm((f) => ({
        ...f,
        title: data.title || f.title,
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
      setAiStatus(gotSomething ? "" : "Found the picture, but couldn't pull details — tap Look up to try again, or fill in manually.");
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
          await runEnrichment(result.title, "", result.service && result.service !== "null" ? result.service : "");
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

  function openQuickLookup() {
    setQuickOpen(true);
    setQuickTitle("");
    setQuickCandidates([]);
    setQuickResult(null);
    setQuickLogo(null);
    setQuickStatus("");
  }
  function closeQuickLookup() { setQuickOpen(false); }

  async function runQuickSearch(title) {
    if (!title) return;
    setQuickCandidates([]);
    setQuickResult(null);
    setQuickStatus("Searching…");
    try {
      const data = await callApi("/api/search-titles", { title }, true);
      const results = data.results || [];
      if (results.length <= 1) {
        await runQuickEnrich(title, results[0]?.year || "");
      } else {
        setQuickStatus("");
        setQuickCandidates(results);
      }
    } catch (e) {
      await runQuickEnrich(title);
    }
  }

  async function pickQuickCandidate(c) {
    setQuickCandidates([]);
    await runQuickEnrich(c.title, c.year);
  }

  async function runQuickEnrich(title, year) {
    setQuickStatus("Looking up details…");
    try {
      const data = await callApi("/api/enrich", { title, year: year || "" });
      setQuickResult({ title, ...data });
      setQuickStatus("");
      if (data.service) {
        callApi("/api/provider-logo", { service: data.service }, true)
          .then((d) => setQuickLogo(d.logoUrl || null))
          .catch(() => setQuickLogo(null));
      } else {
        setQuickLogo(null);
      }
    } catch (e) {
      setQuickStatus("Couldn't look that up.");
    }
  }

  function addQuickResultToList() {
    if (!quickResult) return;
    setCandidates([]);
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      title: quickResult.title,
      type: quickResult.type || "TV Show",
      service: quickResult.service || "",
      genres: quickResult.genres ? quickResult.genres.join(", ") : "",
      cast: quickResult.cast ? quickResult.cast.join(", ") : "",
      rtScore: quickResult.rtScore ?? "",
      rtLink: quickResult.rtLink || "",
    });
    setTags([]);
    setStatus("want");
    setMethod("type");
    setThumbPreview(null);
    setPendingBackdrop(null);
    setShowLinkInput(false);
    setQuickOpen(false);
    setSheetOpen(true);
  }

  function normKey(title, type) {
    return `${(type || "").toLowerCase()}-${(title || "").trim().toLowerCase()}`;
  }
  function findExistingEntry(item) {
    const key = normKey(item.title, item.type);
    return visibleEntries.find((e) => normKey(e.title, e.type) === key) || null;
  }
  function handleDiscoverPick(item, presetStatus) {
    const existing = findExistingEntry(item);
    if (existing) {
      setDiscoverOpen(false);
      openEdit(existing);
    } else {
      quickAddFromDiscover(item, presetStatus);
    }
  }
  function discoverKey(item) { return `${item.type}-${item.id}`; }
  function filterDismissed(items) {
    return (items || []).filter((i) => !dismissedIds.includes(discoverKey(i)));
  }
  async function loadDismissed() {
    try {
      const snap = await getDoc(doc(db, "meta", "discoverDismissed"));
      setDismissedIds(snap.exists() ? (snap.data().ids || []) : []);
    } catch (e) {
      setDismissedIds([]);
    }
  }
  async function dismissDiscoverItem(item) {
    const key = discoverKey(item);
    setDismissedIds((prev) => [...new Set([...prev, key])]);
    try {
      await setDoc(doc(db, "meta", "discoverDismissed"), { ids: arrayUnion(key) }, { merge: true });
    } catch (e) {
      console.error(e);
    }
  }
  async function restoreDiscoverItem(item) {
    const key = discoverKey(item);
    setDismissedIds((prev) => prev.filter((k) => k !== key));
    try {
      await updateDoc(doc(db, "meta", "discoverDismissed"), { ids: arrayRemove(key) });
    } catch (e) {
      console.error(e);
    }
  }
  function getDismissedItems() {
    if (!discoverData) return [];
    const all = [
      ...(discoverData.nowPlaying || []),
      ...(discoverData.upcoming || []),
      ...(discoverData.onTheAir || []),
      ...(discoverData.trending || []),
    ];
    const seen = new Set();
    const result = [];
    all.forEach((item) => {
      const key = discoverKey(item);
      if (dismissedIds.includes(key) && !seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    });
    return result;
  }

  async function openDiscover() {
    setDiscoverOpen(true);
    setShowDismissed(false);
    loadDismissed();
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
    if (!editingId) {
      const dupKey = normKey(form.title, form.type);
      const dup = visibleEntries.find((e) => normKey(e.title, e.type) === dupKey);
      if (dup) {
        const proceed = window.confirm(`"${form.title.trim()}" is already on your list (${dup.status}). Add it again as a separate entry anyway?`);
        if (!proceed) return;
      }
    }
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
  async function archiveEntry(id) {
    try { await updateDoc(doc(db, "entries", id), { archived: true }); }
    catch (e) { console.error(e); }
  }
  async function restoreEntry(id) {
    try { await updateDoc(doc(db, "entries", id), { archived: false }); }
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
  const visibleEntries = entries.filter((e) => !e.archived);
  const archivedEntries = entries.filter((e) => e.archived);

  const services = [...new Set(visibleEntries.map((e) => e.service).filter(Boolean))].sort();
  const allGenres = [...new Set(visibleEntries.flatMap((e) => e.genres || []))].sort();

  let filtered = currentTab === "all" ? [...visibleEntries] : visibleEntries.filter((e) => e.status === currentTab);
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
          <Card key={e.id} e={e} onEdit={openEdit} onDelete={archiveEntry} onMove={moveStatus}
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
        <button className="quick-pill" onClick={openQuickLookup}>
          🔍 Quick lookup
        </button>
      </div>

      <div className="tabs">
        {["all", "consider", "theaters", "want", "watching", "watched"].map((s) => (
          <div key={s} className={`tab ${currentTab === s ? "active" : ""}`} onClick={() => setCurrentTab(s)}>
            <span className="tab-label">
              {s === "all" ? "All" : s === "consider" ? "Considering" : s === "theaters" ? "In Theaters" : s === "want" ? "Want to Watch" : s === "watching" ? "Watching" : "Watched"}
            </span>
            <span className="count">
              ({s === "all" ? visibleEntries.length : visibleEntries.filter((e) => e.status === s).length})
            </span>
          </div>
        ))}
      </div>

      <div className="section-label">Group by</div>
      <div className="mode-row">
        <div className={`mode-btn ${viewMode === "flat" ? "active" : ""}`} onClick={() => setViewMode("flat")}>All</div>
        <div className={`mode-btn ${viewMode === "genre" ? "active" : ""}`} onClick={() => setViewMode("genre")}>By Genre</div>
        <div className={`mode-btn ${viewMode === "service" ? "active" : ""}`} onClick={() => setViewMode("service")}>By Service</div>
      </div>

      <div className="section-label section-label-divided">Layout</div>
      <div className="mode-row">
        <div className={`mode-btn ${layout === "tiles" ? "active" : ""}`} onClick={() => setLayout("tiles")}>🔳 Tiles</div>
        <div className={`mode-btn ${layout === "list" ? "active" : ""}`} onClick={() => setLayout("list")}>☰ List</div>
      </div>

      {archivedEntries.length > 0 && (
        <div className="archived-link-row">
          <span className="archived-link" onClick={() => setArchivedOpen(true)}>🗄 Archived ({archivedEntries.length})</span>
        </div>
      )}

      <div className="section-label section-label-divided">Filter &amp; sort</div>
      <div className="filters">
        <div className="filters-row">
          <div className="select-wrap">
            <select className="chip" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="recent">Sort: Recent</option>
              <option value="alpha">Sort: A–Z</option>
            </select>
            <span className="select-arrow"><svg width="9" height="6" viewBox="0 0 9 6" fill="none"><path d="M1 1L4.5 5L8 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
          </div>
          <div className="select-wrap">
            <select className="chip" value={filterService} onChange={(e) => setFilterService(e.target.value)}>
              <option value="">Service</option>
              {services.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className="select-arrow"><svg width="9" height="6" viewBox="0 0 9 6" fill="none"><path d="M1 1L4.5 5L8 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
          </div>
          <div className="select-wrap">
            <select className="chip" value={filterGenre} onChange={(e) => setFilterGenre(e.target.value)}>
              <option value="">Genre</option>
              {allGenres.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <span className="select-arrow"><svg width="9" height="6" viewBox="0 0 9 6" fill="none"><path d="M1 1L4.5 5L8 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
          </div>
        </div>
        <div className="filters-row">
          {["Larra", "Eric", "Maddie", "Family"].map((t) => (
            <div key={t} className={`chip ${activeTags.includes(t) ? "active" : ""}`} onClick={() => toggleTagFilter(t)}>{t}</div>
          ))}
        </div>
        {(filterService || filterGenre || activeTags.length > 0) && (
          <div className="filters-row">
            <div className="chip clear-chip" onClick={() => { setFilterService(""); setFilterGenre(""); setActiveTags([]); }}>
              ✕ Clear filters
            </div>
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

      {archivedOpen && (
        <div className="overlay show" onClick={(e) => { if (e.target.classList.contains("overlay")) setArchivedOpen(false); }}>
          <div className="sheet">
            <div className="sheet-header-bar">
              <h2>🗄 Archived</h2>
              <button className="sheet-close" onClick={() => setArchivedOpen(false)}>✕ Close</button>
            </div>
            <div className="sheet-inner" style={{ paddingBottom: "28px" }}>
              {archivedEntries.length === 0 ? (
                <div className="empty">
                  <div style={{ fontSize: "36px", marginBottom: "8px" }}>🗄</div>
                  <div className="big">Nothing archived</div>
                  Things you archive show up here instead of disappearing forever.
                </div>
              ) : (
                archivedEntries.map((e) => (
                  <div key={e.id} className="archived-row">
                    <div>
                      <div className="archived-title">{e.title}</div>
                      <div className="archived-sub">{e.type}{e.year ? ` (${e.year})` : ""}</div>
                    </div>
                    <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
                      <button className="btn-mini primary" onClick={() => restoreEntry(e.id)}>Restore</button>
                      <button className="btn-mini" onClick={() => { if (window.confirm("Delete forever? This can't be undone.")) removeEntry(e.id); }}>
                        Delete forever
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {quickOpen && (
        <div className="overlay show" onClick={(e) => { if (e.target.classList.contains("overlay")) closeQuickLookup(); }}>
          <div className="sheet">
            <div className="sheet-header-bar">
              <h2>🔍 Quick Lookup</h2>
              <button className="sheet-close" onClick={closeQuickLookup}>✕ Close</button>
            </div>
            <div className="sheet-inner" style={{ paddingBottom: "28px" }}>
              <label>Title</label>
              <div style={{ display: "flex", gap: "8px" }}>
                <input type="text" value={quickTitle} style={{ flex: 1 }}
                  onChange={(e) => setQuickTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && quickTitle.trim()) {
                      e.preventDefault();
                      runQuickSearch(quickTitle.trim());
                    }
                  }}
                  placeholder="e.g. Severance" />
                <button type="button" className="btn-mini primary" style={{ flexShrink: 0 }}
                  onClick={() => quickTitle.trim() && runQuickSearch(quickTitle.trim())}>
                  Look up
                </button>
              </div>

              {quickStatus && <div className="status-line"><div className="spinner"></div><span>{quickStatus}</span></div>}

              {quickCandidates.length > 0 && (
                <div className="candidate-picker">
                  <div className="candidate-picker-label">More than one match — which one?</div>
                  {quickCandidates.map((c) => (
                    <div key={c.id} className="candidate-row" onClick={() => pickQuickCandidate(c)}>
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
                </div>
              )}

              {quickResult && (
                <div className="quick-result">
                  <div className="quick-result-title">
                    {quickResult.title}{quickResult.year ? ` (${quickResult.year})` : ""}
                  </div>
                  <div className="quick-result-sub">
                    {quickResult.type}{quickResult.cast && quickResult.cast.length ? " · " + quickResult.cast.slice(0, 3).join(", ") : ""}
                  </div>
                  <div className="quick-result-row">
                    {quickLogo ? (
                      <img className="service-logo-chip" src={quickLogo} alt={quickResult.service} title={quickResult.service} />
                    ) : (
                      quickResult.service && <span className="tagchip">{quickResult.service}</span>
                    )}
                    {quickResult.rtScore !== null && quickResult.rtScore !== undefined && (
                      <a className="rt-badge" href={quickResult.rtLink || "#"} target="_blank" rel="noopener noreferrer">
                        <span className={rtClass(quickResult.rtScore)}>🍅</span>{quickResult.rtScore}% <span className="rt-link-icon">↗</span>
                      </a>
                    )}
                  </div>
                  {quickResult.genres && quickResult.genres.length > 0 && (
                    <div className="chips-row" style={{ marginTop: "8px" }}>
                      {quickResult.genres.map((g) => <span key={g} className="tagchip">{g}</span>)}
                    </div>
                  )}
                  <button className="btn-full primary" style={{ marginTop: "16px" }} onClick={addQuickResultToList}>
                    + Add to my list
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showScrollTop && (
        <button className="scroll-top-btn" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} title="Back to top">
          ↑
        </button>
      )}

      {discoverOpen && (
        <div className="overlay show" onClick={(e) => { if (e.target.classList.contains("overlay")) setDiscoverOpen(false); }}>
          <div className="sheet">
            <div className="sheet-header-bar">
              <h2>🎬 New &amp; Upcoming</h2>
              <button className="sheet-close" onClick={() => setDiscoverOpen(false)}>✕ Close</button>
            </div>
            <div className="sheet-inner" style={{ paddingBottom: "28px" }}>
              <div className="mode-row" style={{ padding: "0 0 8px" }}>
                <div className={`mode-btn ${discoverFilter === "movies" ? "active" : ""}`} onClick={() => setDiscoverFilter("movies")}>🎬 Movies</div>
                <div className={`mode-btn ${discoverFilter === "shows" ? "active" : ""}`} onClick={() => setDiscoverFilter("shows")}>📺 Shows</div>
              </div>
              {dismissedIds.length > 0 && (
                <div className="show-dismissed-toggle" onClick={() => setShowDismissed((v) => !v)}>
                  {showDismissed ? "← Back to browsing" : `Show dismissed (${dismissedIds.length})`}
                </div>
              )}
              {discoverLoading && (
                <div className="status-line"><div className="spinner"></div><span>Loading…</span></div>
              )}
              {showDismissed && !discoverLoading && (
                <DiscoverRow title="Dismissed" items={getDismissedItems()}
                  onPick={(item) => handleDiscoverPick(item, "consider")}
                  onRestore={restoreDiscoverItem}
                  isOnList={(item) => !!findExistingEntry(item)} />
              )}
              {!showDismissed && discoverData && !discoverLoading && (() => {
                const nowPlaying = filterDismissed(discoverData.nowPlaying || []);
                const upcoming = filterDismissed(discoverData.upcoming || []);
                const onTheAir = filterDismissed(discoverData.onTheAir || []);
                const trending = discoverData.trending || [];
                const trendingMovies = filterDismissed(trending.filter((x) => x.type === "Movie"));
                const trendingShows = filterDismissed(trending.filter((x) => x.type === "TV Show"));
                return (
                  <>
                    {discoverFilter === "movies" ? (
                      <>
                        <DiscoverRow title="In Theaters Now" items={nowPlaying}
                          onPick={(item) => handleDiscoverPick(item, "theaters")}
                          onDismiss={dismissDiscoverItem} isOnList={(item) => !!findExistingEntry(item)} />
                        <DiscoverRow title="Trending This Week" items={trendingMovies}
                          onPick={(item) => handleDiscoverPick(item, nowPlaying.some((n) => n.id === item.id) ? "theaters" : "consider")}
                          onDismiss={dismissDiscoverItem} isOnList={(item) => !!findExistingEntry(item)} />
                        <DiscoverRow title="Coming Soon" items={upcoming}
                          onPick={(item) => handleDiscoverPick(item, "consider")}
                          onDismiss={dismissDiscoverItem} isOnList={(item) => !!findExistingEntry(item)} />
                        {nowPlaying.length === 0 && upcoming.length === 0 && trendingMovies.length === 0 && (
                          <div className="empty"><div className="big">Nothing here</div>Either nothing loaded, or you've dismissed everything in this category.</div>
                        )}
                      </>
                    ) : (
                      <>
                        <DiscoverRow title="New Episodes This Week" items={onTheAir}
                          onPick={(item) => handleDiscoverPick(item, "want")}
                          onDismiss={dismissDiscoverItem} isOnList={(item) => !!findExistingEntry(item)} />
                        <DiscoverRow title="Trending This Week" items={trendingShows}
                          onPick={(item) => handleDiscoverPick(item, "consider")}
                          onDismiss={dismissDiscoverItem} isOnList={(item) => !!findExistingEntry(item)} />
                        {onTheAir.length === 0 && trendingShows.length === 0 && (
                          <div className="empty"><div className="big">Nothing here</div>Either nothing loaded, or you've dismissed everything in this category.</div>
                        )}
                      </>
                    )}
                  </>
                );
              })()}
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
                  <button className="btn-mini" onClick={() => { if (window.confirm(`Archive "${editingEntry.title}"? You can restore it later from the Archived list.`)) { archiveEntry(editingId); closeSheet(); } }}>Archive</button>
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
                      startLookup(form.title.trim(), form.service.trim());
                    }
                  }}
                  placeholder="e.g. Desperate Housewives" />
                <button type="button" className="btn-mini primary" style={{ flexShrink: 0 }}
                  onClick={() => form.title.trim() && startLookup(form.title.trim(), form.service.trim())}>
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
              <div className="select-wrap select-wrap-full">
                <select className="full" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="Movie">Movie</option>
                  <option value="TV Show">TV Show</option>
                </select>
                <span className="select-arrow select-arrow-full"><svg width="9" height="6" viewBox="0 0 9 6" fill="none"><path d="M1 1L4.5 5L8 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
              </div>

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
                {["Larra", "Eric", "Maddie", "Family"].map((t) => (
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

function DiscoverRow({ title, items, onPick, onDismiss, onRestore, isOnList }) {
  if (!items || items.length === 0) {
    if (onRestore) return <div className="empty"><div className="big">Nothing dismissed</div>Items you dismiss will show up here so you can bring them back.</div>;
    return null;
  }
  return (
    <div style={{ marginBottom: "22px" }}>
      <div className="discover-heading">{title}</div>
      <div className="discover-scroll">
        {items.map((item) => {
          const already = isOnList && isOnList(item);
          return (
            <div key={item.id + item.type} className="discover-card" onClick={() => onPick(item)}>
              {item.posterUrl ? (
                <img src={item.posterUrl} alt="" />
              ) : (
                <div className="discover-fallback">🎬</div>
              )}
              {(onDismiss || onRestore) && (
                <button className="discover-dismiss" title={onRestore ? "Restore" : "Not interested"}
                  onClick={(ev) => { ev.stopPropagation(); onRestore ? onRestore(item) : onDismiss(item); }}>
                  {onRestore ? "↺" : "−"}
                </button>
              )}
              {already ? (
                <div className="discover-onlist">✓ On list</div>
              ) : (
                <div className="discover-add">+</div>
              )}
              <div className="discover-title">{item.title}</div>
            </div>
          );
        })}
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
        {logo && <img className="tile-service-logo" src={logo} alt={e.service} title={e.service} />}
        {e.backdropUrl ? (
          <img src={e.backdropUrl} alt="" />
        ) : (
          <div className="tile-fallback">🍿</div>
        )}
      </div>
      <div className="tile-caption">
        <div className="tile-title">{e.title}</div>
        <div className="tile-sub">
          {!logo && <span>{e.service || e.type}</span>}
          {e.episode ? <span>{e.episode}</span> : null}
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
          <button className="btn-mini" onClick={() => { if (window.confirm(`Archive "${e.title}"? You can restore it later from the Archived list.`)) onDelete(e.id); }}>Archive</button>
        </div>
      </div>
    </div>
  );
}
