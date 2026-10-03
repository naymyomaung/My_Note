import { useEffect, useMemo, useState } from "react";
import NoteEditor from "./components/NoteEditor";
import NoteList from "./components/NoteList";
import SyncDialog from "./components/SyncDialog";
import { useGitHubSync } from "./hooks/useGitHubSync";
import { useNotes } from "./hooks/useNotes";
import { loadTheme, saveTheme } from "./services/noteStorage";

export default function App() {
  const { notes, error, createNote, updateNote, deleteNote, replaceNotes } = useNotes();
  const github = useGitHubSync(replaceNotes);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showSync, setShowSync] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => loadTheme());
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [actionError, setActionError] = useState<string | null>(null);

  const sortedNotes = useMemo(
    () => [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [notes],
  );
  const filteredNotes = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return sortedNotes;
    return sortedNotes.filter((note) =>
      `${note.title}\n${note.content}`.toLocaleLowerCase().includes(query),
    );
  }, [search, sortedNotes]);
  const selectedNote = notes.find((note) => note.id === selectedId) ?? null;

  function handleCreate(): void {
    setSelectedId(createNote());
    setSearch("");
    github.invalidatePreview();
  }

  function handleDelete(): void {
    if (!selectedNote) return;
    const remaining = sortedNotes.filter((note) => note.id !== selectedNote.id);
    try {
      github.recordDeletion(selectedNote);
    } catch {
      setActionError("The note could not be queued for safe GitHub deletion, so it was not removed.");
      return;
    }
    deleteNote(selectedNote.id);
    github.invalidatePreview();
    setSelectedId(remaining[0]?.id ?? null);
  }

  function toggleTheme(): void {
    const nextTheme = theme === "dark" ? "light" : "dark";
    try {
      saveTheme(nextTheme);
      setTheme(nextTheme);
    } catch {
      setActionError("Your theme preference could not be saved in this browser.");
    }
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
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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
    <div className={`app-shell${theme === "dark" ? " theme-dark" : ""}`}>
      <NoteList
        notes={filteredNotes}
        selectedId={selectedId}
        search={search}
        onSearchChange={setSearch}
        onSelect={setSelectedId}
        onCreate={handleCreate}
        onOpenSync={() => { setShowSync(true); setActionError(null); }}
        onToggleTheme={toggleTheme}
        isDark={theme === "dark"}
        isOnline={isOnline}
      />
      <section className="workspace">
        {(error || actionError || github.error) && <div className="storage-error" role="alert">{error ?? actionError ?? github.error}</div>}
        {selectedNote ? (
          <NoteEditor
            key={selectedNote.id}
            note={selectedNote}
            onUpdate={(updates) => {
              updateNote(selectedNote.id, updates);
              github.invalidatePreview();
            }}
            onDelete={handleDelete}
            willDeleteRemote={github.isSyncedNote(selectedNote.id)}
          />
        ) : (
          <Welcome onCreate={handleCreate} hasNotes={notes.length > 0} />
        )}
      </section>
      {showSync && (
        <SyncDialog
          notes={notes}
          controller={github}
          onClose={() => setShowSync(false)}
          onReplaceNotes={(nextNotes) => {
            const nextIds = new Set(nextNotes.map((note) => note.id));
            github.recordDeletions(notes.filter((note) => !nextIds.has(note.id)));
            github.invalidatePreview();
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
