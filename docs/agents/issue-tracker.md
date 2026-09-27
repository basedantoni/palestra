# Issue tracker: Linear

Issues and PRDs for this repo live in **Linear**, accessed via the Claude Linear MCP plugin (`mcp__plugin_linear_linear__*` tools). Ticket ids follow the `KOI-xx` convention and appear as trailing tags in commits (e.g. `feat(analytics): ... (KOI-101)`).

## Conventions

- **Create an issue**: `mcp__plugin_linear_linear__save_issue` (omit `id` to create). Set `title`, `description` (markdown), `team`, and `labels`.
- **Read an issue**: `mcp__plugin_linear_linear__get_issue` by id (`KOI-xx`).
- **List / search issues**: `mcp__plugin_linear_linear__list_issues` with filters (team, state, label, assignee, query).
- **Comment**: `mcp__plugin_linear_linear__save_comment` with the issue id.
- **Apply labels / change state**: `mcp__plugin_linear_linear__save_issue` with the existing `id`, updating `labels` or `state`.
- **Close**: set the issue's `state` to the team's Done/Canceled workflow state via `save_issue`.

Resolve the team and available states/labels with `list_teams`, `list_issue_statuses`, and `list_issue_labels` when needed.

## Pull requests as a triage surface

Not applicable — requests come in as Linear issues, not PRs.

## When a skill says "publish to the issue tracker"

Create a Linear issue via `save_issue`.

## When a skill says "fetch the relevant ticket"

Read the Linear issue via `get_issue` (or `list_issues` to find it).
