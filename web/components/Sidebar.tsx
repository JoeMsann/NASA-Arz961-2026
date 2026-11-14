"use client";
import { ReactNode, useEffect, useRef } from "react";

export interface TabInfo<T extends string = string> { id: T; label: string; about: string }
export const tabId = (id: string) => `tab-${id}`;
export const PANEL_ID = "section-panel";

/** The right-hand panel every section opens in. `tab` is the open section, or null when closed. */
export default function Sidebar({ tab, onClose, children }: { tab: TabInfo | null; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  const last = useRef<string | null>(null);
  const open = tab?.id ?? null;

  // Focus moves into the panel when it opens and back to its navbar item when it closes.
  useEffect(() => {
    if (open && !last.current) panel.current?.focus();
    if (!open && last.current) document.getElementById(tabId(last.current))?.focus();
    last.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!tab) return null;
  return (
    <section ref={panel} id={PANEL_ID} className="sidebar" role="tabpanel" aria-labelledby={tabId(tab.id)} tabIndex={-1}>
      <header className="sidebar-head">
        <div>
          <h2>{tab.label}</h2>
          <p className="note">{tab.about}</p>
        </div>
        <button className="icon" aria-label="Close panel" onClick={onClose}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </header>
      <div key={tab.id} className="sidebar-body">{children}</div>
    </section>
  );
}
