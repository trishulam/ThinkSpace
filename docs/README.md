# ThinkSpace Architecture Docs

This directory contains shared architecture and product-design notes for the proactive tutor system that spans both the frontend and backend.

## Docs

- `agent-tool-catalog.md`
  Living Story A1 source of truth for orchestrator-facing tool families. This
  is where locked tool-family decisions should be recorded as the catalog
  evolves.

- `tool-result-contract.md`
  Living Story Group B reference for the common backend tool result envelope,
  lifecycle semantics, and v1 contract boundaries.

- `frontend-action-contract.md`
  Living Story Group C reference for the shared frontend action envelope,
  locked v1 action types, and current action-contract boundaries.

- `flashcards-end-to-end-scratchpad.md`
  Working scratchpad for Story Group D. Use this as the tactical thinking pad
  for sequencing flashcard implementation across frontend and backend.

- `implementation-stories.md`
  Ordered implementation story plan with dependencies, tasks, execution notes, and a two-day coding sequence for building the full proactive tutor system.

- `proactive-tutor-system.md`
  Shared system architecture for the voice orchestrator, subagents, digests, frontend action contracts, proactivity policy, and output surfaces.

- `adk-live-integration.md`
  Official-ADK-aligned notes for how Google ADK Live maps onto the ThinkSpace architecture, including `send_content()`, `send_realtime()`, `run_live()`, event handling, modality constraints, and tool execution implications.

## Related

- `../PROACTIVE_TUTOR_ARCHITECTURE.md`
  Earlier working architecture note from the initial discussion. Keep for historical reference; the docs in this directory are intended to be the clearer shared reference set for future development cycles.
