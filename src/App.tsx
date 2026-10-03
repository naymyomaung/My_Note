import { useEffect, useMemo, useState } from "react";
import NoteEditor from "./components/NoteEditor";
import NoteList from "./components/NoteList";
import NotesGrid from "./components/NotesGrid";
import NewNoteDialog from "./components/NewNoteDialog";
import DriveSyncDialog from "./components/DriveSyncDialog";
import { MobileNav, MobileTopBar } from "./components/MobileChrome";
import { useGoogleDriveSync } from "./hooks/useGoogleDriveSync";
import { useNotes } from "./hooks/useNotes";
import { loadKnownTags, saveKnownTags } from "./services/noteStorage";

export default function App() {
  const { notes, error, createNote, updateNote, deleteNote, replaceNotes } = useNotes();
  const drive = useGoogleDriveSync(replaceNotes);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showSync, setShowSync] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showNewNote, setShowNewNote] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 9;
  const [knownTags, setKnownTags] = useState<string[]>(() => {
    try {
      return loadKnownTags();
    } catch {
      return [];
    }
  });
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [actionError, setActionError] = useState<string | null>(null);

  const sortedNotes = useMemo(
    () => [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [notes],
  );
  const filteredNotes = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return sortedNotes.filter((note) => {
      if (selectedTag !== null) {
        if (selectedTag === "") {
          if (note.tags.length > 0) return false;
        } else if (!note.tags.includes(selectedTag)) {
          return false;
        }
      }
      if (!query) return true;
      return `${note.title}\n${note.content}\n${note.tags.join(" ")}`.toLocaleLowerCase().includes(query);
    });
  }, [search, sortedNotes, selectedTag]);
  const selectedNote = notes.find((note) => note.id === selectedId) ?? null;

  const tagRows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of notes) {
      for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    for (const tag of knownTags) {
      if (!counts.has(tag)) counts.set(tag, 0);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [notes, knownTags]);
  const pageCount = Math.max(1, Math.ceil(filteredNotes.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedNotes = useMemo(
    () => filteredNotes.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredNotes, safePage],
  );

  useEffect(() => {
    setPage(1);
  }, [search, selectedTag, notes.length]);

  function handleRenameTag(oldName: string, newName: string): void {
    const cleaned = newName.trim().replace(/\s+/g, " ").slice(0, 24);
    if (!cleaned || cleaned.toLowerCase() === oldName.toLowerCase()) return;
    if ([...knownTags, ...notes.flatMap((note) => note.tags)]
      .some((tag) => tag.toLowerCase() !== oldName.toLowerCase() && tag.toLowerCase() === cleaned.toLowerCase())) {
      setActionError(`Tag “${cleaned}” already exists.`);
      return;
    }
    const nextKnown = knownTags.map((tag) => tag === oldName ? cleaned : tag);
    try {
      saveKnownTags(nextKnown);
    } catch {
      setActionError("The tag could not be renamed in this browser.");
      return;
    }
    setKnownTags(nextKnown);
    if (selectedTag === oldName) setSelectedTag(cleaned);
    const now = new Date().toISOString();
    replaceNotes(notes.map((note) =>
      note.tags.includes(oldName)
        ? { ...note, tags: note.tags.map((tag) => tag === oldName ? cleaned : tag), updatedAt: now }
        : note,
    ));
    drive.invalidatePreview();
  }

  function handleDeleteTag(name: string): void {
    const affected = notes.filter((note) => note.tags.includes(name));
    const nextKnown = knownTags.filter((tag) => tag !== name);
    try {
      saveKnownTags(nextKnown);
    } catch {
      setActionError("The tag could not be deleted in this browser.");
      return;
    }
    setKnownTags(nextKnown);
    if (selectedTag === name) setSelectedTag(null);
    if (affected.length > 0) {
      const now = new Date().toISOString();
      replaceNotes(notes.map((note) =>
        note.tags.includes(name)
          ? { ...note, tags: note.tags.filter((tag) => tag !== name), updatedAt: now }
          : note,
      ));
      drive.invalidatePreview();
    }
  }

  function handleCreateTag(name: string): void {
    const cleaned = name.trim().replace(/\s+/g, " ").slice(0, 24);
    if (!cleaned) return;
    const match = [...knownTags, ...notes.flatMap((note) => note.tags)]
      .find((tag) => tag.toLowerCase() === cleaned.toLowerCase());
    const finalName = match ?? cleaned;
    if (!match) {
      const next = [...knownTags, cleaned];
      try {
        saveKnownTags(next);
      } catch {
        setActionError("The tag could not be saved in this browser.");
        return;
      }
      setKnownTags(next);
    }
    setSelectedTag(finalName);
    setSelectedId(null);
  }

  function handleCreate(): void {
    setShowNewNote(true);
    setDrawerOpen(false);
  }

  function confirmCreate(title: string, tags: string[]): void {
    setSelectedId(createNote({ title, tags }));
    setSearch("");
    setSelectedTag(null);
    setShowNewNote(false);
    setDrawerOpen(false);
    drive.invalidatePreview();
  }

  function goHome(): void {
    setSelectedId(null);
    setSelectedTag(null);
    setSearch("");
    setDrawerOpen(false);
  }

  function handleDelete(everywhere: boolean): void {
    if (!selectedNote) return;
    const remaining = sortedNotes.filter((note) => note.id !== selectedNote.id);
    try {
      if (everywhere) drive.recordDeletion(selectedNote);
      else drive.recordLocalOnlyDeletion(selectedNote);
    } catch {
      setActionError("The note could not be queued for safe Google Drive deletion, so it was not removed.");
      return;
    }
    deleteNote(selectedNote.id);
    drive.invalidatePreview();
    setSelectedId(remaining[0]?.id ?? null);
  }

  function handleGridDelete(id: string, everywhere: boolean): void {
    const target = notes.find((note) => note.id === id);
    if (!target) return;
    try {
      if (everywhere) drive.recordDeletion(target);
      else drive.recordLocalOnlyDeletion(target);
    } catch {
      setActionError("The note could not be queued for safe Google Drive deletion, so it was not removed.");
      return;
    }
    deleteNote(id);
    drive.invalidatePreview();
  }

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent): void {
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier) return;
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        handleCreate();
      } else if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>(".search-box input")?.focus();
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  useEffect(() => {
    function updateOnlineState(): void {
      setIsOnline(navigator.onLine);
    }
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);
    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("offline", updateOnlineState);
    };
  }, []);

  useEffect(() => {
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
        setActionError("Offline app caching could not be enabled in this browser.");
      });
    }
  }, []);

  useEffect(() => {
    if (selectedId && !notes.some((note) => note.id === selectedId)) {
      setSelectedId(null);
    }
  }, [notes, selectedId]);

  return (
    <div className={`app-shell${sidebarOpen ? "" : " sidebar-hidden"}${drawerOpen ? " drawer-open" : ""}`}>
      <MobileTopBar onMenu={() => setDrawerOpen(true)} onSync={() => { setShowSync(true); setActionError(null); }} />
      {drawerOpen && <div className="drawer-scrim" role="presentation" onClick={() => setDrawerOpen(false)} />}
      {!sidebarOpen && (
        <button className="sidebar-show" onClick={() => setSidebarOpen(true)} aria-label="Show sidebar" title="Show sidebar">☰</button>
      )}
      <NoteList
        search={search}
        onSearchChange={setSearch}
        onCreate={handleCreate}
        onOpenSync={() => { setShowSync(true); setActionError(null); }}
        onToggleSidebar={() => { setSidebarOpen(false); setDrawerOpen(false); }}
        tagRows={tagRows}
        selectedTag={selectedTag}
        onSelectTag={(tag) => { setSelectedTag(tag); setSelectedId(null); setDrawerOpen(false); }}
        onCreateTag={handleCreateTag}
        onRenameTag={handleRenameTag}
        onDeleteTag={handleDeleteTag}
        isOnline={isOnline}
      />
      <MobileNav
        onHome={goHome}
        onCreate={handleCreate}
        onTags={() => setDrawerOpen(true)}
        onSync={() => { setShowSync(true); setActionError(null); }}
      />
      <section className="workspace">
        {(error || actionError || drive.error) && <div className="storage-error" role="alert">{error ?? actionError ?? drive.error}</div>}
        {selectedNote ? (
          <NoteEditor
            key={selectedNote.id}
            note={selectedNote}
            onUpdate={(updates) => {
              updateNote(selectedNote.id, updates);
              drive.invalidatePreview();
            }}
            onDelete={handleDelete}
            onBack={() => setSelectedId(null)}
            willDeleteRemote={drive.isSyncedNote(selectedNote.id)}
          />
        ) : notes.length > 0 ? (
          <NotesGrid
            notes={pagedNotes}
            totalCount={notes.length}
            filteredCount={filteredNotes.length}
            search={search}
            onSearchChange={setSearch}
            page={safePage}
            pageCount={pageCount}
            onPage={setPage}
            selectedTag={selectedTag}
            onClearTag={() => setSelectedTag(null)}
            onSelect={setSelectedId}
            onCreate={handleCreate}
            onDeleteNote={handleGridDelete}
          />
        ) : (
          <Welcome onCreate={handleCreate} hasNotes={false} />
        )}
      </section>
      {showNewNote && (
        <NewNoteDialog
          existingTags={tagRows.map((row) => row.name)}
          onClose={() => setShowNewNote(false)}
          onConfirm={confirmCreate}
        />
      )}
      {showSync && (
        <DriveSyncDialog
          notes={notes}
          controller={drive}
          onClose={() => setShowSync(false)}
          onReplaceNotes={(nextNotes) => {
            const nextIds = new Set(nextNotes.map((note) => note.id));
            drive.recordDeletions(notes.filter((note) => !nextIds.has(note.id)));
            drive.invalidatePreview();
            replaceNotes(nextNotes);
            setSelectedId((current) => current && nextNotes.some((note) => note.id === current) ? current : null);
          }}
        />
      )}
    </div>
  );
}

function Welcome({ onCreate, hasNotes }: { onCreate: () => void; hasNotes: boolean }) {
  return (
    <main className="welcome">
      <div className="welcome-content">
        <div className="welcome-icon" aria-hidden="true">✳</div>
        <p className="eyebrow">{hasNotes ? "YOUR NOTES, YOUR SPACE" : "A LITTLE SPACE TO THINK"}</p>
        <h1>{hasNotes ? "Pick up where you left off." : "A quiet place for your thoughts."}</h1>
        <p className="welcome-description">
          {hasNotes
            ? "Choose a note from your library, or start a fresh page."
            : "Capture an idea, make a list, or just start writing. Your notes stay right here on this device."}
        </p>
        <button className="welcome-button" onClick={onCreate}>Create your first note <span aria-hidden="true">↗</span></button>
        <div className="welcome-footnote"><span className="status-dot" /> Private by nature. Saved locally.</div>
      </div>
      <div className="welcome-decoration decoration-one" />
      <div className="welcome-decoration decoration-two" />
    </main>
  );
}
