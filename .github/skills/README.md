# Project AI Skills

These project-scoped skills live under `.github/skills/` and use the VS Code/Copilot `SKILL.md` format. Invoke a skill with its slash command when available, or ask the agent for the matching kind of work; each description also supports automatic discovery.

## Skills

| Skill | Use it for | Relationship |
|---|---|---|
| [`react-spa-architecture`](./react-spa-architecture/SKILL.md) | Implementing the selected Vite/React Router SPA with an Express API, including routing, server data, forms, and trust boundaries. | Default application architecture guidance. The server remains authoritative for security and data. |
| [`repo-engineering-review`](./repo-engineering-review/SKILL.md) | Reviewing Git changes, commit messages, Node package changes, versions, changelogs, and release readiness. | Use for repository setup and engineering reviews. |
| [`htmx-react-architecture`](./htmx-react-architecture/SKILL.md) | Evaluating an explicitly requested alternative to the project's React SPA baseline: server-rendered Node.js pages with HTMX and React islands. | Optional alternative only; do not apply it as the project default. |
| [`node-server-rendering`](./node-server-rendering/SKILL.md) | Implementing or changing Node routes, HTML documents, templates, layouts, and HTML response rendering. | Use only if server-rendered HTML is explicitly selected. |
| [`htmx-server-interactions`](./htmx-server-interactions/SKILL.md) | Implementing server-driven browser interactions and HTML swaps with HTMX. | Use only if the project explicitly adopts or evaluates HTMX. |
| [`react-island-components`](./react-island-components/SKILL.md) | Implementing isolated React widgets mounted in server-rendered pages. | Use only for an explicitly selected hybrid design; it is not guidance for the React SPA baseline. |
| [`htmx-react-integration-testing`](./htmx-react-integration-testing/SKILL.md) | Testing routes, templates, HTMX responses, React islands, and browser workflows together. | Use only when the application explicitly adopts these hybrid integration boundaries. |

## Shared rules

The selected baseline is a React SPA using Vite/React Router with an Express API. Use `react-spa-architecture` for routine feature work. Keep business logic, authorization, validation, and protected data access on the server; the client is not a trust boundary. The hybrid architecture skills are optional alternatives, not defaults.

## Repository evidence and unresolved choices

At the time this index was reviewed (2026-10-21), the workspace included a root README, Vite/React SPA starter, Express API health endpoint, npm lockfile, and workspace `.env.example` templates. No authentication flow, domain API, HTMX integration, template engine, or test framework was present. Re-check before relying on these facts: a declared dependency does not prove that it is wired into an application.

The project owner selected the React SPA baseline on 2026-10-21. Treat the hybrid skills as optional alternatives and do not impose them on implementation work unless the owner explicitly changes the architecture. The current application is a starter, not a complete domain implementation; inspect actual files and scripts before adding features, and adapt examples to the tools that are actually configured.

## Adding a skill

1. Check whether an existing skill already owns the topic; extend it or link to it rather than duplicating rules.
2. Add `.github/skills/<lowercase-kebab-name>/SKILL.md` with matching `name` frontmatter and a specific, keyword-rich `description`.
3. Include activation conditions, a focused workflow, repository-aware adaptation guidance, constraints, a verification checklist, and links to related skills.
4. Put cross-cutting architecture policy in `htmx-react-architecture`; keep specialized implementation details in the relevant skill.
5. Add the skill to this index and validate its frontmatter, matching folder name, links, and relevant project checks. Do not add always-on instructions for an on-demand procedure.
