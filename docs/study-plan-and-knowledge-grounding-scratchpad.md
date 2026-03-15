# Study Plan And Knowledge Grounding Scratchpad

## Purpose

This is the tactical working pad for the new study-plan and knowledge-grounding
story.

It exists to scope and sequence the pre-session grounding system before coding,
so the live ThinkSpace tutor and the second brain both start from a stable
pedagogical foundation rather than improvising from raw source materials during
the session.

This scratchpad is intentionally more implementation-facing than
`docs/implementation-stories.md`.

## Current Goal

Build the first pre-session grounding pipeline that runs before a live session
begins and produces three durable artifacts:

- `study_plan`
- `source_summary`
- `knowledge_index`

The live session should begin only after these artifacts are ready enough for
v1 use.

## Why This Story Matters

ThinkSpace is not just a reactive tutor. It is a proactive learning system with
an orchestrator and a second-brain layer that both need stable grounding.

Without a pre-session grounding layer, the system risks:

- overly reactive tutoring that follows the latest turn but lacks a learning arc
- weak proactive interventions because the second brain does not know the
  intended sequence of learning
- repeated or unnecessary retrieval during the live session
- poor source grounding because raw materials are not distilled ahead of time

The intended design rule is:

- the live session should primarily run on `study_plan` and `source_summary`
- exact retrieval should be sparse and deliberate
- `knowledge.lookup` is a precision tool, not the primary brain

## Anchor Docs

This scratchpad should be read together with:

- `docs/implementation-stories.md`
- `docs/proactive-tutor-system.md`
- `docs/thinkspace-end-to-end-technical-architecture.md`
- `docs/agent-tool-catalog.md`
- `docs/tool-result-contract.md`
- `docs/adk-live-integration.md`

## Locked V1 Product Direction

### In scope

- one asynchronous pre-session grounding pipeline
- user input sources:
  - learner prompt or learning goal
  - uploaded source materials
- one `study_plan` artifact for pedagogical grounding
- one `source_summary` artifact for source-grounded semantic compression
- one `knowledge_index` artifact built from the source materials
- one orchestrator-facing retrieval tool: `knowledge.lookup`
- orchestrator grounding from `study_plan`
- second-brain grounding from `study_plan`, `source_summary`, and live session
  state
- sparse exact retrieval from indexed source materials only when needed
- use of Google's native RAG stack for hackathon speed and Gemini alignment:
  `Vertex AI RAG Engine` plus `text-embedding-005`

### Out of scope

- web retrieval in the core session loop
- `research.lookup`
- a custom in-house RAG framework
- a large knowledge graph system
- always-on retrieval on every turn
- letting the live session start before preprocessing completes
- autonomous broad internet research during tutoring

## V1 Runtime Model

The runtime should treat the three grounding layers differently.

### 1. `study_plan`

The pedagogical backbone for the session.

The orchestrator should use this as the default frame for:

- what the learner is trying to achieve
- what concepts should come first
- what likely next steps exist
- what misconceptions are likely
- what kinds of interventions are pedagogically appropriate

### 2. `source_summary`

The stable semantic distillation of the provided materials.

The second brain should use this to reason about:

- what concepts matter most in the materials
- how terms and ideas connect
- what factual boundaries should not be violated
- what examples, formulas, and definitions are central

### 3. `knowledge.lookup`

The precision retrieval path.

This should be used only when exactness matters, such as:

- confirming a fact, definition, or formula
- retrieving a passage or local explanation from source materials
- grounding a learner question that needs citation-level support
- resolving uncertainty that should not be answered from memory alone

## V1 Artifact Direction

## `study_plan`

This should be concise, pedagogically structured, and optimized for live use.

Recommended v1 fields:

- `session_goal`
- `learner_intent`
- `target_outcomes`
- `topic_sequence`
- `prerequisites`
- `likely_misconceptions`
- `recommended_interventions`
- `suggested_progression_signals`
- `source_coverage_notes`

### `topic_sequence`

Each topic entry should likely include:

- `topic`
- `why_it_matters`
- `depends_on`
- `success_signals`
- `common_failure_modes`
- `recommended_modalities`

### `recommended_modalities`

These are suggestions for how ThinkSpace might teach the topic:

- explain verbally
- create flashcards
- generate visual
- generate graph
- generate notation
- delegate canvas task

The goal is not rigid workflow enforcement. The goal is to give the
orchestrator and second brain a pedagogical map.

## `source_summary`

This should be a source-grounded semantic compression of the materials, not a
generic essay summary.

Recommended v1 fields:

- `core_concepts`
- `key_terms`
- `definitions`
- `important_examples`
- `important_formulas_or_rules`
- `concept_relationships`
- `source_boundaries`
- `notable_gaps_or_ambiguities`

### `source_boundaries`

This is especially important for tutoring safety.

It should capture things like:

- what the materials clearly support
- what the materials mention only lightly
- what the materials do not establish strongly enough to treat as authoritative

## `knowledge_index`

This is the retrieval substrate, not a user-facing artifact.

Recommended stored properties:

- chunk text
- source document id
- source title
- chunk locator
- local section title if available
- embedding
- metadata tags

## Tool Direction: `knowledge.lookup`

`knowledge.lookup` should be an orchestrator-facing backend tool with no
frontend action in the normal success path.

### Current tool intent

Retrieve a small set of exact, source-grounded excerpts from indexed source
materials when the tutor needs precise support.

### Recommended v1 execution style

- synchronous if retrieval latency remains comfortably low
- no visible frontend action
- no automatic semantic feedback loop unless a later product need appears

### Recommended model-facing input shape

Keep the first version small.

Recommended shape:

- `query: string`
- `intent?: string`
- `topic_hint?: string`
- `max_results?: int`

Do not expose in v1:

- low-level index names
- raw vector-store parameters
- freeform retrieval strategy knobs

### Recommended result payload direction

- `query`
- `results`

Each result should likely contain:

- `source_id`
- `source_title`
- `locator`
- `snippet`
- `relevance_score`
- optional `section_title`

Design rule:

- return exact supporting material, not a long synthesized answer blob
- the orchestrator remains responsible for tutoring from the retrieved context

## Framework Direction

For speed, v1 should reuse Google's native managed RAG stack rather than
building a custom pipeline.

Current direction:

- use `Vertex AI RAG Engine`
- use `text-embedding-005` for the initial RAG corpus embedding model

Reasoning:

- strongest Gemini hackathon alignment
- less custom retrieval plumbing for v1
- Google-managed ingestion, indexing, and retrieval path
- still keeps ThinkSpace-specific pedagogy in the app layer
- the current official Vertex AI RAG Engine docs make `text-embedding-005` the
  safe supported default choice

Current non-direction for v1:

- do not make web retrieval part of this story
- do not add `research.lookup` yet
- do not build a custom retrieval stack with `LlamaIndex`, LightRAG, or another
  framework unless the Google-native path blocks delivery
- do not lock `gemini-embedding-2-preview` as the corpus embedding model until
  the Google docs or implementation path clearly support it for Vertex AI RAG
  Engine

## Proposed Build Order

### Phase 1: Artifact Schema Lock

Goal:

Lock the v1 shapes for:

- `study_plan`
- `source_summary`
- `knowledge.lookup`

Expected result:

- the team knows exactly what is being produced before any implementation starts
- prompt design and persistence become easier

## Phase 1 Lock: Exact V1 Schemas

This section locks the first implementation-ready shapes for the three new
artifacts.

Design rule:

- keep these schemas small enough to ship quickly
- prefer stable fields over maximal expressiveness
- avoid adding analytics-heavy or workflow-heavy fields in v1

## Locked V1 Schema: `study_plan`

Recommended artifact shape:

```json
{
  "session_goal": "Understand the fundamentals of cellular respiration",
  "learner_intent": "Prepare for a biology exam using the uploaded lecture notes",
  "target_outcomes": [
    "Explain the overall purpose of cellular respiration",
    "Describe glycolysis, Krebs cycle, and oxidative phosphorylation",
    "Compare ATP yield across major stages"
  ],
  "topic_sequence": [
    {
      "id": "topic-1",
      "topic": "Purpose and big picture",
      "why_it_matters": "Frames the rest of the process as energy conversion",
      "depends_on": [],
      "success_signals": [
        "Learner can state why cells perform respiration",
        "Learner can distinguish respiration from photosynthesis"
      ],
      "common_failure_modes": [
        "Treating respiration as only breathing",
        "Missing the role of ATP production"
      ],
      "recommended_modalities": [
        "explain",
        "generate_visual"
      ]
    }
  ],
  "likely_misconceptions": [
    "Cellular respiration happens only when oxygen is present",
    "Glycolysis happens in the mitochondria"
  ],
  "recommended_interventions": [
    "Use a stage-by-stage comparison when confusion appears",
    "Switch to a visual if the learner mixes up locations or outputs",
    "Use flashcards for terminology-heavy review"
  ]
}
```

### `study_plan` field notes

- `session_goal`: one concise top-level learning outcome for the current session
- `learner_intent`: the learner's own framing, rewritten clearly
- `target_outcomes`: the most important things the learner should leave knowing
- `topic_sequence`: the ordered pedagogical backbone for the session
- `likely_misconceptions`: probable conceptual traps inferred from the materials
  and topic
- `recommended_interventions`: tutoring moves the orchestrator or second brain
  can prefer

### `source_summary` lean v1 exclusion

The following are intentionally excluded from the first schema lock:

- `prerequisites`
- `suggested_progression_signals`
- `source_coverage_notes`

### Locked value direction for `recommended_modalities`

Use only these literals in v1:

- `explain`
- `flashcards`
- `generate_visual`
- `generate_graph`
- `generate_notation`
- `delegate_canvas`

## Locked V1 Schema: `source_summary`

Recommended artifact shape:

```json
{
  "overview": "The uploaded materials explain cellular respiration as a staged energy-conversion process centered on ATP production.",
  "core_concepts": [
    {
      "name": "Glycolysis",
      "summary": "Initial glucose breakdown in the cytoplasm that yields pyruvate, ATP, and NADH."
    },
    {
      "name": "Krebs cycle",
      "summary": "Cycle in the mitochondrial matrix that produces electron carriers and a small amount of ATP."
    }
  ],
  "key_terms": [
    "ATP",
    "NADH",
    "FADH2",
    "electron transport chain",
    "oxidative phosphorylation"
  ],
  "definitions": [
    {
      "term": "Oxidative phosphorylation",
      "definition": "ATP production driven by the electron transport chain and chemiosmosis."
    }
  ],
  "important_examples": [
    "ATP yield comparison across major stages",
    "Oxygen as the terminal electron acceptor"
  ],
  "source_boundaries": {
    "well_supported": [
      "Overall pathway stages",
      "Locations of the major stages",
      "Basic ATP accounting"
    ],
    "lightly_supported": [
      "Fine-grained pathway regulation"
    ],
    "not_well_supported": [
      "Disease-related edge cases",
      "Advanced biochemical exceptions"
    ]
  }
}
```

### `source_summary` field notes

- `overview`: short grounding paragraph for the whole source pack
- `core_concepts`: the high-signal concepts the second brain should track
- `key_terms`: vocabulary worth reinforcing
- `definitions`: exact short definitions from or strongly supported by materials
- `important_examples`: canonical examples repeatedly worth referencing
- `source_boundaries`: trust boundary for what the materials do and do not
  support strongly

### Lean v1 exclusion

The following are intentionally excluded from the first schema lock:

- `important_formulas_or_rules`
- `concept_relationships`
- `notable_gaps_or_ambiguities`

## Locked V1 Schema: `knowledge.lookup`

### Model-facing input

```json
{
  "query": "What do the uploaded notes say about the net ATP yield of glycolysis?",
  "intent": "retrieve exact support for a learner question",
  "topic_hint": "glycolysis",
  "max_results": 3
}
```

### Input field notes

- `query`: required plain-language retrieval query
- `intent`: optional brief reason for retrieval, useful for narrowing behavior
- `topic_hint`: optional semantic hint aligned with the study plan topic
- `max_results`: optional small cap; default should stay low in v1

### Locked v1 input constraints

- `query` is required
- `intent` is optional
- `topic_hint` is optional
- `max_results` defaults to `3`
- `max_results` should be capped at `5`

### Tool result shape

This tool should use the shared ThinkSpace tool-result envelope and normally
return a synchronous `completed` result with no `frontend_action`.

Recommended example:

```json
{
  "status": "completed",
  "tool": "knowledge.lookup",
  "summary": "Retrieved 3 source-grounded excerpts for glycolysis ATP yield",
  "payload": {
    "query": "What do the uploaded notes say about the net ATP yield of glycolysis?",
    "results": [
      {
        "source_id": "doc-lecture-1",
        "source_title": "Biology Lecture 4 Notes",
        "locator": "page 3",
        "section_title": "Glycolysis",
        "snippet": "Glycolysis yields a net gain of 2 ATP molecules per glucose molecule.",
        "relevance_score": 0.94
      }
    ]
  }
}
```

### Locked v1 payload fields

- `query`
- `results`

Each `results[]` item should contain:

- `source_id`
- `source_title`
- `locator`
- `snippet`
- `relevance_score`
- optional `section_title`

### Design rules

- return exact supporting snippets, not a long synthesized answer
- do not emit `frontend_action` on normal success
- do not overstuff the result with many passages; small high-confidence retrieval
  is preferred
- the orchestrator remains responsible for tutoring, quoting, or summarizing
  from the retrieved snippets

## Locked V1 Readiness Boundary

The live session should be considered ready only when all of the following are
true:

- source material extraction completed
- `study_plan` exists
- `source_summary` exists
- the source material corpus is indexed and queryable for `knowledge.lookup`

If one of these fails, the session should not silently proceed as if full
grounding exists.

### Phase 2: Pre-Session Async Job Flow

Goal:

Create a backend job pipeline that runs after materials and learner prompt are
available and before live tutoring begins.

Expected steps:

1. ingest source materials
2. normalize or extract usable text
3. generate `study_plan`
4. generate `source_summary`
5. build `knowledge_index`
6. mark the session ready for live tutoring

Expected result:

- session startup has a clear readiness boundary
- the live session no longer depends on ad hoc source interpretation

### Locked v1 execution order

Run the preprocessing stages in this order:

1. validate learner prompt and source material presence
2. ingest source materials
3. extract or normalize usable text
4. launch in parallel:
   - per-document summaries
   - RAG ingestion into `Vertex AI RAG Engine`
5. merge per-document summaries into one `source_summary`
6. generate `study_plan` from learner prompt plus merged `source_summary`
7. verify that `knowledge.lookup` can query the indexed corpus
8. mark the session ready for live tutoring

Design rule:

- do not start the live tutoring websocket as if the session is fully grounded
  until step 7 succeeds

### Locked v1 parallelization rule

After source extraction completes:

- per-document summary jobs should run in parallel
- RAG ingestion should run in parallel with summary generation
- `study_plan` generation should wait for the merged `source_summary`

This keeps the pipeline fast without forcing the study plan to reason over the
raw full corpus directly.

### Locked v1 summarization strategy for many documents

Do not generate `source_summary` or `study_plan` from a giant raw multi-document
prompt in one shot.

Use a hierarchical summarization flow:

1. create one compact summary per document
2. merge those per-document summaries into one session-level `source_summary`
3. generate `study_plan` from:
   - learner prompt
   - merged `source_summary`

Design rule:

- `source_summary` is a reduced semantic view of the source pack
- `study_plan` is a pedagogical plan derived from learner intent plus that
  reduced semantic view
- RAG ingest should work from the parsed source corpus directly, not from the
  summary artifacts

### Locked v1 session-grounding states

Use a small backend-owned state machine for preprocessing.

Recommended states:

- `awaiting_materials`
- `queued`
- `extracting_sources`
- `generating_study_plan`
- `generating_source_summary`
- `indexing_knowledge`
- `verifying_lookup`
- `ready`
- `failed`

### State meanings

- `awaiting_materials`: required inputs are not present yet
- `queued`: inputs exist and preprocessing is scheduled
- `extracting_sources`: the system is extracting or normalizing source text
- `generating_study_plan`: the pedagogical plan is being created
- `generating_source_summary`: the source-grounded summary is being created
- `indexing_knowledge`: source materials are being ingested into the RAG corpus
- `verifying_lookup`: the system is confirming retrieval works against the new
  corpus
- `ready`: all required artifacts exist and lookup is queryable
- `failed`: preprocessing did not complete successfully

### Locked v1 persisted grounding status shape

Recommended backend status record:

```json
{
  "status": "generating_source_summary",
  "error": null,
  "study_plan_ready": true,
  "source_summary_ready": false,
  "knowledge_index_ready": false,
  "rag_corpus_id": "rag-corpus-123",
  "updated_at": "2026-03-15T12:00:00Z"
}
```

### Field notes

- `status`: current state-machine value
- `error`: last meaningful failure message, if any
- `study_plan_ready`: whether the artifact exists and passed minimal validation
- `source_summary_ready`: whether the artifact exists and passed minimal
  validation
- `knowledge_index_ready`: whether retrieval is actually queryable, not merely
  submitted for indexing
- `rag_corpus_id`: the backend-owned RAG Engine corpus identifier for this
  session or material set
- `updated_at`: latest status update timestamp

### Locked v1 transition rules

- `awaiting_materials -> queued` when learner prompt and source materials are
  both present
- `queued -> extracting_sources` when the preprocessing worker begins
- `extracting_sources -> generating_source_summary` when per-document summary
  work begins
- `extracting_sources -> indexing_knowledge` when RAG ingestion begins
- `generating_source_summary -> generating_study_plan` only after the merged
  `source_summary` artifact is persisted
- `indexing_knowledge -> verifying_lookup` only after RAG ingestion reports
  success and `study_plan` generation is complete
- `verifying_lookup -> ready` only after a real retrieval check succeeds
- any state may transition to `failed` on unrecoverable error

### Locked v1 failure behavior

If preprocessing fails:

- do not silently mark the session as usable
- persist the failure state and a compact error reason
- do not expose `knowledge.lookup` to the orchestrator for that session
- require an explicit retry or rebuild path later

### Locked v1 readiness semantics

`ready` means all of the following are true:

- normalized source text exists
- `study_plan` exists in persisted session grounding state
- `source_summary` exists in persisted session grounding state
- the RAG corpus exists
- a retrieval verification check succeeded

It does not mean:

- the study plan is perfect
- the summary is exhaustive
- every possible learner question is answerable from the corpus

### Recommended v1 product behavior

Before `ready`:

- the product should present the session as preparing or grounding
- the learner should not be dropped directly into the normal live tutoring flow

After `ready`:

- the live tutoring session may start
- the orchestrator should receive the `study_plan`
- the second brain should receive the `source_summary`
- `knowledge.lookup` may be enabled for the session

## Locked V1 Backend Job Pattern

The pre-session grounding flow should reuse the same backend async pattern
already used for replay artifacts such as notes and key moments.

Current repo pattern being reused:

- a backend-owned status store tracks progress and errors per session
- artifact payloads are persisted separately from the status record
- jobs are enqueued through a small deduping helper in `backend/app/main.py`
- long-running work runs in background tasks created with `asyncio.create_task`
- blocking or SDK-heavy work can be pushed through `asyncio.to_thread(...)`
- workers update status as they move through `processing`, `ready`, or `failed`

Design rule:

- do not invent a second job orchestration style for grounding if the existing
  replay-artifact pattern already fits

## Locked V1 Persistence Model

Use separate persisted records for status versus artifacts.

### 1. `grounding_status`

Backend-owned session status record used to track preprocessing state.

Recommended shape:

```json
{
  "session_id": "session-123",
  "grounding_status": "generating_source_summary",
  "study_plan_status": "ready",
  "source_summary_status": "processing",
  "knowledge_index_status": "processing",
  "grounding_error": null,
  "study_plan_error": null,
  "source_summary_error": null,
  "knowledge_index_error": null,
  "rag_corpus_id": "rag-corpus-123",
  "requested_at": "2026-03-15T12:00:00Z",
  "updated_at": "2026-03-15T12:00:10Z"
}
```

Use the same style as the replay-status system:

- one compact status document per session
- merge-style updates as each phase completes or fails

### 2. `study_plan` artifact

Persist as a separate artifact record keyed by `session_id`.

Recommended stored fields:

- `session_id`
- `status`
- `study_plan`
- `generated_at`
- `model`
- `source_material_hash`

### 3. `source_summary` artifact

Persist as a separate artifact record keyed by `session_id`.

Recommended stored fields:

- `session_id`
- `status`
- `source_summary`
- `generated_at`
- `model`
- `source_material_hash`

### 4. knowledge index reference

Do not persist raw indexed chunks in our app store in v1 if `Vertex AI RAG
Engine` is the system doing indexing.

Persist only the backend-owned reference data we need:

- `session_id`
- `rag_corpus_id`
- optional source material hash
- readiness/error status through `grounding_status`

## Locked V1 Runner Shape

Recommended backend shape:

- one `_enqueue_grounding_job(session_id)` helper
- one `_run_grounding_job(session_id)` parent coroutine
- inside the runner:
  - load session inputs
  - update `grounding_status`
  - extract materials
  - launch per-document summaries and RAG ingest in parallel
  - merge summaries
  - generate `study_plan`
  - verify lookup
  - persist artifacts and mark `ready`

Reasoning:

- replay jobs are independent siblings like notes and key moments
- grounding has dependency edges, so one parent runner with internal parallel
  stages is cleaner than three unrelated top-level jobs

## Locked V1 Failure And Retry Pattern

Reuse the current artifact-job philosophy:

- persist failures in the status store
- keep the last error message compact
- avoid duplicate concurrent jobs for the same session
- allow explicit retry later by re-enqueueing the session grounding job

## Recommended Store Direction

Match the existing environment-aware store pattern:

- local JSON-file fallback for development
- Firestore-backed stores when cloud configuration is available

That means the new grounding system should likely introduce:

- `GroundingStatusStore`
- `StudyPlanStore`
- `SourceSummaryStore`

This keeps the implementation consistent with:

- `session_replay_status.py`
- `session_notes.py`
- `session_key_moments.py`

## Locked V1 Persisted Model Classes

The grounding system should introduce three backend store modules plus one
status model, following the same pattern as replay artifacts.

### 1. `GroundingStatusStore`

Purpose:

- track preprocessing progress and failures for a session
- expose readiness to the session loading experience
- hold the backend-owned `rag_corpus_id` reference

Recommended persisted model:

```json
{
  "session_id": "session-123",
  "grounding_status": "processing",
  "study_plan_status": "ready",
  "source_summary_status": "processing",
  "knowledge_index_status": "processing",
  "grounding_error": null,
  "study_plan_error": null,
  "source_summary_error": null,
  "knowledge_index_error": null,
  "rag_corpus_id": "rag-corpus-123",
  "requested_at": "2026-03-15T12:00:00Z",
  "updated_at": "2026-03-15T12:00:10Z"
}
```

### 2. `StudyPlanStore`

Purpose:

- persist the generated `study_plan` artifact by `session_id`

Recommended persisted model:

```json
{
  "session_id": "session-123",
  "status": "completed",
  "study_plan": {
    "session_goal": "Understand the fundamentals of cellular respiration",
    "learner_intent": "Prepare for a biology exam using the uploaded lecture notes",
    "target_outcomes": [],
    "topic_sequence": [],
    "likely_misconceptions": [],
    "recommended_interventions": []
  },
  "generated_at": "2026-03-15T12:00:20Z",
  "model": "gemini-2.5-flash",
  "source_material_hash": "abc123"
}
```

### 3. `SourceSummaryStore`

Purpose:

- persist the generated `source_summary` artifact by `session_id`

Recommended persisted model:

```json
{
  "session_id": "session-123",
  "status": "completed",
  "source_summary": {
    "overview": "The uploaded materials explain cellular respiration as a staged energy-conversion process centered on ATP production.",
    "core_concepts": [],
    "key_terms": [],
    "definitions": [],
    "important_examples": [],
    "source_boundaries": {
      "well_supported": [],
      "lightly_supported": [],
      "not_well_supported": []
    }
  },
  "generated_at": "2026-03-15T12:00:18Z",
  "model": "gemini-2.5-flash",
  "source_material_hash": "abc123"
}
```

### Store pattern

Each store should support the same basic interface style as current artifact
stores:

- `get_*`
- `save_*`
- `delete_*`

And should support:

- local JSON-file fallback
- Firestore-backed persistence when configured

### Startup trigger design rule

- keep `rag_corpus_id` in `GroundingStatusStore`
- keep the actual pedagogical artifacts in their own stores
- do not bury the study plan or source summary inside the session metadata
  document in v1

## Locked V1 Session Binding Model

The grounding bundle should be session-scoped in v1.

### Required `session_id` bindings

The backend should be able to resolve all of the following from `session_id`:

- `study_plan`
- `source_summary`
- `grounding_status`
- `rag_corpus_id`

This means one session has one active grounding bundle for v1.

### Locked v1 lookup ownership rule

`knowledge.lookup` should not accept a corpus identifier from the orchestrator.

Instead:

- the live session already has a backend-owned `session_id`
- the backend resolves that session's `rag_corpus_id`
- retrieval runs only against that session-bound corpus

Design rule:

- corpus selection is backend-owned infrastructure state, not model-facing tool
  input

### Locked v1 runtime retrieval semantics

When `knowledge.lookup` is called during a live session:

1. backend reads the active `session_id`
2. backend loads the session grounding bundle
3. backend resolves `rag_corpus_id`
4. backend queries only that corpus
5. backend returns source-grounded snippets

### Locked v1 non-goals

Do not support in v1:

- cross-session retrieval
- multi-corpus tool selection by the orchestrator
- user- or model-specified corpus ids at tool-call time
- shared global knowledge retrieval across unrelated sessions

### Recommended persisted relation direction

The persisted relation should conceptually be:

- `session_id -> grounding_status`
- `session_id -> study_plan`
- `session_id -> source_summary`
- `session_id -> rag_corpus_id`

This is the relation the live runtime should rely on when a grounded session is
loaded later.

## Locked V1 Startup Trigger

### Trigger entrypoint

The grounding flow should begin from the dashboard session-creation path.

Current product direction:

- learner enters the prompt and attaches source material from
  `frontend/client/pages/Dashboard.tsx`
- session creation is triggered from that dashboard flow
- after session creation, the app routes into a dedicated session loading page

### Loading page responsibility

The session loading page is the place where the pre-session grounding jobs are
started and observed.

Its responsibilities in v1:

- start or confirm the grounding job for the new `session_id`
- poll or subscribe to `grounding_status`
- present preparation/loading progress to the learner
- transition into the live session only after status becomes `ready`

### Locked v1 startup sequence

1. learner submits prompt plus source materials from `Dashboard.tsx`
2. backend creates the session record
3. frontend routes to the session loading page for that `session_id`
4. backend starts or confirms the session grounding job
5. loading page shows grounding progress
6. when `grounding_status` becomes `ready`, the app enters the live session

### Design rule

- do not begin the normal live tutoring flow immediately from dashboard submit
- route through a loading/preparation stage first so grounding has a clear
  product boundary

### Recommended v1 loading-page states

- `creating_session`
- `grounding`
- `ready`
- `failed`

### Loading-page failure behavior

If grounding fails on the loading page:

- do not silently continue into the live session
- show that session preparation failed
- allow a retry path later

## Locked V1 Retry And Failure Recovery

Keep failure recovery simple in v1.

### Product behavior

- if grounding fails, keep the learner on the session loading page
- show a failed preparation state
- do not enter the live tutoring session
- show one simple action: `Retry preparation`

### Backend behavior

- persist the failure in `GroundingStatusStore`
- preserve the same `session_id`
- re-enqueue the same parent grounding job when retry is requested
- if retry succeeds, update artifacts and status normally and continue to the
  live session

### V1 non-goals

- no partial live-session fallback after grounding failure
- no multiple recovery options
- no advanced resume-from-middle orchestration for failed substeps

### Phase 3: Knowledge Indexing With Vertex AI RAG Engine

Goal:

Use `Vertex AI RAG Engine` for the first indexing and retrieval layer.

Expected result:

- source materials are chunked and indexed without building custom RAG plumbing
- retrieval can be exposed quickly through one ThinkSpace-owned tool boundary

### Phase 4: `knowledge.lookup` Tool

Goal:

Expose a narrow retrieval tool to the orchestrator.

Expected result:

- the tutor can ask for precise supporting context only when necessary
- retrieval remains sparse and intentional

### Phase 5: Runtime Grounding Injection

Goal:

Inject the new artifacts into the live runtime cleanly.

Expected result:

- orchestrator starts with `study_plan`
- second brain receives `study_plan` plus `source_summary`
- source lookup exists as a fallback precision path

### Locked v1 runtime injection model

Use asymmetric grounding injection across the two reasoning layers.

#### Orchestrator injection

The orchestrator should receive:

- `study_plan` only

Design rule:

- do not inject the full `source_summary` into the orchestrator's base runtime
  context by default
- exact source grounding should come through `knowledge.lookup` when necessary

#### Interpreter / second-brain injection

The interpreter should receive:

- `study_plan`
- `source_summary`

Design rule:

- the second brain should be more source-aware than the orchestrator because it
  is responsible for broader proactive reasoning and pedagogical steering

### Locked v1 injection timing

Inject grounding artifacts:

- once at session start
- again on reconnect or resume

Do not:

- re-inject the full artifacts every turn
- continuously resend the same grounding payload during the live session

## Locked V1 `knowledge.lookup` Usage Policy

`knowledge.lookup` should be a narrow precision tool, not a default reasoning
path.

### Use `knowledge.lookup` when

- the learner asks for an exact fact, definition, formula, or passage from the
  uploaded materials
- the orchestrator is unsure and should verify a claim against source material
- the tutor wants a precise example or wording grounded in the materials
- the second brain indicates that an intervention would benefit from exact
  source retrieval

### Do not use `knowledge.lookup` when

- the tutor can continue naturally from `study_plan`
- the second brain is only making pacing or sequencing suggestions
- the answer is already well grounded in current session context
- the tutor is speculatively fishing for extra context without a clear need for
  exact source support

### Locked v1 role boundary

- the orchestrator decides whether to call `knowledge.lookup`
- the second brain may indicate that retrieval could be useful
- the second brain does not perform retrieval directly
- the second brain does not force the orchestrator to retrieve

### Core design rule

- default to pedagogical grounding first
- use retrieval only for exactness, ambiguity resolution, or source-grounded
  support

## Current Open Questions

- whether the RAG corpus should be one-per-session or reusable per material pack
- how large should `source_summary` be before it becomes prompt-heavy
- whether `study_plan` should be fully regenerated per session or partially
  reusable across sessions for the same source pack
- whether `knowledge.lookup` should search only the current session materials or
  also previously saved material sets
- how session readiness should be surfaced in the product before live tutoring
  begins

## Current Recommendation

Build this story as a narrow, disciplined grounding slice:

- pre-session async preparation
- stable pedagogical plan
- stable source summary
- sparse retrieval tool

Do not let it expand into a general-purpose research system in v1.

## Detailed Implementation Plan

This section is the execution reference for building the story phase by phase.

The goal is to implement one stable layer at a time rather than mixing
persistence, jobs, RAG integration, runtime injection, and UI changes all at
once.

### Phase 1: Persistence Foundation

Goal:

Add the new persisted models and stores that the rest of the grounding system
depends on.

Build:

- `GroundingStatusStore`
- `StudyPlanStore`
- `SourceSummaryStore`
- backend models for grounding status, study plan artifacts, and source summary
  artifacts

Follow the same implementation pattern as:

- `backend/app/session_replay_status.py`
- `backend/app/session_notes.py`
- `backend/app/session_key_moments.py`

Done means:

- backend can save, load, merge, and delete grounding status by `session_id`
- backend can save, load, and delete `study_plan` by `session_id`
- backend can save, load, and delete `source_summary` by `session_id`

### Phase 2: Session Startup Flow

Goal:

Route newly created sessions through a preparation stage before live tutoring
begins.

Build:

- dashboard submit flow that creates the session and routes into loading
- loading-page state machine
- backend status fetch path for grounding progress

Done means:

- new sessions do not enter the live tutoring page immediately
- the loading page can show preparation progress for a specific `session_id`

### Locked v1 Phase 2 product flow

Use the existing dashboard session-creation path as the only entrypoint for new
grounded sessions.

Current source of truth:

- `frontend/client/pages/Dashboard.tsx`

Locked behavior:

1. learner enters the prompt and attaches source materials on the dashboard
2. dashboard calls the existing session creation flow
3. backend creates the session record and returns `session_id`
4. frontend routes to a dedicated session loading page for that `session_id`
5. the loading page starts or confirms the grounding job
6. the loading page reads `grounding_status`
7. when `grounding_status` becomes `ready`, the app enters the live session

### Locked v1 routing rule

Do not route newly created sessions directly from the dashboard into the live
session page.

Instead:

- dashboard submit should route into a preparation/loading route first
- only that loading route should transition into the live session after
  grounding succeeds

### Locked v1 loading-page state machine

Use a small frontend state machine:

- `creating_session`
- `grounding`
- `ready`
- `failed`

Meanings:

- `creating_session`: the dashboard submit is waiting for the backend to create
  the session record
- `grounding`: the session exists and preparation is in progress
- `ready`: preparation completed and the app can enter the live session
- `failed`: preparation failed and the loading page should offer retry

### Locked v1 backend support needed in Phase 2

Phase 2 should add only the minimal backend support needed for the loading page
to observe preparation state.

That means:

- one status-read path for `grounding_status` by `session_id`
- no grounding-job implementation yet
- no source extraction or RAG work yet

### Locked v1 frontend scope for Phase 2

Phase 2 should update:

- the dashboard navigation path for newly created sessions
- the new loading page UI and polling/status handling

Phase 2 should not yet change:

- resume flow for existing sessions
- live tutoring websocket behavior
- runtime grounding injection

### Phase 2 implementation boundary

At the end of Phase 2:

- a new session routes through a preparation page
- that page can read persisted grounding status
- the actual job execution still belongs to Phase 3

### Phase 2 technical scope

Current route surface:

- `frontend/client/MindPadApp.tsx`

Current dashboard entrypoint:

- `frontend/client/pages/Dashboard.tsx`

Current session API client:

- `frontend/client/api/sessions.ts`

Current live session page:

- `frontend/client/pages/SessionCanvas.tsx`

#### Frontend files expected to change

- `frontend/client/MindPadApp.tsx`
- `frontend/client/pages/Dashboard.tsx`
- `frontend/client/api/sessions.ts`
- add a new loading page such as
  `frontend/client/pages/SessionPreparation.tsx`

#### Backend files expected to change

- `backend/app/main.py`

#### Locked route direction

Add a preparation route between dashboard creation and live session entry.

Recommended route:

- `/session/:sessionId/preparing`

The final live route remains:

- `/session/:sessionId`

#### Locked dashboard navigation change

Current dashboard behavior routes new sessions directly to:

- `/session/:sessionId`

Phase 2 should change that to:

- `/session/:sessionId/preparing`

This applies to both:

- quick-start session creation from the dashboard prompt flow
- full session creation from the new-session modal

#### Locked backend API support for Phase 2

Add one minimal read endpoint for grounding status by `session_id`.

Recommended shape:

- `GET /v1/sessions/{session_id}/grounding-status`

Recommended response model:

- return `SessionGroundingStatus`

Phase 2 should not add:

- job start endpoint if Phase 3 can start or confirm the job from the loading
  page using the same session route or a later minimal trigger
- source extraction APIs
- RAG APIs

#### Locked loading-page behavior

The new preparation page should:

- read `sessionId` from the route
- fetch `grounding_status`
- render simple progress/loading copy for `processing` or `pending`
- transition into `/session/:sessionId` when status becomes `ready`
- render failure UI and retry affordance when status becomes `failed`

#### Locked polling direction

Keep Phase 2 simple:

- use polling from the preparation page
- do not add websocket-based preparation-state delivery yet

Recommended polling behavior:

- poll the grounding-status endpoint on a short interval while status is not
  terminal
- stop polling when status becomes `ready` or `failed`

#### Phase 2 explicit non-goals

Do not implement yet:

- actual background grounding execution
- retry backend behavior
- dashboard attachment upload changes beyond preserving the existing path
- resume-flow changes for existing sessions

### Phase 3: Grounding Job Skeleton

Goal:

Create the parent async grounding runner and deduped enqueue path.

Build:

- `_enqueue_grounding_job(session_id)`
- `_run_grounding_job(session_id)`
- dedupe so the same session does not start duplicate grounding jobs
- persisted status transitions across the grounding lifecycle

Done means:

- a session can start one background grounding job
- the job can move through `queued`, processing states, `ready`, and `failed`

Phase 3 implementation note:

- the first implementation may use a clearly labeled development shim that
  persists placeholder `study_plan` and `source_summary` artifacts plus a
  temporary knowledge-index reference so the startup loop can run end to end
- this shim is only for the Phase 3 skeleton and should be replaced in later
  phases by real source extraction, real hierarchical summarization, and real
  `Vertex AI RAG Engine` indexing plus verification
- code and product behavior should make this temporary shim explicit rather than
  silently presenting it as fully source-grounded preparation

### Phase 4: Source Extraction

Goal:

Normalize uploaded materials into a canonical parsed-source representation.

Build:

- source extraction helpers
- supported file-type handling for the first version
- one canonical parsed-source payload shared by summarization and RAG ingest

Done means:

- uploaded materials become normalized source text per document
- extraction failures are reflected in `GroundingStatusStore`

Locked v1 Phase 4 decisions:

- inputs are uploaded attachments plus learner prompt or goal text
- supported file types are `PDF`, `TXT`, and `Markdown`
- the normalized `parsed_source` shape stays lean:
  - `source_id`
  - `source_type`
  - `title`
  - `mime_type`
  - `text`
- `parsed_source` stays internal to the grounding runner in v1
- retries should re-extract from original session inputs each time
- uploaded source files should live in a dedicated session source-material store,
  not in checkpoints
- if prompt text exists and at least one attachment extracts successfully, the
  runner may continue even if another file fails
- otherwise grounding should fail rather than silently pretending extraction
  succeeded

### Phase 5: Hierarchical Summarization

Goal:

Generate `source_summary` and `study_plan` through the locked multi-step
strategy.

Build:

- per-document summary generation in parallel
- merge step into one session-level `source_summary`
- `study_plan` generation from learner prompt plus merged `source_summary`

Done means:

- `source_summary` artifact is persisted
- `study_plan` artifact is persisted
- no giant raw-corpus one-shot prompt is required

Locked v1 Phase 5 decisions:

- use real model generation now instead of placeholder artifacts
- use direct `google.genai` backend calls, following the notes and key-moments
  pattern already in the repo
- summarize attachment documents individually before merge
- generate the final `source_summary` from merged per-document summaries rather
  than from the raw full corpus in one shot
- generate the final `study_plan` from learner intent plus merged
  `source_summary`
- if one per-document summary fails, continue only when exactly one document
  summary succeeded
- otherwise fail grounding rather than quietly merging a partially summarized
  multi-document pack
- Phase 6 RAG ingestion and lookup verification remain out of scope for this
  phase

### Phase 6: Vertex AI RAG Integration

Goal:

Create and populate the session-bound Vertex AI RAG corpus.

Build:

- RAG corpus creation
- `text-embedding-005` corpus embedding configuration
- source ingest into the session corpus
- retrieval verification step before readiness

Done means:

- each grounded session has a valid `rag_corpus_id`
- ingestion succeeds
- lookup verification succeeds before the session becomes `ready`

### Phase 7: Runtime Grounding Injection

Goal:

Inject the right grounding artifacts into the correct runtime layers.

Build:

- orchestrator injection of `study_plan`
- interpreter injection of `study_plan + source_summary`
- reconnect/resume reinjection path

Done means:

- session start uses the persisted grounding bundle
- reconnect/resume restores grounding cleanly
- artifacts are not re-injected every turn

### Phase 8: `knowledge.lookup` Tool

Goal:

Expose source retrieval as a backend-owned orchestrator tool.

Build:

- `knowledge.lookup`
- session-bound corpus resolution from `session_id`
- compact tool result payload using retrieved snippets only

Done means:

- the orchestrator can retrieve exact source support for the active session
- corpus choice remains backend-owned

### Phase 9: Policy Integration

Goal:

Teach the orchestrator and second brain how to use the new grounding system.

Build:

- orchestrator tool-use policy for `knowledge.lookup`
- second-brain guidance for suggesting retrieval
- plan-first runtime behavior

Done means:

- retrieval is used intentionally
- `study_plan` and `source_summary` remain the primary grounding layers

### Phase 10: Failure And Retry

Goal:

Complete the product loop around preparation failures.

Build:

- loading-page failed state
- `Retry preparation` action
- backend retry path that re-enqueues the same grounding job for the same
  `session_id`

Done means:

- failed preparation does not drop into the live session
- retry can recover the session without creating a new one

### Phase 11: End-To-End Hardening

Goal:

Stabilize the full story from dashboard creation to grounded live session.

Build:

- success-path validation
- bad-material and no-material validation
- retry-path validation
- reconnect/resume validation
- `knowledge.lookup` validation inside a live session

Done means:

- the full pre-session grounding story works reliably end to end

## Recommended Execution Order

Build phases in this order:

1. Phase 1: Persistence Foundation
2. Phase 2: Session Startup Flow
3. Phase 3: Grounding Job Skeleton
4. Phase 4: Source Extraction
5. Phase 5: Hierarchical Summarization
6. Phase 6: Vertex AI RAG Integration
7. Phase 7: Runtime Grounding Injection
8. Phase 8: `knowledge.lookup` Tool
9. Phase 9: Policy Integration
10. Phase 10: Failure And Retry
11. Phase 11: End-To-End Hardening

## Recommended First Implementation Target

Start with **Phase 1: Persistence Foundation**.

Reason:

- every later phase depends on persisted grounding state
- it is the cleanest first slice
- it follows an existing repo pattern rather than inventing new architecture
