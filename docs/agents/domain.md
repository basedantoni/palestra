# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or
- **`CONTEXT-MAP.md`** at the repo root if it exists — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. In multi-context repos, also check `src/<context>/docs/adr/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

This is a **multi-context** repo (Turborepo monorepo). Presence of `CONTEXT-MAP.md` at the root signals this layout. Per-context `CONTEXT.md` files live alongside the packages they describe:

```
/
├── CONTEXT-MAP.md                     ← points at each context's CONTEXT.md
├── docs/adr/                          ← system-wide decisions
├── apps/
│   ├── web/
│   │   ├── CONTEXT.md
│   │   └── docs/adr/                  ← context-specific decisions
│   └── server/
│       ├── CONTEXT.md
│       └── docs/adr/
└── packages/
    ├── api/
    │   ├── CONTEXT.md
    │   └── docs/adr/
    └── db/
        ├── CONTEXT.md
        └── docs/adr/
```

(Contexts are created lazily — don't expect every package to have a `CONTEXT.md` until `/domain-modeling` writes one.)

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
