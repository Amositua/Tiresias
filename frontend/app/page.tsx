import Link from "next/link";

// ─── Nav ──────────────────────────────────────────────────────────────────────

function Nav() {
  return (
    <nav className="fixed top-0 inset-x-0 z-50 border-b border-white/5 bg-navy-950/80 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <span className="font-serif text-xl text-cream-100 tracking-wide">
            Tiresias
          </span>
          <div className="hidden md:flex items-center gap-6 text-xs text-cream-300/50">
            <a href="#how-it-works" className="hover:text-cream-100 transition-colors">How it works</a>
            <a href="#integrations" className="hover:text-cream-100 transition-colors">Integrations</a>
            <Link href="/monitor" className="hover:text-cream-100 transition-colors">Live demo</Link>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/vp-dashboard"
            className="hidden sm:block text-xs text-cream-300/50 hover:text-cream-100 transition-colors px-3 py-1.5"
          >
            VP Dashboard
          </Link>
          <Link
            href="/monitor"
            className="text-xs bg-gold-400 hover:bg-gold-200 text-navy-950 font-semibold px-4 py-2 rounded transition-colors"
          >
            See it live →
          </Link>
        </div>
      </div>
    </nav>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-14 overflow-hidden">
      {/* Glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% 40%, rgba(201,147,58,0.07) 0%, transparent 70%)",
        }}
      />

      {/* Badge */}
      <div className="relative mb-8 flex items-center gap-2 border border-gold-400/20 bg-gold-400/5 rounded-full px-4 py-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-gold-400 animate-pulse" />
        <span className="text-[11px] text-gold-400/80 tracking-wide font-sans">
          Live — connected to real Fivetran infrastructure
        </span>
      </div>

      {/* Headline */}
      <h1 className="relative font-serif text-5xl md:text-6xl lg:text-7xl text-cream-100 text-center leading-[1.06] tracking-tight max-w-4xl">
        Catch silent data failures
        <br />
        <span className="text-gold-400">before your dashboards do.</span>
      </h1>

      {/* Sub */}
      <p className="relative mt-7 text-cream-300/60 text-lg md:text-xl text-center leading-relaxed max-w-xl font-sans">
        Tiresias monitors every Fivetran sync, detects semantic drift the moment
        it lands, and quarantines bad data at the source — automatically.
      </p>

      {/* CTAs */}
      <div className="relative mt-10 flex items-center gap-3 flex-wrap justify-center">
        <Link
          href="/monitor"
          className="bg-gold-400 hover:bg-gold-200 text-navy-950 font-semibold text-sm px-7 py-3 rounded transition-colors"
        >
          Watch a live detection →
        </Link>
        <Link
          href="/vp-dashboard"
          className="text-sm text-cream-300/60 hover:text-cream-100 border border-white/10 hover:border-white/20 px-7 py-3 rounded transition-colors"
        >
          See the impact
        </Link>
      </div>

      {/* Proof strip */}
      <div className="relative mt-16 flex items-center gap-6 md:gap-10 flex-wrap justify-center">
        {[
          "Detects drift in under 60 seconds",
          "AI-powered root cause classification",
          "Real quarantine via Fivetran MCP",
          "Human approval before every write",
        ].map((item) => (
          <div key={item} className="flex items-center gap-2">
            <span className="text-gold-400/60 text-xs">✓</span>
            <span className="text-xs text-cream-300/40 font-sans">{item}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Problem ──────────────────────────────────────────────────────────────────

function Problem() {
  return (
    <section className="border-t border-white/5 px-6 py-28">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-[11px] text-cream-300/30 uppercase tracking-[0.2em] mb-5 font-sans">
              The problem
            </p>
            <h2 className="font-serif text-4xl md:text-5xl text-cream-100 leading-tight mb-6">
              Your pipeline shows green.
              <br />
              Your data is wrong.
            </h2>
            <p className="text-cream-300/60 text-base leading-relaxed mb-5 font-sans">
              A deal stage gets renamed in your CRM. Fivetran faithfully syncs
              it. No error fires. No alert triggers. But every downstream model
              filtering on the old label now returns zero rows.
            </p>
            <p className="text-cream-300/60 text-base leading-relaxed font-sans">
              Three days later, your VP of Sales asks why the late-stage
              pipeline shows $0. That is when you find out.
            </p>
          </div>

          {/* Visual: the break */}
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-white/5 bg-navy-900/60 p-5 font-mono text-xs leading-relaxed">
              <div className="text-cream-300/30 mb-3 text-[10px] uppercase tracking-widest">
                deal_pipeline_stage.label — before sync
              </div>
              {[
                ["Contract Sent", "14.3%", true],
                ["Qualified To Buy", "14.3%", false],
                ["Appointment Scheduled", "14.3%", false],
                ["Closed Won", "14.3%", false],
              ].map(([label, pct, highlight]) => (
                <div key={String(label)} className="flex items-center gap-3 py-1">
                  <div className="flex-1 flex items-center gap-2">
                    <div
                      className={`h-1.5 rounded-full ${highlight ? "bg-gold-400" : "bg-navy-700"}`}
                      style={{ width: `${14.3 * 4}px` }}
                    />
                    <span className={highlight ? "text-gold-400" : "text-cream-300/50"}>
                      {String(label)}
                    </span>
                  </div>
                  <span className="text-cream-300/30">{String(pct)}</span>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 px-2">
              <div className="flex-1 h-px bg-white/5" />
              <span className="text-[10px] text-cream-300/30 font-mono">after sync</span>
              <div className="flex-1 h-px bg-white/5" />
            </div>

            <div className="rounded-lg border border-red-500/20 bg-navy-900/60 p-5 font-mono text-xs leading-relaxed">
              <div className="text-red-400/50 mb-3 text-[10px] uppercase tracking-widest">
                deal_pipeline_stage.label — PSI 2.14 · threshold 0.25
              </div>
              {[
                ["Contract Under Review", "14.3%", true],
                ["Qualified To Buy", "14.3%", false],
                ["Appointment Scheduled", "14.3%", false],
                ["Closed Won", "14.3%", false],
                ["Contract Sent", "0.0%", "gone"],
              ].map(([label, pct, state]) => (
                <div key={String(label)} className="flex items-center gap-3 py-1">
                  <div className="flex-1 flex items-center gap-2">
                    <div
                      className={`h-1.5 rounded-full ${state === true ? "bg-emerald-500" : state === "gone" ? "bg-red-500/40" : "bg-navy-700"}`}
                      style={{ width: state === "gone" ? "4px" : `${14.3 * 4}px` }}
                    />
                    <span className={state === true ? "text-emerald-400" : state === "gone" ? "text-red-400/60 line-through" : "text-cream-300/50"}>
                      {String(label)}
                    </span>
                  </div>
                  <span className={state === "gone" ? "text-red-400/60" : "text-cream-300/30"}>{String(pct)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Features ─────────────────────────────────────────────────────────────────

function FeatureCard({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div className="group p-7 rounded-xl border border-white/5 bg-navy-900/30 hover:bg-navy-900/60 hover:border-white/10 transition-all duration-300">
      <p className="text-[10px] text-gold-400/60 uppercase tracking-[0.2em] font-sans mb-4">
        {eyebrow}
      </p>
      <h3 className="font-serif text-xl text-cream-100 mb-3 leading-snug">{title}</h3>
      <p className="text-sm text-cream-300/55 leading-relaxed font-sans">{body}</p>
    </div>
  );
}

function Features() {
  return (
    <section id="how-it-works" className="border-t border-white/5 px-6 py-28">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-[11px] text-cream-300/30 uppercase tracking-[0.2em] font-sans mb-4">
            What Tiresias does
          </p>
          <h2 className="font-serif text-4xl md:text-5xl text-cream-100 leading-tight max-w-2xl mx-auto">
            Smarter than a schema check.
            Faster than your oncall.
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FeatureCard
            eyebrow="Always-on fingerprinting"
            title="Statistical memory of every table"
            body="On every sync, Tiresias computes a statistical fingerprint — value distributions, null rates, row counts, cardinality. It remembers what normal looks like so it can recognise what isn't."
          />
          <FeatureCard
            eyebrow="AI classification"
            title="Not just anomalous. But why."
            body="Gemini 2.0 Flash classifies every drift event: organic volume change, upstream schema addition, or silent semantic failure — the kind where your numbers are wrong but your pipeline shows green."
          />
          <FeatureCard
            eyebrow="Blast radius tracing"
            title="From broken column to broken dashboard"
            body="Tiresias traces the blast radius forward through your dbt lineage graph — which staging models break, which fact tables are compromised, which executives are looking at wrong numbers."
          />
          <FeatureCard
            eyebrow="Automatic quarantine"
            title="Close the loop. Stop the bleeding."
            body="One approval. Tiresias disables the bad table at the Fivetran source via MCP — no more corrupt data flowing downstream while your team debugs. Re-enable when the fix is deployed."
          />
        </div>
      </div>
    </section>
  );
}

// ─── How it works (simple 3-step) ────────────────────────────────────────────

function Step({
  n,
  title,
  body,
}: {
  n: string;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-5">
      <div className="flex-shrink-0 w-8 h-8 rounded-full border border-gold-400/30 flex items-center justify-center">
        <span className="text-[11px] text-gold-400/70 font-mono">{n}</span>
      </div>
      <div className="pt-0.5">
        <h3 className="text-sm font-semibold text-cream-100 mb-1.5">{title}</h3>
        <p className="text-sm text-cream-300/55 leading-relaxed font-sans">{body}</p>
      </div>
    </div>
  );
}

function HowItWorks() {
  return (
    <section className="border-t border-white/5 px-6 py-28">
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
        <div>
          <p className="text-[11px] text-cream-300/30 uppercase tracking-[0.2em] font-sans mb-5">
            The response
          </p>
          <h2 className="font-serif text-4xl text-cream-100 leading-tight mb-8">
            From sync to quarantine
            in under 90 seconds.
          </h2>
          <div className="flex flex-col gap-7">
            <Step
              n="01"
              title="Fivetran sync completes"
              body="Tiresias receives the webhook, pulls the live schema config via MCP, and computes a fresh fingerprint against your BigQuery destination."
            />
            <Step
              n="02"
              title="Drift classified by Gemini"
              body="The PSI spike is classified: Silent Semantic Failure, 95% confidence. Blast radius traced to stg_deals → fct_pipeline_by_stage → VP of Sales dashboard."
            />
            <Step
              n="03"
              title="Engineer approves. Table quarantined."
              body="One click in the Tiresias dashboard. modify_connection_table_config fires via MCP. The table is disabled at source. No more corrupt data flows downstream."
            />
          </div>
        </div>

        {/* Terminal-style log */}
        <div className="rounded-xl border border-white/5 bg-navy-900/60 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/40" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/40" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/40" />
            <span className="ml-2 text-[10px] text-cream-300/30 font-mono">tiresias · event log</span>
          </div>
          <div className="p-5 font-mono text-xs space-y-3 leading-relaxed">
            {[
              { t: "12:34:01", event: "sync_received", detail: "wanderer_financing · deal_pipeline_stage", color: "text-cream-300/50" },
              { t: "12:34:02", event: "schema_check", detail: "MCP → hubspot schema discovered", color: "text-cream-300/50" },
              { t: "12:34:04", event: "fingerprint_computed", detail: "PSI 2.14 on label · threshold 0.25", color: "text-amber-400/80" },
              { t: "12:34:06", event: "oracle_classified", detail: "SILENT_SEMANTIC_FAILURE · 95% confidence", color: "text-red-400/80" },
              { t: "12:34:06", event: "blast_radius_traced", detail: "3 models · 1 exposure · owner: VP of Sales", color: "text-cream-300/50" },
              { t: "12:34:06", event: "pending_approval", detail: "report_id: a3f9c2d1 · awaiting human gate", color: "text-gold-400/80" },
              { t: "12:35:14", event: "quarantine_executed", detail: "deal_pipeline_stage.enabled → false", color: "text-emerald-400/80" },
            ].map(({ t, event, detail, color }) => (
              <div key={event} className="flex gap-3">
                <span className="text-cream-300/25 flex-shrink-0">{t}</span>
                <span className={`flex-shrink-0 ${color}`}>{event}</span>
                <span className="text-cream-300/30 truncate">{detail}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Integrations ─────────────────────────────────────────────────────────────

function IntegrationBadge({ name, role }: { name: string; role: string }) {
  return (
    <div className="flex flex-col items-center gap-2 p-5 rounded-xl border border-white/5 bg-navy-900/30 hover:border-white/10 transition-colors text-center">
      <div className="text-sm font-semibold text-cream-100">{name}</div>
      <div className="text-[11px] text-cream-300/40 font-sans">{role}</div>
    </div>
  );
}

function Integrations() {
  return (
    <section id="integrations" className="border-t border-white/5 px-6 py-28">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-14">
          <p className="text-[11px] text-cream-300/30 uppercase tracking-[0.2em] font-sans mb-4">
            Integrations
          </p>
          <h2 className="font-serif text-4xl text-cream-100 leading-tight">
            Works with your existing stack.
          </h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          <IntegrationBadge name="Fivetran" role="MCP · pipeline source" />
          <IntegrationBadge name="BigQuery" role="Destination · fingerprints" />
          <IntegrationBadge name="dbt" role="Lineage · blast radius" />
          <IntegrationBadge name="HubSpot" role="Source · CRM data" />
          <IntegrationBadge name="Gemini" role="AI · classification" />
        </div>
        <p className="mt-6 text-center text-[11px] text-cream-300/25 font-sans">
          Snowflake, Redshift, Salesforce, and more — coming soon
        </p>
      </div>
    </section>
  );
}

// ─── CTA ──────────────────────────────────────────────────────────────────────

function CTA() {
  return (
    <section className="border-t border-white/5 px-6 py-32">
      <div className="max-w-3xl mx-auto text-center">
        <h2 className="font-serif text-5xl md:text-6xl text-cream-100 leading-tight mb-6">
          Stop finding out from
          <br />
          <span className="text-gold-400">your VP&apos;s Slack message.</span>
        </h2>
        <p className="text-cream-300/55 text-lg leading-relaxed mb-10 font-sans">
          Tiresias watches every sync. You find out first.
        </p>
        <div className="flex items-center gap-3 justify-center flex-wrap">
          <Link
            href="/monitor"
            className="bg-gold-400 hover:bg-gold-200 text-navy-950 font-semibold px-8 py-3.5 rounded text-sm transition-colors"
          >
            Watch a live detection →
          </Link>
          <Link
            href="/vp-dashboard"
            className="border border-white/10 hover:border-white/20 text-cream-300/60 hover:text-cream-100 px-8 py-3.5 rounded text-sm transition-colors"
          >
            See what&apos;s at stake
          </Link>
        </div>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="border-t border-white/5 px-6 py-10">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <span className="font-serif text-base text-cream-100">Tiresias</span>
          <span className="text-cream-300/20 text-xs font-sans">
            pre-cognitive data quality
          </span>
        </div>
        <div className="flex items-center gap-6 text-xs text-cream-300/30 font-sans">
          <Link href="/monitor" className="hover:text-cream-300/60 transition-colors">
            Live Monitor
          </Link>
          <Link href="/vp-dashboard" className="hover:text-cream-300/60 transition-colors">
            VP Dashboard
          </Link>
        </div>
      </div>
    </footer>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="bg-navy-950 text-cream-100 font-sans antialiased">
      <Nav />
      <Hero />
      <Problem />
      <Features />
      <HowItWorks />
      <Integrations />
      <CTA />
      <Footer />
    </div>
  );
}
