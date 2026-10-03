interface MobileChromeProps {
  onHome: () => void;
  onCreate: () => void;
  onTags: () => void;
  onSync: () => void;
}

export function MobileTopBar() {
  return (
    <header className="mobile-topbar">
      <span className="mobile-brand"><img className="brand-logo mobile-logo" src={`${import.meta.env.BASE_URL}logo.jfif`} alt="My Note logo" /> my notes</span>
    </header>
  );
}

export function MobileNav({ onHome, onCreate, onTags, onSync }: Pick<MobileChromeProps, "onHome" | "onCreate" | "onTags" | "onSync">) {
  return (
    <nav className="mobile-nav" aria-label="Primary">
      <button onClick={onHome}>
        <svg aria-hidden="true" className="mobile-nav-icon" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 3.75h8l4 4v12.5H6z" />
          <path d="M14 3.75v4h4M9 12h6M9 15.5h6" />
        </svg>
        <span>Notes</span>
      </button>
      <button onClick={onTags}>
        <span aria-hidden="true" className="mobile-nav-icon">#</span>
        <span>Tags</span>
      </button>
      <button className="mobile-nav-fab" onClick={onCreate} aria-label="New note">
        <span aria-hidden="true">＋</span>
      </button>
      <button onClick={onSync}>
        <span aria-hidden="true" className="mobile-nav-icon">☁</span>
        <span>Sync</span>
      </button>
    </nav>
  );
}
