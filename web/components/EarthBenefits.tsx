const ITEMS = [
  {
    title: "Water mist instead of halon",
    tag: "From microgravity combustion research",
    body: [
      "Halon extinguishing agents were banned for damaging the ozone layer. The Mist experiment on shuttle flight STS-107 tested fine water droplets as a replacement, using microgravity to hold an even mist cloud that gravity would otherwise pull apart.",
      "The team aimed its results at extinguishers for enclosed places on Earth: aircraft, ships, libraries, museums and homes.",
      "The same line of work led to the fine-water-mist extinguishers that replaced carbon-dioxide units on the space station. All nine were on board by 2016.",
    ],
    links: [
      ["NASA Glenn: Combustion Module-2 summary", "https://ntrs.nasa.gov/api/citations/20050215409/downloads/20050215409.pdf"],
      ["NTRS: Mist preliminary results", "https://ntrs.nasa.gov/citations/20040053582"],
      ["NASA Spinoff: fine-water-mist extinguisher", "https://spinoff.nasa.gov/node/11065"],
    ],
  },
  {
    title: "Smoke detectors that know smoke from dust",
    tag: "From microgravity combustion research",
    body: [
      "The Smoke Aerosol Measurement Experiment overheated common spacecraft materials and measured the smoke particles they gave off. Particle size changed a lot with the material, which is why one detector setting cannot catch everything.",
      "NASA notes that detectors built on these results could serve other sealed places on Earth, such as submarines and underwater laboratories.",
      "Researchers also described a future detector that reads particle size to tell smoke from nuisance dust.",
    ],
    links: [
      ["NASA fact sheet: SAME", "https://www.nasa.gov/wp-content/uploads/2025/07/smoke-aerosol-measurement-experiment-same.pdf"],
      ["NTRS: spacecraft fire detection requirements", "https://ntrs.nasa.gov/api/citations/20170000248/downloads/20170000248.pdf"],
      ["Phys.org: Smoke particles are not all the SAME", "https://phys.org/news/2012-01-particles.pdf"],
    ],
  },
  {
    title: "Lighter breathing gear for firefighters",
    tag: "Related NASA spinoff, not from combustion experiments",
    body: [
      "In the early 1970s NASA's Johnson Space Center adapted Apollo life-support technology into a firefighter breathing system about one-third lighter than earlier ones.",
      "Lightweight composite air cylinders developed with NASA are now standard in firefighter breathing apparatus.",
      "This comes from spacesuit and tank engineering, not from flame research. It is listed here because the challenge asks about firefighter benefits.",
    ],
    links: [
      ["Space Foundation: Improved Firefighter's Breathing System", "https://www.spacefoundation.org/space_technology_hal/improved-firefighters-breathing-system/"],
      ["NASA Spinoff: composite pressure vessels", "https://spinoff.nasa.gov/node/11031"],
      ["NASA Spinoff 1986: Space Technology for the Fire Department", "https://spinoff.nasa.gov/node/9518"],
    ],
  },
];

export default function EarthBenefits() {
  return (
    <div className="grid">
      {ITEMS.map((it) => (
        <article key={it.title} className="card">
          <span className="tag">{it.tag}</span>
          <h3 className="gap-top">{it.title}</h3>
          {it.body.map((p, i) => <p key={i}>{p}</p>)}
          <h4>Sources</h4>
          <ul className="plain">{it.links.map(([label, url]) => <li key={url}><a href={url} target="_blank" rel="noreferrer">{label}</a></li>)}</ul>
        </article>
      ))}
    </div>
  );
}
