# AI Prospecting Engine — Architecture & Phased Plan

Status: **DRAFT — awaiting approval. No implementation yet.**
First product: real estate CRM + transaction management SaaS. First market: Utah.
Design goal: one engine, many SaaS products ("products" are configuration, not code).

---

## 1. Recommended architecture (simplest thing that works)

```
┌──────────────────────── Vercel (one Next.js app) ────────────────────────┐
│  UI (App Router, Tailwind)        API routes / server actions            │
│  - Dashboard  - Prospects         - CSV import     - Claude calls        │
│  - Review queue - Campaigns       - Gmail send     - Unsubscribe page    │
│                                                                          │
│  Vercel Cron (every 5–15 min) ──► /api/cron/* : pulls small batches      │
│      from a Postgres `jobs` table (research, qualify, draft, send,       │
│      poll replies). No separate worker, no Redis, no queue service.      │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │
        ┌──────────────────────┼──────────────────────────┐
        ▼                      ▼                          ▼
  Supabase                Claude API                 Gmail API
  - Postgres (+RLS)       - structured outputs       (Google Workspace
  - Auth (you + team)     - web_fetch / web_search    mailbox on a separate
  - Storage (CSV files)   - Message Batches (50%)     outreach domain)
```

Key choices:

| Concern | Choice | Why |
|---|---|---|
| App | Single Next.js (TypeScript) repo on Vercel | One deploy, one codebase |
| Data | Supabase Postgres, Auth, Storage | Managed, cheap, RLS for future multi-tenant |
| Background work | Vercel Cron + `jobs` table (row-locked with `FOR UPDATE SKIP LOCKED`) | No extra infrastructure; easy to inspect and retry |
| AI | Anthropic SDK (`@anthropic-ai/sdk`), structured JSON outputs, prompt caching, Batches API for bulk qualification | Deterministic schemas; cheap bulk runs |
| Sending | Gmail API from a real Google Workspace mailbox | Best deliverability at low volume; replies land in a real inbox; most transactional ESPs (Postmark, etc.) prohibit cold outreach |
| Replies | Gmail API polling every 10 min (thread-ID matching) | Simpler than Pub/Sub push; fine at this volume |
| Scheduling | Calendly or Cal.com link in messages (webhook in Phase 4) | Zero build |
| Multi-product | `products` table holds ICP, rubric, value props, approved claims, sender identity | New SaaS = new config row, not new code |

Explicitly **not** included: separate backend service, Redis/queues, vector DB, scraping fleet, LangChain/agent frameworks, data warehouse.

---

## 2. Legitimate prospect data sources

### Use
| Source | What it gives | Notes / constraints |
|---|---|---|
| **Utah Division of Real Estate licensee records** | Licensee name, license type/status, affiliated brokerage | Public record. Check whether a bulk export exists; otherwise file a GRAMA records request. Lets us count licensees per brokerage (verified brokerage size, *not* team size). Usually no emails. |
| **Utah Division of Corporations business search** | Registered team/brokerage entities, registered agent, status | Public; confirms a team operates as a business. |
| **The prospect's own website** (team page, contact page, About) | Team name, agents listed, published business email/phone, services | Primary source for contact info and team size. Fetch only public pages; respect robots.txt; store URL + date. |
| **Brokerage websites' public agent rosters** | Agent → brokerage/team mapping | Check each site's terms/robots; low-frequency, per-prospect fetches only. |
| **Google Places API** | Business name, website, phone, address, place_id | Official API. ToS limits long-term storage of Places content — store `place_id` and re-verify from the business's own site. |
| **Hunter.io (or Apollo) API** *(optional)* | Emails *with the public source URLs where they were found* | Only accept emails that come with a source; reject pattern-guessed results. |
| **Email verification API** (ZeroBounce / NeverBounce) | Deliverability check | Confirms deliverability only — does not make a guessed address "verified." |
| **CSV import** | Your own lists, event attendee lists you're entitled to, referrals | Source = "manual import: <file>, <date>". |
| **Inbound** | Demo-request form, newsletter, referrals | Highest quality; same pipeline. |

### Do not use
- **MLS data (UtahRealEstate.com / WFRMLS)** — licensed for MLS participants; not for vendor prospecting.
- **Zillow, Realtor.com, Homes.com agent profiles** — terms prohibit scraping.
- **LinkedIn scraping** — prohibited; manual browsing and notes only.
- **Realtor association member directories** — members-only.
- **Guessed emails** (`first@domain`) presented as verified — never.

### Contact-eligibility rule (enforced in code)
An email can be sent to only if `email_status ∈ {source_listed, vendor_sourced}` **and** it has a source URL **and** it passed deliverability verification **and** it's not suppressed.

---

## 3. Required APIs and integrations

| Phase | Integration | Required? | Purpose |
|---|---|---|---|
| 1 | Supabase | Yes | DB, auth, storage |
| 1 | Claude API | Yes | Research extraction, qualification |
| 1 | Claude `web_fetch` / `web_search` server tools | Yes | Read prospect websites; find a team's website |
| 2 | Claude API (drafting) | Yes | First-touch + follow-up drafts |
| 3 | Google Workspace + Gmail API (OAuth) | Yes | Send approved mail, detect replies/bounces |
| 3 | Email verification API | Yes | Deliverability before first send |
| 3 | Outreach domain + SPF/DKIM/DMARC | Yes | Protect the main product domain's reputation |
| 4 | Google Places API | Optional | Discovery by market |
| 4 | Hunter.io / Apollo | Optional | Sourced business emails |
| 4 | Calendly / Cal.com webhook | Optional | Auto-mark "demo booked" |
| 4 | Stripe webhook (product's billing) | Optional | Auto-mark trial / paying |

---

## 4. Operating cost estimates (monthly)

### AI cost per prospect (assumptions)
- Research: ~20k input / 2k output tokens (website pages + extraction), ~2 web searches.
- Qualification: ~4k input / 1k output.
- Drafting: first touch + 2 follow-ups ≈ 12k input / 2.5k output.
- Thinking tokens are billed as output; estimates are padded ~30% for that.
- Web search: $10 per 1,000 searches. Web fetch: tokens only.

| Model setup | Per prospect | Notes |
|---|---|---|
| **A. Claude Opus 5.5 everywhere** ($4 / $20 per MTok) | ≈ $0.35 | Highest quality, simplest |
| **B. Mixed**: Haiku 5.5 extraction ($0.10/$0.50), Sonnet 5.5 qualify + draft ($2/$10) | ≈ $0.10 | Recommended once prompts are tuned and evaluated |
| Batches API on qualification | −50% on that step | Non-urgent bulk runs |

Only qualified prospects get drafted (~40–60%), so real drafting cost is lower than shown.

### Total monthly cost

| Line item | 100 / mo | 500 / mo | 1,000 / mo |
|---|---|---|---|
| Claude API — setup A (Opus 5.5) | ~$35 | ~$175 | ~$350 |
| Claude API — setup B (mixed) | ~$10 | ~$50 | ~$100 |
| Vercel Pro (commercial use; Hobby is non-commercial) | $20 | $20 | $20 |
| Supabase (Free OK in Phase 1; Pro once live) | $0–25 | $25 | $25 |
| Google Workspace mailbox(es) | ~$7–14 | ~$14–28 (2 boxes) | ~$21–42 (3 boxes) |
| Outreach domain(s) | ~$1–2 | ~$2 | ~$3 |
| Email verification (~$0.008/email) | ~$1 | ~$4 | ~$8 |
| Hunter/Apollo (optional) | $0–49 | ~$49 | ~$49–149 |
| Google Places (optional; monthly free credit likely covers it) | $0 | $0 | ~$0–20 |
| **Total — setup B, no paid data vendor** | **~$40–75** | **~$115–130** | **~$180–200** |
| **Total — setup A + data vendor** | **~$65–150** | **~$290–300** | **~$480–600** |

Third-party prices are approximate — confirm before purchasing. Claude prices are current API list prices.

Volume note: 1,000 new prospects/month × 3 touches ≈ 1,500–2,500 emails/month after qualification ≈ 70–115/day. With a conservative cap of **≤40 cold emails/day per mailbox**, 1,000/mo needs **2–3 warmed mailboxes**.

---

## 5. Database design (Supabase Postgres)

Multi-product from day one: every row hangs off a `workspace`; pipeline state is per `(organization, product)`.

```
workspaces ─┬─ products ─┬─ campaigns ─ sequence_steps
            │            └─ pipeline_entries ─┬─ qualification_runs
            │                                 └─ messages ─ message_events
            ├─ organizations ─┬─ contacts
            │   (prospects)   ├─ facts  (provenance for every claim)
            │                 └─ activities (communication history)
            ├─ brokerages
            ├─ suppressions
            ├─ imports
            └─ jobs
```

### Core tables (key columns)

**products** — `id, workspace_id, name, description, icp jsonb, qualification_rubric jsonb, value_props jsonb, approved_claims jsonb` (features that exist today vs. roadmap; drafting may only cite existing ones), `sender_name, sender_company, postal_address, demo_link, daily_send_cap`.

**organizations** (the prospect business) — `id, workspace_id, name, org_type` (`solo_agent | team | independent_brokerage | franchise_office | other`), `website, domain (normalized, unique per workspace), phone_e164, city, county, state, brokerage_id, team_size, team_size_fact_id` (null unless verified), `lead_source, notes, created_at`.

**contacts** — `id, organization_id, full_name, role, email (citext), email_status` (`unknown | source_listed | vendor_sourced | deliverable | undeliverable | bounced`), `email_fact_id, phone_e164, is_primary`.

**facts** — the provenance ledger. `id, organization_id, contact_id?, field` (e.g. `team_size`, `email`, `brokerage`, `services`), `value jsonb, source_url, source_type` (`website | public_record | places_api | vendor | csv | manual`), `retrieved_at, extracted_by` (`ai | human | import`), `confidence, is_verified boolean`. The UI shows source + date next to every displayed fact.

**brokerages** — `id, name, domain, licensee_count, licensee_count_fact_id`.

**pipeline_entries** — one per (organization, product). `stage, stage_changed_at, score, fit_tier, owner_user_id, last_contacted_at, next_follow_up_at, campaign_id, disqualified_reason`.

**qualification_runs** — `id, pipeline_entry_id, score (0–100), criteria jsonb` (per-criterion score, evidence fact IDs, and `basis: verified | inferred | unknown`), `explanation, model, prompt_version, created_at`. Scores are re-runnable and versioned.

**campaigns / sequence_steps** — `campaign: product_id, name, market filter, status, daily_cap`; `step: step_number, delay_days, kind (first_touch | follow_up), template_guidance`.

**messages** — `id, pipeline_entry_id, contact_id, step_id, status` (`draft | approved | scheduled | sent | bounced | replied | cancelled`), `subject, body, generated_by_model, prompt_version, approved_by, approved_at, scheduled_for, sent_at, gmail_message_id, gmail_thread_id`.

**message_events** — `message_id, type (sent | bounce | reply | unsubscribe | complaint), payload, occurred_at`.

**activities** — `organization_id, contact_id, type (email_out | email_in | note | call | stage_change | demo), summary, occurred_at, user_id`.

**suppressions** — `workspace_id, email or domain, reason (unsubscribe | bounce | complaint | manual | do_not_contact), source, created_at`. Workspace-wide (an opt-out from one product suppresses all products — the safe default). Checked at approval **and** immediately before send.

**imports** — `file_path, column_mapping, rows_total, rows_created, rows_merged, rows_flagged, created_by`.

**jobs** — `type, payload, status, attempts, run_after, locked_at, last_error`.

### Deduplication
1. Exact: normalized domain; lowercased email; E.164 phone.
2. Fuzzy (`pg_trgm`): name similarity + same city → "possible duplicate" review queue, never auto-merged.
3. Merges keep all `facts` from both records.

### Pipeline stages
```
discovered → researched → qualified ─► contact_ready → drafted → approved
                        ↘ disqualified          ↓
                                           in_sequence → replied → interested
                                                ↓                     ↓
                                         no_response/nurture     demo_booked → trial → customer
Terminal anytime: not_interested · unsubscribed · bounced · do_not_contact
```
Any reply automatically stops the sequence for that contact.

---

## 6. AI behavior design

**Research** (per prospect): fetch the prospect's own site (home, team, contact, about). Claude returns structured JSON — each field carries `value, source_url, quote`. Anything without a quote is dropped. Writes to `facts`.

**Qualification** — transparent, product-configurable rubric (real estate defaults):

| Criterion | Weight | Example evidence |
|---|---|---|
| ICP fit (team / independent brokerage vs. large franchise office) | 30 | org type from website |
| Team size in 2–20 range | 25 | agents listed on the team page |
| Operational complexity (multiple agents, admin/TC role, volume signals) | 20 | roles listed, listing count on own site |
| Transaction-management relevance | 15 | buyer + seller side, no listed in-house TC |
| Legitimate contact channel available | 10 | published business email / contact form |

Each criterion returns `score, basis (verified | inferred | unknown), evidence_fact_ids, note`. Missing evidence → `unknown`, scored neutral, flagged. Inferred pain points are labeled "hypothesis" in the UI and are **not** given to the drafter as facts. Tech stack (current CRM) is never assumed.

**Drafting**: inputs are verified facts only, the product's `approved_claims`, and the step guidance. Output: subject + ≤120-word body. Hard rules in the prompt, plus a post-generation lint step that flags: unverified claims, invented familiarity ("loved your recent listing…"), roadmap features, banned phrases ("I hope this finds you well", "revolutionize", "game-changer"), missing CTA. Lint failures block approval until edited.

---

## 7. Compliance and sending safety

**CAN-SPAM** (US commercial email; applies to B2B):
- Accurate From/Reply-To and routing; non-deceptive subject lines.
- Sender identified; valid physical postal address in every message.
- Clear opt-out in every message, honored immediately (legal max: 10 business days); unsubscribe link works ≥30 days after send.
- No selling/transferring addresses of people who opted out.
- We remain responsible for anything sent on our behalf.

**Mailbox provider requirements** (Gmail/Yahoo sender rules): SPF, DKIM, DMARC on the outreach domain; `List-Unsubscribe` + `List-Unsubscribe-Post` one-click headers; keep spam complaints <0.1% (hard ceiling 0.3%).

**Utah**: the Utah Child Protection Registry targets messages about adult-restricted products; it doesn't apply to this product, but the engine stores a per-product "regulated content" flag so a future product could enable registry scrubbing. Revisit for each new state/country (e.g. CASL before Canada).

**Built-in safeguards**
- Nothing sends without explicit approval. Phase 3 starts with **per-message approval**; later, per-campaign approval of reviewed templates — still human-initiated.
- A global "sending enabled" kill switch, off by default.
- Rate limits: ≤40 cold/day/mailbox, randomized 2–6 min gaps, business hours in the recipient's time zone, warm-up ramp for new mailboxes.
- Auto-pause a campaign if bounces >3% or any spam complaint, or unsubscribe rate >2%.
- Suppression check at approval and immediately before send.
- Hard bounces → auto-suppress; "unsubscribe"/"remove me" replies → auto-suppress (AI-classified, logged).
- No SMS or cold calling in scope (avoids TCPA).

---

## 8. Initial dashboard

**Filters (global):** date range · product · campaign · market (county/city).

**Row 1 — funnel KPI tiles:** Prospects discovered · Qualified · Drafts awaiting approval · Emails sent · Replies · Positive replies · Demos booked · Trials · Paying customers. Each shows count and conversion from the previous step.

**Row 2 — action queues (the "do this today" area):**
- Drafts awaiting approval (approve / edit / reject inline)
- Replies needing triage (AI-suggested label: interested / not now / not interested / unsubscribe / out-of-office)
- Follow-ups due today
- Possible duplicates to review

**Row 3 — charts:** pipeline funnel; weekly sends vs. replies vs. positive replies; prospects and reply rate by market.

**Row 4 — deliverability health:** bounce rate, unsubscribe rate, complaints, per-mailbox daily usage vs. cap, sending kill-switch status.

Phase 1 ships rows 1 (discovery → qualified only), the duplicates queue, and a market breakdown; the rest lights up as phases land.

---

## 9. Phased development plan

Estimates assume me building with you reviewing; calendar time depends on your review turnaround.

### Phase 0 — Setup (1–2 days)
- Next.js + TypeScript + Tailwind scaffold; Supabase project; auth (email magic link, allow-listed users).
- Migrations for the schema above; seed one workspace and the real estate product config.
- Vercel deploy with preview environments.
- **You:** create Supabase + Vercel + Anthropic accounts; buy the outreach domain.

### Phase 1 — Database, import, research, qualification, dashboard (~2 weeks)
- Prospect list (filter, sort, search, saved views) and detail page with facts + sources.
- CSV import: upload → column mapping → preview → dedupe report → commit. CSV export of any filtered view.
- Research job (website fetch + structured extraction → `facts`).
- Qualification job with versioned rubric, per-criterion explanation, batch mode.
- Manual stage changes, notes, activities, follow-up dates.
- Dashboard v1.
- **Done when:** import 200 real Utah prospects, research + qualify them, and you agree with ≥80% of the scores on a spot-check of 30.

### Phase 2 — Personalization and drafting (~1 week)
- Product config UI (value props, approved claims, CTA, sender identity).
- First-touch + follow-up draft generation, lint step, draft queue with inline edit / approve / reject + rejection reasons (fed back into prompt iteration).
- Small evaluation set (~30 prospects) to compare prompt versions before changing them.
- **Done when:** ≥70% of drafts approved with light or no edits.

### Phase 3 — Approved sending, follow-ups, reply tracking (~2 weeks)
- Google OAuth to the outreach mailbox; Gmail send with compliant footer + one-click unsubscribe headers; public unsubscribe page.
- Scheduler (caps, time windows, warm-up), kill switch, auto-pause thresholds.
- Sequences: follow-ups drafted ahead of time and queued for approval; stop on reply.
- Reply/bounce polling, AI reply classification, triage queue, auto-suppression.
- Demo-link insertion; manual "demo booked / trial / customer" stage updates.
- **Done when:** a test campaign to internal seed addresses passes every compliance check, then a first live batch of 25 goes out after your approval.

### Phase 4 — Discovery, integrations, reporting (~2–3 weeks, modular)
- Discovery connectors (each one a plug-in implementing `search(criteria) → candidates with sources`): DRE licensee import, Google Places by market, Hunter/Apollo enrichment.
- Calendly/Cal.com webhook → demo booked; Stripe webhook → trial/paid.
- Reporting: cohort conversion by campaign/market/message variant; prompt-version A/B results.
- Multi-product polish: product switcher, per-product dashboards, workspace-wide suppression.

---

## 10. Decisions needed before Phase 0

1. **AI model setup:** A (Opus 5.5 everywhere, ~$0.35/prospect) or B (Haiku 5.5 + Sonnet 5.5, ~$0.10/prospect)? Recommendation: start with A while tuning prompts, switch steps to B once the eval set shows no quality loss.
2. **Sending mailbox:** Google Workspace on a separate outreach domain (recommended) — confirm.
3. **Sender identity + postal address** for the CAN-SPAM footer.
4. **Paid contact-data vendor** in Phase 4 (Hunter / Apollo / none).
5. **Who uses the tool:** just you, or a small team (affects roles/permissions in Phase 0)?
6. **Product claims list:** which features are live today vs. roadmap (drafts will only reference live ones).
