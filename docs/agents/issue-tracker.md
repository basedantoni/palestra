# Issue tracker: Linear

Issues and PRDs for this repo live in **Linear**, accessed via the Claude Linear MCP plugin (`mcp__plugin_linear_linear__*` tools). Ticket ids follow the `KOI-xx` convention and appear as trailing tags in commits (e.g. `feat(analytics): ... (KOI-101)`).

## Conventions

- **Create an issue**: `mcp__plugin_linear_linear__save_issue` (omit `id` to create). Set `title`, `description` (markdown), `team`, and `labels`.
- **Read an issue**: `mcp__plugin_linear_linear__get_issue` by id (`KOI-xx`).
- **List / search issues**: `mcp__plugin_linear_linear__list_issues` with filters (team, state, label, assignee, query).
- **Comment**: `mcp__plugin_linear_linear__save_comment` with the issue id.
- **Apply labels / change state**: `mcp__plugin_linear_linear__save_issue` with the existing `id`, updating `labels` or `state`.
- **Close**: set the issue's `state` to the team's Done/Canceled workflow state via `save_issue`.
- **Make an issue a sub-issue of a parent**: `save_issue` with `parentId: "KOI-xx"` (on create or update). List a parent's children with `list_issues` + `parentId`.
- **Blocking**: `save_issue` with `blockedBy: ["KOI-xx", ...]` (append-only; `removeBlockedBy` to drop). Read edges with `get_issue` + `includeRelations: true`.

Resolve the team and available states/labels with `list_teams`, `list_issue_statuses`, and `list_issue_labels` when needed.

## Pull requests as a triage surface

Not applicable — requests come in as Linear issues, not PRs.

## When a skill says "publish to the issue tracker"

Create a Linear issue via `save_issue`.

## When a skill says "fetch the relevant ticket"

Read the Linear issue via `get_issue` (or `list_issues` to find it).

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single Linear issue with **sub-issues** as tickets. Team: `KOI`.

- **Map**: one issue labelled `wayfinder:map`, holding the Destination / Notes / Decisions-so-far / Not-yet-specified / Out-of-scope body. `save_issue` with `team: "KOI"`, `labels: ["wayfinder:map"]`.
- **Child ticket**: a Linear sub-issue of the map (`save_issue` with `parentId: "<map id>"`). Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`), never triage labels. Once claimed, assigned to the driving dev.
- **Blocking**: Linear's **native** blocked-by relation, visible in Linear's UI. Wire in a second pass after all tickets have ids: `save_issue` on the child with `blockedBy: ["<blocker id>", ...]`. A ticket is unblocked when every blocker is in a completed, canceled, or duplicate state.
- **Frontier query**: `list_issues` with `parentId: "<map id>"`, `orderBy: "createdAt"`; keep children not in a completed/canceled/duplicate state and with no assignee; for each, `get_issue` with `includeRelations: true` and drop any with an open blocker. Oldest-created first wins.
- **Claim**: `save_issue` with `id` and `assignee: "me"`, the session's first write.
- **Resolve**: `save_comment` with the answer, then `save_issue` with `state: "Done"`, then append a context pointer (gist + link) to the map's Decisions-so-far via `save_issue` `patch` (`insert_after` under that heading).
- **Out of scope**: close with `state: "Canceled"` and add a line under the map's Out of scope.
- **Labels**: `wayfinder:map`, `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, `wayfinder:task` exist on team KOI.
