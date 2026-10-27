---
name: htmx-react-architecture
description: "Evaluate an explicitly requested alternative to this project's React SPA baseline: a hybrid Node.js server-rendered application using HTMX and React islands. Use only when the project owner asks to reconsider or adopt that alternative."
argument-hint: "Describe the feature or architectural decision to evaluate"
---

# HTMX + React Architecture

Define the boundary for the optional hybrid architecture where a Node.js server renders pages, HTMX enhances server interactions, and React is reserved for selected complex widgets. The project owner selected a React SPA using Vite/React Router with an Express API as the baseline. Do not apply this skill to ordinary implementation work or let it override that baseline; use it only when the owner explicitly requests evaluating or adopting the hybrid alternative. This skill is the source of shared rules for that alternative.

## Activate when

- Explicitly comparing the React SPA baseline with a proposed server-rendered/HTMX alternative.
- Planning or reviewing an owner-requested migration to server-rendered pages with React islands.
- Defining template, HTMX, or React-island boundaries after the hybrid alternative is selected.
- Coordinating HTMX swaps with React lifecycle behavior in that hybrid design.

## Responsibilities and ownership

| Concern | Owner | Default |
|---|---|---|
| Business rules, authorization, data access, validation, and HTTP response decisions | Node.js server | Authoritative; never trust UI state or props for permission decisions. |
| Initial document, page structure, forms, links, and content (in the selected hybrid design) | Server-rendered templates | Return usable HTML for ordinary browser navigation. |
| Server-backed interaction that can be expressed as an HTML response and swap (in the selected hybrid design) | HTMX | Request server-rendered HTML; do not recreate server state in a client store. |
| Rich local interaction, visualization, or complex widget behavior (in the selected hybrid design) | React island | Mount only in a designated container; keep its DOM subtree React-owned. |
| Shared cross-request data and security state | Server/session/database | Client copies are display state only and must be revalidated by the server. |

### Decision table

| Need | Use | Example |
|---|---|---|
| Static content, navigation, a basic form, or simple controls | Ordinary HTML and server response | A details page with a standard link and POST form. |
| Search, pagination, form validation response, or a server-backed panel/table update | HTMX requesting server-rendered HTML | A filtered results fragment replaces `#results`. |
| Dense chart interactions, complex grid behavior, drag editing, or a multi-step local visualization | React island, after confirming a real interaction need | A dashboard chart rendered inside a server-created mount element. |
| Authorization, business decisions, data validation, or persistence | Node server, regardless of UI technology | Re-check record access on every request, including HTMX requests. |

When the hybrid design is selected, prefer the least client-side machinery that delivers the requirement. React is justified for a widget with substantial local interaction or an ecosystem/component need materially harder to meet with native controls and HTMX. This does not make a full React application inappropriate when that is the chosen design.

## Architecture workflow

1. **Confirm the requested decision.** The current baseline is a React SPA with an Express API. Use this workflow only when the project owner explicitly asks to evaluate or adopt the hybrid alternative.
2. **Discover before designing.** Inspect the actual server entry point, route structure, package manifests, scripts, templates, asset/build configuration, and tests. Dependency declarations alone do not establish how a framework is used. Confirm that HTMX, a template engine, and a server-rendering pipeline are selected before implementing this alternative.
3. **Define the user workflow and response shape.** Decide whether a normal navigation should return a complete HTML document, and whether an enhanced interaction should return a fragment, redirect, or deliberate non-HTML response.
4. **Assign one owner per concern and DOM subtree.** Keep business policy and authorization on the server. Let HTMX own ordinary HTML regions and React exclusively own the children of mounted island roots.
5. **Choose the smallest client behavior.** Use native HTML first, HTMX for server-renderable changes, and React only for an isolated widget with a concrete need.
6. **Place code in existing project conventions.** Follow the repository's actual module system, framework, templates, route organization, asset pipeline, and naming. Do not impose an unselected framework or directory layout.
7. **Plan boundaries and lifecycle.** Identify which HTML may be swapped, how a React island is mounted/unmounted, and what happens when an island-containing fragment is replaced. HTMX must not replace a mounted React root unless an explicit lifecycle integration safely unmounts it first.
8. **Review security, accessibility, and resilience.** Validate untrusted data server-side, authorize each operation, protect state-changing requests from CSRF as applicable, use semantic HTML, preserve keyboard operation, and provide loading/error/empty states.
9. **Verify the hybrid alternative.** Test direct document navigation without relying on client JavaScript, HTMX response behavior, and each React island lifecycle.

## Placement guidance

Use existing project conventions first. If the repository lacks a convention, propose a layout only after confirming the selected framework:

- Server routes/controllers and services belong to the server package. Keep request/response adaptation separate from business/data-access logic where that improves clarity.
- Templates and reusable layouts belong to the server-rendering layer supported by the chosen framework and engine.
- HTMX attributes usually live on server-rendered HTML elements; their target fragments remain server-rendered.
- In the selected hybrid design, React island components and their mount/bootstrap entries belong in the existing client asset/build structure; do not make a client router the owner of ordinary pages.
- Shared schemas/types may be shared only when the repository has a clear package boundary and sharing does not move authorization into the client.

## Framework adaptation

- If Express is in use, adapt examples to the existing routers and rendering middleware; do not add a template engine until selected.
- If another Node framework is present, use its route, view, validation, and error conventions instead of layering Express patterns over it.
- If the app uses a framework that already owns SSR and routing, preserve its document/render pipeline and integrate HTMX/islands through its supported mechanisms.
- Confirm installed React version and use its supported root APIs. Do not infer support from a generic example.
- The React SPA is the selected baseline. Do not propose or implement a switch to the hybrid alternative unless the project owner explicitly requests that evaluation or change.

## Correct and incorrect choices

**Correct:** The server renders an account page and a normal HTML form. HTMX enhances submission by replacing a results/status region with a server-rendered response. A complex chart mounts in a separate `data-react-island` container. Server routes validate inputs and authorize the account on both normal and HTMX requests.

**Incorrect within an already selected hybrid design:** Change ordinary page routing to React solely because one page has a chart; duplicate server-backed account data in React state and templates; let HTMX replace children of an active React root; or accept a user ID/role in React props as proof of authorization. A React SPA remains the selected project baseline.

## Constraints and anti-patterns

- Do not let React and HTMX manage the same DOM subtree.
- Do not let React directly mutate HTMX-owned DOM or let HTMX swap inside a mounted React root without a documented safe lifecycle strategy.
- Do not create a second source of truth for the same server-backed UI state.
- Do not expose secrets or trust client props/hidden fields for authorization.
- Do not impose HTMX, a template engine, React islands, a SPA router, or another rendering architecture without a demonstrated need and repository-owner decision.
- Preserve semantic HTML, keyboard access, visible focus, meaningful labels, and non-JavaScript behavior where practical.

## Verification checklist

- [ ] In this hybrid alternative, initial routes return usable server-rendered HTML documents.
- [ ] Every business rule, validation, data access, and authorization decision remains server-side.
- [ ] Each interactive region has a single DOM owner.
- [ ] HTMX swaps do not remove active React roots without safe unmounting.
- [ ] In this hybrid alternative, React is limited to justified, isolated widgets; ordinary navigation remains server-owned.
- [ ] Direct navigation, error responses, keyboard/accessibility behavior, and progressive enhancement are considered for the selected hybrid alternative.
- [ ] Examples and commands follow the framework and tools actually present.

## Related skills

- [node-server-rendering](../node-server-rendering/SKILL.md)
- [htmx-server-interactions](../htmx-server-interactions/SKILL.md)
- [react-island-components](../react-island-components/SKILL.md)
- [htmx-react-integration-testing](../htmx-react-integration-testing/SKILL.md)
