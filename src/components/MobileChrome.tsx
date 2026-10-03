interface MobileChromeProps {
  onMenu: () => void;
  onHome: () => void;
  onCreate: () => void;
  onTags: () => void;
  onSync: () => void;
}

export function MobileTopBar({ onMenu, onSync }: Pick<MobileChromeProps, "onMenu" | "onSync">) {
  return (
    <header className="mobile-topbar">
      <button className="mobile-icon-button" onClick={onMenu} aria-label="Open menu">☰</button>
      <span className="mobile-brand"><span className="brand-mark" aria-hidden="true">n</span> my notes</span>
      <button className="mobile-icon-button" onClick={onSync} aria-label="Sync">☁</button>
    </header>
  );
}

export function MobileNav({ onHome, onCreate, onTags, onSync }: Omit<MobileChromeProps, "onMenu">) {
  return (
    <nav className="mobile-nav" aria-label="Primary">
      <button onClick={onHome}>
        <span aria-hidden="true" className="mobile-nav-icon">⌂</span>
        <span>Home</span>
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
