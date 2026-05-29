import Link from "next/link";

// ── Shared primitives ─────────────────────────────────────────────────────────

function Divider() {
  return <div className="w-full h-px bg-navy-700" />;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] text-cream-300/40 uppercase tracking-[0.2em] font-sans mb-4">
      {children}
    </p>
  );
}

// ── Nav ───────────────────────────────────────────────────────────────────────

function Nav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 h-14 border-b border-navy-700 bg-navy-950/90 backdrop-blur-sm">
      <span className="font-serif text-lg text-cream-100 tracking-wide">Tiresias</span>
      <div className="flex items-center gap-6">
        <Link
          href="/vp-dashboard"
          className="text-xs text-cream-300/50 hover:text-cream-100 transition-colors tracking-wide"
        >
          VP Dashboard
        </Link>
        <Link
          href="/monitor"
          className="text-xs bg-gold-400 hover:bg-gold-200 text-navy-950 font-semibold px-4 py-1.5 rounded transition-colors tracking-wide"
        >
          Live Monitor →
        </Link>
      </div>
    </nav>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="min-h-screen flex flex-col items-center justify-center px-6 pt-14 text-center">
      <p className="text-[11px] text-gold-400/80 uppercase tracking-[0.25em] mb-8 font-sans">
        Google Cloud Rapid Agent Hackathon · Fivetran Partner Track
      </p>

      <h1 className="font-serif text-6xl md:text-7xl lg:text-8xl text-cream-100 leading-[1.05] tracking-tight max-w-4xl">
        Everything synced.
        <br />
        Everything green.
        <br />
        <span className="text-gold-400">Everything wrong.</span>
      </h1>

      <p className="mt-8 text-cream-300/70 text-lg md:text-xl leading-relaxed max-w-2xl font-sans">
        Tiresias detects silent semantic failures in your Fivetran pipelines
        before they reach your executives — and closes the loop automatically
        via MCP.
      </p>

      <div className="mt-12 flex items-center gap-4 flex-wrap justify-center">
        <Link
          href="/monitor"
          className="bg-gold-400 hover:bg-gold-200 text-navy-950 font-semibold text-sm px-7 py-3 rounded transition-colors tracking-wide"
        >
          Watch the live demo →
        </Link>
        <Link
          href="/vp-dashboard"
          className="border border-navy-700 hover:border-cream-300/30 text-cream-300/70 hover:text-cream-100 text-sm px-7 py-3 rounded transition-colors tracking-wide"
        >
          VP pipeline dashboard
        </Link>
      </div>

      <div className="mt-20 flex items-center gap-8 text-[11px] text-cream-300/30 uppercase tracking-widest font-sans flex-wrap justify-center">
        <span>Fivetran MCP</span>
        <span className="text-navy-700">·</span>
        <span>Google BigQuery</span>
        <span className="text-navy-700">·</span>
        <span>Gemini 2.0 Flash</span>
        <span className="text-navy-700">·</span>
        <span>dbt</span>
        <span className="text-navy-700">·</span>
        <span>Python</span>
      </div>
    </section>
  );
}

// ── Incident ──────────────────────────────────────────────────────────────────

function IncidentStep({
  step,
  title,
  body,
  highlight,
}: {
  step: string;
  title: string;
  body: string;
  highlight?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-2 p-6 rounded border ${highlight ? "border-gold-400/30 bg-navy-900" : "border-navy-700 bg-navy-900/40"}`}>
      <div className="text-[10px] text-cream-300/30 uppercase tracking-widest font-mono">{step}</div>
      <div className={`font-serif text-lg leading-snug ${highlight ? "text-gold-400" : "text-cream-100"}`}>
        {title}
      </div>
      <p className="text-xs text-cream-300/60 leading-relaxed font-sans">{body}</p>
    </div>
  );
}

function Incident() {
  return (
    <section className="px-6 py-24 max-w-5xl mx-auto w-full">
      <SectionLabel>The scenario</SectionLabel>
      <h2 className="font-serif text-4xl text-cream-100 mb-4 leading-tight">
        One rename. Three days of wrong data.
      </h2>
      <p className="text-cream-300/60 text-base leading-relaxed mb-14 max-w-2xl font-sans">
        A deal stage is renamed in HubSpot. Fivetran faithfully syncs the
        change. No error. No alert. Every downstream model that filters on that
        label quietly returns zero rows. The VP of Sales opens the pipeline
        dashboard to find $0.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-start">
        <IncidentStep
          step="01 · HubSpot"
          title='"Contract Sent" renamed'
          body='An ops admin renames the deal stage to "Contract Under Review" in HubSpot settings.'
        />
        <div className="hidden md:flex items-center justify-center pt-10 text-navy-700 text-2xl">→</div>
        <IncidentStep
          step="02 · Fivetran"
          title="Sync completes. Status: OK."
          body="Fivetran syncs the change to BigQuery. The connector shows green. No schema error. No anomaly flagged."
        />
        <div className="hidden md:flex items-center justify-center pt-10 text-navy-700 text-2xl">→</div>
        <IncidentStep
          step="03 · Dashboard"
          title="Late-stage pipeline: $0"
          highlight
          body='Every dbt model filters WHERE stage_label = "Contract Sent". The label no longer exists. The result is zero. Nobody knows why.'
        />
      </div>

      <div className="mt-8 p-5 rounded border border-navy-700 bg-navy-900/40">
        <p className="text-xs font-mono text-cream-300/50 leading-relaxed">
          <span className="text-red-400">-- This query silently returns $0 after the rename</span>
          {"\n"}
          SELECT SUM(d.property_amount) FROM hubspot.deal d
          {"\n"}
          JOIN hubspot.deal_pipeline_stage s ON d.deal_pipeline_stage_id = s.stage_id
          {"\n"}
          WHERE s.label = <span className="text-gold-400">&apos;Contract Sent&apos;</span>
          <span className="text-red-400">  -- this label no longer exists</span>
        </p>
      </div>
    </section>
  );
}

// ── Three horizons ────────────────────────────────────────────────────────────

function HorizonCard({
  horizon,
  label,
  title,
  body,
  items,
}: {
  horizon: string;
  label: string;
  title: string;
  body: string;
  items: string[];
}) {
  return (
    <div className="flex flex-col gap-4 p-7 rounded border border-navy-700 bg-navy-900/40 hover:border-cream-300/20 transition-colors">
      <div className="flex items-center gap-3">
        <div className="text-[10px] text-gold-400/60 uppercase tracking-[0.2em] font-sans">{horizon}</div>
        <div className="flex-1 h-px bg-navy-700" />
      </div>
      <div className="text-[11px] text-cream-300/40 uppercase tracking-widest font-sans">{label}</div>
      <h3 className="font-serif text-2xl text-cream-100 leading-snug">{title}</h3>
      <p className="text-sm text-cream-300/60 leading-relaxed font-sans">{body}</p>
      <ul className="space-y-1.5 mt-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-xs text-cream-300/50 font-sans">
            <span className="text-gold-400/60 mt-0.5 flex-shrink-0">—</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ThreeHorizons() {
  return (
    <section className="px-6 py-24 max-w-5xl mx-auto w-full">
      <SectionLabel>How Tiresias works</SectionLabel>
      <h2 className="font-serif text-4xl text-cream-100 mb-4 leading-tight">
        Three time horizons. One closed loop.
      </h2>
      <p className="text-cream-300/60 text-base leading-relaxed mb-14 max-w-2xl font-sans">
        Most data quality tools react. Tiresias anticipates — by watching the
        past, inspecting the present, and reasoning about the future on every
        sync.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <HorizonCard
          horizon="Past"
          label="Memory"
          title="Statistical fingerprint of your data"
          body="Tiresias queries BigQuery for the last 30 days of synced data and builds a fingerprint of each table: value distributions, null rates, cardinality, row count growth."
          items={[
            "PSI (Population Stability Index) per column",
            "Categorical distribution tracking",
            "Row count z-score over rolling window",
            "Schema hash for structural changes",
          ]}
        />
        <HorizonCard
          horizon="Present"
          label="Schema"
          title="Live inspection via Fivetran MCP"
          body="On every sync, Tiresias uses the official Fivetran MCP server to inspect the live schema config — which tables are enabled, what columns exist, what changed."
          items={[
            "get_connection_schema_config — read-only",
            "Discovers schema name dynamically",
            "Detects column additions and removals",
            "No REST fallback — real MCP calls only",
          ]}
        />
        <HorizonCard
          horizon="Future"
          label="Oracle"
          title="Gemini classifies, traces, and acts"
          body="When drift is detected, Gemini 2.0 Flash classifies it — organic drift, schema change, or silent semantic failure — then traces the blast radius forward through your dbt lineage graph."
          items={[
            "SILENT_SEMANTIC_FAILURE → quarantine",
            "Blast radius: source → models → dashboards",
            "Owner attribution (VP of Sales, etc.)",
            "Human-approval gate before any MCP write",
          ]}
        />
      </div>
    </section>
  );
}

// ── The loop ──────────────────────────────────────────────────────────────────

function LoopStep({
  n,
  label,
  desc,
}: {
  n: string;
  label: string;
  desc: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] text-gold-400/50 font-mono uppercase tracking-widest">{n}</div>
      <div className="text-sm font-semibold text-cream-100 tracking-wide">{label}</div>
      <div className="text-xs text-cream-300/50 leading-relaxed font-sans">{desc}</div>
    </div>
  );
}

function TheLoop() {
  const steps = [
    { n: "01", label: "Detect", desc: "PSI spike on deal_pipeline_stage.label — 2.14 vs threshold 0.25" },
    { n: "02", label: "Reason", desc: "Gemini classifies: SILENT_SEMANTIC_FAILURE, confidence 95%" },
    { n: "03", label: "Trace", desc: "Blast radius: stg_deals → fct_pipeline_by_stage → VP of Sales dashboard" },
    { n: "04", label: "Approve", desc: "Engineer reviews Oracle's verdict and clicks Approve in the dashboard" },
    { n: "05", label: "Act", desc: "modify_connection_table_config via MCP — table quarantined at source" },
  ];

  return (
    <section className="px-6 py-24 max-w-5xl mx-auto w-full">
      <SectionLabel>The pipeline</SectionLabel>
      <h2 className="font-serif text-4xl text-cream-100 mb-4 leading-tight">
        Detect. Reason. Trace. Approve. Act.
      </h2>
      <p className="text-cream-300/60 text-base leading-relaxed mb-14 max-w-2xl font-sans">
        Tiresias does not just alert. She proposes the fix — disabling the
        table at the Fivetran source via MCP — and executes it the moment a
        human approves. The loop closes in under a minute.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-0 border border-navy-700 rounded overflow-hidden">
        {steps.map((s, i) => (
          <div
            key={s.n}
            className={`p-6 flex flex-col gap-3 ${i < steps.length - 1 ? "border-b md:border-b-0 md:border-r border-navy-700" : ""}`}
          >
            <LoopStep {...s} />
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Architecture ──────────────────────────────────────────────────────────────

function ArchRow({
  layer,
  tech,
  role,
}: {
  layer: string;
  tech: string;
  role: string;
}) {
  return (
    <div className="grid grid-cols-3 gap-6 py-4 border-b border-navy-700 last:border-0">
      <div className="text-[11px] text-cream-300/40 uppercase tracking-widest font-sans pt-0.5">{layer}</div>
      <div className="text-sm font-mono text-cream-100">{tech}</div>
      <div className="text-xs text-cream-300/60 font-sans leading-relaxed">{role}</div>
    </div>
  );
}

function Architecture() {
  return (
    <section className="px-6 py-24 max-w-5xl mx-auto w-full">
      <SectionLabel>Architecture</SectionLabel>
      <h2 className="font-serif text-4xl text-cream-100 mb-14 leading-tight">
        Built on real infrastructure.
      </h2>

      <div className="border border-navy-700 rounded overflow-hidden bg-navy-900/30">
        <div className="grid grid-cols-3 gap-6 px-6 py-3 border-b border-navy-700 bg-navy-900/60">
          <div className="text-[10px] text-cream-300/30 uppercase tracking-widest">Layer</div>
          <div className="text-[10px] text-cream-300/30 uppercase tracking-widest">Technology</div>
          <div className="text-[10px] text-cream-300/30 uppercase tracking-widest">Role</div>
        </div>
        <div className="px-6">
          <ArchRow layer="Pipeline" tech="Fivetran MCP" role="Official MCP server — schema inspection and table quarantine via modify_connection_table_config" />
          <ArchRow layer="Destination" tech="Google BigQuery" role="Fingerprint computation and storage — live PSI scoring against 7-day rolling baseline" />
          <ArchRow layer="AI" tech="Gemini 2.0 Flash" role="Structured drift classification with confidence score, blast radius summary, and recommended action" />
          <ArchRow layer="Lineage" tech="dbt manifest" role="Dependency graph parsed at startup — BFS from source table to exposures with owner attribution" />
          <ArchRow layer="Orchestration" tech="Python / FastAPI" role="Multi-agent loop: Memory → Lineage → Oracle → MCP, with human-in-the-loop approval gate" />
          <ArchRow layer="Frontend" tech="Next.js 14" role="Live monitoring dashboard and VP pipeline view — polling real backend, no mocked data" />
        </div>
      </div>
    </section>
  );
}

// ── CTA ───────────────────────────────────────────────────────────────────────

function CTA() {
  return (
    <section className="px-6 py-32 max-w-5xl mx-auto w-full text-center">
      <SectionLabel>Live demo</SectionLabel>
      <h2 className="font-serif text-5xl md:text-6xl text-cream-100 mb-6 leading-tight">
        See it fire. Right now.
      </h2>
      <p className="text-cream-300/60 text-lg leading-relaxed mb-12 max-w-xl mx-auto font-sans">
        Rename a deal stage in HubSpot. Sync Fivetran. Watch Tiresias detect
        the PSI spike, trace the blast radius to the VP of Sales dashboard, and
        execute the quarantine — all in under 90 seconds.
      </p>
      <div className="flex items-center gap-4 justify-center flex-wrap">
        <Link
          href="/monitor"
          className="bg-gold-400 hover:bg-gold-200 text-navy-950 font-semibold px-8 py-3.5 rounded text-sm transition-colors tracking-wide"
        >
          Launch monitoring dashboard →
        </Link>
        <Link
          href="/vp-dashboard"
          className="border border-navy-700 hover:border-cream-300/30 text-cream-300/60 hover:text-cream-100 px-8 py-3.5 rounded text-sm transition-colors tracking-wide"
        >
          VP pipeline dashboard
        </Link>
      </div>
    </section>
  );
}

// ── Footer ────────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-navy-700 px-8 py-8 flex items-center justify-between">
      <div>
        <span className="font-serif text-base text-cream-100">Tiresias</span>
        <span className="text-cream-300/30 text-xs ml-3 font-sans">
          pre-cognitive data quality
        </span>
      </div>
      <div className="flex items-center gap-6 text-[11px] text-cream-300/30 uppercase tracking-widest font-sans">
        <Link href="/monitor" className="hover:text-cream-300/60 transition-colors">Monitor</Link>
        <Link href="/vp-dashboard" className="hover:text-cream-300/60 transition-colors">VP Dashboard</Link>
      </div>
    </footer>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-navy-950 text-cream-100 font-sans">
      <Nav />

      <main>
        <Hero />
        <Divider />
        <Incident />
        <Divider />
        <ThreeHorizons />
        <Divider />
        <TheLoop />
        <Divider />
        <Architecture />
        <Divider />
        <CTA />
      </main>

      <Footer />
    </div>
  );
}
