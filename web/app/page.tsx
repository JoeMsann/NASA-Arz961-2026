"use client";
import { useEffect, useMemo, useState } from "react";
import SpaceScene from "@/components/SpaceScene";
import EnvPanel from "@/components/EnvPanel";
import Navigator from "@/components/Navigator";
import Predictor from "@/components/Predictor";
import AskPsi from "@/components/AskPsi";
import TestTable from "@/components/TestTable";
import EarthBenefits from "@/components/EarthBenefits";
import { api, Atmos, Env } from "@/lib/api";

const TABS = [["nav", "Habitat risk navigator"], ["predict", "Flame predictor"], ["ask", "Ask PSI"], ["table", "Unified test table"], ["earth", "Earth benefits"]] as const;
type Tab = (typeof TABS)[number][0];

export default function Page() {
  const [envs, setEnvs] = useState<Env[]>([]);
  const [id, setId] = useState("iss");
  const [edit, setEdit] = useState<Partial<Atmos>>({});
  const [nav, setNav] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("nav");
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
  const ask = (q: string) => { setQuestion(q); setTab("ask"); };

  return (
    <>
      <header>
        <h1>Flame in Freefall</h1>
        <p className="sub">Pick where the crew lives. See what NASA's microgravity fire experiments do and do not cover there.</p>
      </header>
      <main>
        {down && <div className="card bad" role="alert">Backend not reachable: {down} Start the services with <code>docker compose up</code>.</div>}
        <section className="hero">
          <SpaceScene selected={id} onSelect={select} />
          {env && atmos && <EnvPanel env={env} atmos={atmos} edited={Object.keys(edit).length > 0} nav={nav}
            onEdit={(p) => setEdit((e) => ({ ...e, ...p }))} onReset={() => setEdit({})} onEarth={() => setTab("earth")} />}
        </section>

        <nav role="tablist">
          {TABS.map(([t, label]) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{label}</button>)}
        </nav>
        {tab === "nav" && env && atmos && <Navigator env={env} atmos={atmos} nav={nav} onAsk={ask} />}
        {tab === "predict" && env && atmos && <Predictor env={env} atmos={atmos} />}
        {tab === "ask" && <AskPsi seed={question} onSeedUsed={() => setQuestion("")} />}
        {tab === "table" && <TestTable />}
        {tab === "earth" && <EarthBenefits />}
      </main>
      <footer>
        Data: NASA Physical Sciences Informatics (PSI) tables and NASA Technical Reports Server. Independent NASA Space Apps 2026 project, not a NASA product.
        Research aid only: nothing here is flight-safety guidance or material approval.
      </footer>
    </>
  );
}
