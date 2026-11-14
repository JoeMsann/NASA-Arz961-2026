"use client";
import { useEffect } from "react";
import { PANEL_ID, TabInfo, tabId } from "./Sidebar";

export default function NavBar<T extends string>({ tabs, open, onToggle }: { tabs: readonly TabInfo<T>[]; open: T | null; onToggle: (t: T) => void }) {
  // The items sit in a scrolling row when they do not fit: keep the active one in view.
  useEffect(() => {
    if (open) document.getElementById(tabId(open))?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [open]);

  return (
    <header className="navbar">
      <h1>Flame in Freefall</h1>
      <nav role="tablist" aria-label="Sections">
        {tabs.map((t) => (
          <button key={t.id} id={tabId(t.id)} role="tab" aria-selected={open === t.id} aria-controls={open === t.id ? PANEL_ID : undefined} onClick={() => onToggle(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
    </header>
  );
}
