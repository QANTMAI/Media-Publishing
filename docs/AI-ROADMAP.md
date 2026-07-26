# AI & Platform Roadmap — fact-based (2026-07)

Synthesized from six independent, cited research passes (writing/repurposing,
video-clipping + voice/TTS, analytics + send-time, trend intelligence, reference
architecture, competitive whitespace). **Every recommendation is grounded in a
source; the "what does NOT work" calls are as important as the build list.**
Standing constraint: **Anthropic for all LLM work — never OpenAI.**

## 0. Five principles the research forced (not opinions — evidence)

1. **Freshness = RAG, never fine-tuning.** Fine-tuning "on the last 30 days" is the *wrong tool*: LLMs "struggle to learn new factual information through unsupervised fine-tuning" (Ovadia et al., [2312.05934](https://ar5iv.labs.arxiv.org/html/2312.05934)); RAG is the designed-for-freshness path (Lewis 2020; Anthropic [Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval)). Fine-tune only for *tone/format*, if ever.
2. **Trends: detect, don't predict.** Predicting virality before it moves is bounded "well below deterministic even with unlimited data" (Martin/Watts, [WWW 2016](https://arxiv.org/pdf/1602.01013); Salganik/Watts, [Science 2006](https://www.science.org/doi/abs/10.1126/science.1121066)). What *works* is velocity/burst/anomaly detection on **live** signal (Kleinberg; Google Trends "Trending Now"). Market it as detection.
3. **Numbers are never LLM-generated.** Anthropic runs ~95% of internal analytics on Claude by routing to a **semantic layer that returns deterministic numbers** — the LLM narrates, never computes ([Anthropic](https://claude.com/blog/how-anthropic-enables-self-service-data-analytics-with-claude)). Skills-as-markdown moved their accuracy 21%→95%.
4. **Brand voice = prompt + retrieval, not per-user fine-tuned models.** System-prompt style guide + 3–5 of the creator's own best posts as few-shot exemplars ([Anthropic multishot](https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/multishot-prompting)). Parameter-free, per-user by construction, instantly updatable.
5. **Voice cloning is legally load-bearing.** Consent capture, identity verification, and AI-output watermarking are **launch blockers, not v2** — the TN ELVIS Act reaches *tool distributors* ([H&K](https://www.hklaw.com/en/insights/publications/2024/04/first-of-its-kind-ai-law-addresses-deep-fakes-and-voice-clones)), and EU AI Act Art. 50 mandates machine-readable AI labeling by **Aug 2, 2026** (fines to €15M / 3% revenue).

## 1. Recommended stack by capability (real providers, honest caveats)

| Capability | Recommendation | Why / evidence | Caveats |
|---|---|---|---|
| **Writing & repurposing** | **Claude Sonnet 5** for per-channel drafting; **Haiku 4.5** for canonicalization + validators; **Opus 5 / Fable 5** for premium polish. Structured outputs (`output_config.format`) + prompt caching on the shared prefix + Batch API for bulk. | Already Anthropic-integrated (BYO-key); best voice adherence; caching ≈90% input savings across fan-out. | Structured outputs **can't** enforce char limits (no min/max) — validate in code. Sonnet 5 intro pricing ends **Aug 31 2026**. My model-lineup memory was stale — **current tier is Fable 5 / Opus 5 / Sonnet 5**, not Opus 4.8. |
| **Video clipping** | **Buy Reap API for v1** (only affordable turnkey clipping API w/ public REST + MCP); **DIY fallback**: AssemblyAI transcribe → Claude highlight-select → ffmpeg/AutoFlip reframe. | OpusClip/Vizard are UI-only (no clean API). ([Reap benchmark](https://reap.video/reports/state-of-top-ai-video-clipping-tools-2026)) | Use **forced alignment** (WAV2VEC2/MFA), not raw Whisper timestamps (200–500ms drift → misaligned captions). Single-vendor risk. |
| **Voice / TTS** | **ElevenLabs** primary (best quality + self-serve cloning + **voice-captcha consent** + No-Go-Voices + SynthID watermark); **Cartesia** if real-time; **Kokoro (Apache-2.0)** self-host for generic narration. | ElevenLabs shifts real liability upstream. ([use policy](https://elevenlabs.io/use-policy)) | **Avoid** XTTS-v2/F5-TTS (non-commercial licenses) and PlayHT (possible Meta wind-down). Consent+watermark are launch blockers (§0.5). |
| **Analytics agent** | **Claude over a semantic layer** on the existing MetricSnapshots. Deterministic metric functions; skills-as-markdown encoding per-platform gotchas; provenance footer; sample-size + freshness gates; optional adversarial-review sub-agent. | Anthropic's own 21%→95% pattern. ([Anthropic](https://claude.com/blog/how-anthropic-enables-self-service-data-analytics-with-claude)) | Reject any number not traceable to a tool result. Forbid causal language on observational data. |
| **Send-time optimization** | **v0:** per-account hour×day engagement-rate heatmap (no ML). **v1:** hybrid per-account→global fallback (ViralPost/Airship pattern). **v2:** Thompson-Sampling bandit with pooled priors from similar tenants (multi-tenant moat, solves cold-start). | LLMs are the *wrong* tool for timing; every credible STO is classical/Bayesian. ([Airship](https://www.airship.com/blog/our-machine-learning-model-for-predictive-send-time-optimization/)) | Publish-time ≠ distribution-time on algorithmic feeds — a **low ceiling**; frame as a nudge. Small accounts = guessing until data accrues. |
| **Trend intelligence** | **GDELT** (free, 15-min global events) + **Bluesky Jetstream** (free real-time firehose) + **YouTube mostPopular** (free, 1 unit/call). **Event Registry $90/mo** paid upgrade. RAG over this, velocity/burst detection, Claude to cluster+summarize retrieved signal. | These are the only **free/cheap, legal, usable-today** sources. ([data-source research](#)) | **Skip** X ($0.005/read, no free tier), Reddit (free tier forbids commercial), TikTok (academic-only), Google Trends (invite-only alpha). LLM must *read* retrieved signal, never *recall* trends from weights. |

## 2. Competitive whitespace — where to actually differentiate (fact-based)

From the market survey (Buffer/Hootsuite/Later/Sprout/Metricool/Publer/Postiz/Typefully/OpusClip/Repurpose.io):

- **(c) Unified cross-platform monetization ledger (subscriptions + ads + sponsorships + podcasts) — the CLEANEST genuine gap.** Every tool unifies its *own* silo: Beehiiv (newsletter), Passionfroot (sponsorships), Acast (podcasts). None spans all four across platforms. **Caveat: it's a data-integration problem (many APIs, some with no revenue endpoint) — that's *why* it's unfilled. Validate feasibility before betting.**
- **(a) Deep *conditional* lifecycle automation — partial gap.** Tag/category recycling is commoditized (SocialBee, MeetEdgar, Publer). Performance-driven *branching* ("if engagement > X, re-queue to Y") lives only in Zapier/Make, not social-native. Real but narrow.
- **(b) One-canvas repurposing that publishes — partial gap.** Native publishing of repurposed *video* is filled (Repurpose.io, OpusClip). The open space is **write-once → auto-adapt to every format (clip/thread/carousel) → publish everywhere** as one layer.
- **(d) Transparent flat pricing — table stakes, not a moat.** The billing complaint against Hootsuite/Sprout is real and documented, but flat pricing is already the norm among challengers (Buffer/Publer/Postiz). A required entry ticket paired with a/b/c, never the differentiator alone.

**Positioning call:** lead with **one-canvas repurpose-and-publish (b)** as the near-term wedge (it builds directly on the existing publish engine + the AI writing stack), keep **conditional lifecycle automation (a)** as the automation differentiator, and treat the **monetization ledger (c)** as the big-bet North Star pending a feasibility spike. Flat pricing (d) is just how we price.

## 3. Reference architecture — the honest evolution path

- **Data store:** SQLite+WAL+Litestream is correct for single-operator. **Postgres is the multi-tenant answer** (the app already flags this). Don't migrate until multi-writer or a real second tenant is imminent — premature otherwise.
- **Queue/worker:** the current DB-polling worker is a *correct* design. The one clearly-justified next step (once on Postgres or needing >1 worker) is **pg-boss** — Postgres+Node-native, gives exactly what we hand-rolled (SKIP LOCKED atomic claim, backoff, max-attempts) **plus cron + dead-letter queues + redrive** out of the box. **Redis/BullMQ and Temporal are premature** for single-step scheduled publishing (wait for a measured bottleneck / a real multi-step durable workflow). River is Go-only — skip.
- **Analytics pipeline:** **Postgres + materialized views** now (fine into low-tens-of-millions of event rows) → **Tinybird or PostHog** at growth → **ClickHouse** at scale. Don't buy Snowplow/ClickHouse before there's a data engineer and measured pain.
- **Multi-tenant:** shared-DB-with-tenant-column + row-level scoping is the pragmatic path (note the audit's finding that **memory routes aren't yet userId-scoped** — that's the first thing to fix before tenant #2).

## 4. Phased plan — dev → test → prod, each phase gated

Every AI-output phase ships behind the **mandatory quality gate** (§5). No phase reaches prod without: tests green in CI, the quality gate wired, a human-approval step for anything auto-published, and health/safety review.

| Phase | Scope | Depends on | Quality/safety gate |
|---|---|---|---|
| **AI-1 — Brand Voice foundation** | Per-user Brand Voice Guide (structured) + voice corpus (their own posts) indexed for retrieval; a "distill a style fingerprint" step (cache it). | Existing vault Anthropic key. | No generation yet — just capture + retrieval eval (retrieval precision before blaming the model). |
| **AI-2 — One-canvas repurposing** | Canonicalize source → "content core" (structured JSON) → prompt-cached shared prefix → **fan-out per channel** with structured outputs + code-side length validation → **drafts into the existing review inbox** (never auto-publish). | AI-1; existing draft/approve flow. | Retrieval-gate → citation-required → RAGAS-faithfulness score → **human approve before publish**. Char-limit validation in code (schema can't). |
| **AI-3 — Analytics agent** | Semantic layer over MetricSnapshots (deterministic metric fns) + skills-markdown of per-platform gotchas + provenance footers. Claude narrates, never computes. | MetricSnapshots (exists). | Reject untraceable numbers; sample-size + freshness gates; forbid causal language; adversarial-review option. |
| **AI-4 — Trend intelligence** | GDELT + Bluesky Jetstream + YouTube ingestion → velocity/burst **detection** → RAG → Claude clusters+summarizes → cited on-brand **suggestions** (drafts). | AI-1 (voice), AI-2 (repurpose). | **Abstain if no fresh signal clears recency+relevance.** Every suggestion cites source URL + timestamp; groundedness-scored; human-approved. Never predict; never recall from weights. |
| **AI-5 — Send-time optimization** | v0 heatmap → v1 hybrid fallback → v2 pooled-prior bandit. | MetricSnapshots history. | Label low-confidence/cold-start honestly; frame as a nudge; never present sub-latency data as final. |
| **AI-6 — Video/voice (gated)** | Reap clipping API; ElevenLabs voice (consent-gated). | Legal/consent infra FIRST. | **Consent capture + identity verification + SynthID/C2PA watermark + AI labeling are launch blockers** (EU deadline Aug 2 2026). |

## 5. The mandatory quality gate (retrieval-gated → cited → scored → human)

Applies to every AI *suggestion/generation* that could reach a channel:

1. **Retrieval gate (abstain by default).** If no fresh grounding clears a recency+relevance threshold → **emit nothing**. System prompt restricts Claude to provided documents + grants explicit "I don't have enough signal" ([Anthropic reduce-hallucinations](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations)).
2. **Voice conditioning (parallel).** Style from the corpus; facts only from the fact corpus — "how it sounds" and "what's true" kept separate.
3. **Citation-required generation.** Anthropic Citations API (or quote-first + retract-if-unsupported) → every claim carries source URL + timestamp; unsupported claims auto-removed.
4. **Automated groundedness score.** RAGAS faithfulness (or HHEM-2.1 in prod) + context precision; below threshold → block/downgrade.
5. **Human-in-the-loop + audit trail.** Anything published under the brand's name requires approval; store claim→(source, timestamp, score). Justified by Anthropic's own caveat that RAG *reduces but doesn't eliminate* hallucination, and the ReDeEP finding that models can ignore correct retrieved evidence.

This is a direct extension of the platform's existing posture: the memory system already enforces cited-evidence + draft-only + human-approval; AI content reuses that spine.

## 6. What NOT to build (yet) — the discipline list

- **No fine-tuning for freshness or per-user voice** — RAG + few-shot instead (§0.1, §0.4).
- **No "predict the next viral trend"** — detection only (§0.2).
- **No X / Reddit / TikTok / Google-Trends ingestion** — cost-hostile or legally closed for a bootstrapped SaaS (§1 trend row).
- **No Postgres / ClickHouse / Redis / Temporal / Snowplow migration** until a *measured* bottleneck or a real second tenant (§3).
- **No voice cloning before consent + watermark + AI-labeling infra** (§0.5).
- **No unverified vendor pricing in the business model** — every $ figure in the research is flagged "verify at the vendor's live checkout."
