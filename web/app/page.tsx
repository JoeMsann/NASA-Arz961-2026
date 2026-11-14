"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import SpaceScene from "@/components/SpaceScene";
import NavBar from "@/components/NavBar";
import Sidebar from "@/components/Sidebar";
import ConfigWindow from "@/components/ConfigWindow";
import Navigator from "@/components/Navigator";
import Compare from "@/components/Compare";
import Predictor from "@/components/Predictor";
import AskPsi from "@/components/AskPsi";
import TestTable from "@/components/TestTable";
import EarthBenefits from "@/components/EarthBenefits";
import { api, Atmos, Env } from "@/lib/api";

// One entry per sidebar section, in navbar order. `about` is the one-line question the section answers.
const TABS = [
  { id: "nav", label: "Habitat risk navigator", about: "Has NASA flown fire tests at this place's oxygen and pressure, and what is still missing?" },
  { id: "compare", label: "Compare investigations", about: "What do two investigations share, and where do their hardware, conditions and results differ?" },
  { id: "predict", label: "Flame predictor", about: "Would a small liquid-fuel flame here go out by itself, and how fast would it burn?" },
  { id: "ask", label: "Ask PSI", about: "What do NASA's test tables and reports say about your own question?" },
  { id: "table", label: "Unified test table", about: "Which tests exist, under what conditions, and how did each one end?" },
  { id: "earth", label: "Earth benefits", about: "What did this fire research give people on Earth?" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function Page() {
  const [envs, setEnvs] = useState<Env[]>([]);
  const [id, setId] = useState("iss");
  const [edit, setEdit] = useState<Partial<Atmos>>({});
  const [nav, setNav] = useState<any>(null);
  const [open, setOpen] = useState<Tab | null>(null);   // null = sidebar closed
  const [question, setQuestion] = useState("");
  const [down, setDown] = useState("");

  useEffect(() => { api<Env[]>("ml", "environments").then(setEnvs).catch((e) => setDown(e.message)); }, []);
  const env = envs.find((e) => e.id === id);
  const atmos: Atmos | null = useMemo(() => (env ? { o2_pct: env.o2_pct, pressure_psia: env.pressure_psia, gravity_g: env.gravity_g, ...edit } : null), [env, edit]);

  useEffect(() => {
    if (!atmos) return;
    const t = setTimeout(() => api("ml", "navigator", atmos).then((n) => { setNav(n); setDown(""); }).catch((e) => setDown(e.message)), 150);
    return () => clearTimeout(t);
  }, [atmos]);

  const select = (next: string) => { setId(next); setEdit({}); };
  const ask = (q: string) => { setQuestion(q); setOpen("ask"); };
  const toggle = (t: Tab) => setOpen((o) => (o === t ? null : t));
  const close = useCallback(() => setOpen(null), []);
  const needsEnv = (open === "nav" || open === "predict") && !(env && atmos);

  return (
    <>
      <SpaceScene selected={id} onSelect={select} />
      <NavBar tabs={TABS} open={open} onToggle={toggle} />
      {down && <div className="toast" role="alert">Backend not reachable: {down} Start the services with <code>docker compose up</code>.</div>}
      {env && atmos && <ConfigWindow env={env} atmos={atmos} edited={Object.keys(edit).length > 0} nav={nav} sidebarOpen={open !== null}
        onEdit={(p) => setEdit((e) => ({ ...e, ...p }))} onReset={() => setEdit({})} onOpen={setOpen} />}

      <Sidebar tab={TABS.find((t) => t.id === open) ?? null} onClose={close}>
        {needsEnv && <div className="card note">Waiting for environment data from the backend…</div>}
        {open === "nav" && env && atmos && <Navigator env={env} atmos={atmos} nav={nav} onAsk={ask} />}
        {open === "compare" && <Compare onAsk={ask} />}
        {open === "predict" && env && atmos && <Predictor env={env} atmos={atmos} />}
        {open === "ask" && <AskPsi seed={question} onSeedUsed={() => setQuestion("")} />}
        {open === "table" && <TestTable />}
        {open === "earth" && <EarthBenefits />}
      </Sidebar>

      <footer className="credit">
        Data: NASA Physical Sciences Informatics (PSI) tables and NASA Technical Reports Server. Independent NASA Space Apps 2026 project, not a NASA product.
        Research aid only: nothing here is flight-safety guidance or material approval.
      </footer>
    </>
  );
}
