---
name: react-island-components
description: "Build isolated React widgets mounted inside Node server-rendered pages only when the project explicitly selects a hybrid React-islands architecture. Do not use for the default full React SPA."
argument-hint: "Describe the widget, server-rendered mount point, and interactions it needs"
---

# React Island Components

Use React for a designated complex widget, not as the owner of the surrounding page. The server renders the document and owns business logic/authorization; React owns only its mounted root. Follow [htmx-react-architecture](../htmx-react-architecture/SKILL.md) and coordinate swapped fragments with [htmx-server-interactions](../htmx-server-interactions/SKILL.md).

## Activate when

- A hybrid application needs a chart, analytics dashboard, dense data grid, or similarly rich local interaction inside a server-rendered page.
- Adding a React mount container or island registration/bootstrap entry.
- Passing server data to a widget or handling multiple widgets per page.
- Coordinating React roots with HTMX swaps, page navigation, or cleanup.

## Responsibilities

- Verify the actual React version, build system, existing component conventions, and mount APIs before implementation.
- Keep island boundaries explicit and independent of ordinary page routing.
- Safely serialize display props; never treat client props as authorization.
- Ensure roots, events, subscriptions, observers, and other resources are cleaned up exactly once.

## Implementation workflow

1. **Confirm the island model is selected.** This workflow is for an isolated widget in a hybrid server-rendered app, not for a full React application. Within that hybrid, compare the requirement to native HTML and HTMX, identify the complex local interaction that justifies the widget, and define its smallest DOM boundary.
2. **Inspect current setup.** Read the client manifest, installed React version if available, Vite/build config, entry points, CSS, server templates, and current HTMX lifecycle strategy. Confirm the actual setup before adapting this island-specific guidance.
3. **Create the server-owned mount point.** Render a stable element with an explicit island identifier and instance-specific data. The surrounding page and fallback remain usable server-rendered HTML.
4. **Pass only display/input props.** Validate source data server-side, apply server authorization before serialization, omit secrets and unnecessary personal data, and treat every prop as untrusted when it returns in a later request.
5. **Serialize safely.** Use the framework's safe JSON serializer and contextual HTML escaping. For JSON embedded in a `<script type="application/json">` element, ensure characters such as `<` are safely escaped so data cannot terminate the element; never interpolate raw JSON into executable script. For attributes, HTML-escape the complete serialized attribute value. Test hostile strings.
6. **Register/mount roots idempotently.** In the island architecture, scan only designated mount nodes on initial page load and after HTMX content insertion. Prevent duplicate roots for the same element and support multiple instances. A full React application should use its application-root bootstrap instead.
7. **Integrate teardown before removal.** When HTMX will replace/remove a region containing roots, unmount those roots before their DOM is discarded using lifecycle hooks supported by the installed HTMX version. Remove registry references and clean component effects, subscriptions, observers, timers, and global listeners.
8. **Keep DOM ownership exclusive.** HTMX may replace the server-owned container only after React has unmounted. It must not swap into React-managed descendants. React code must not mutate sibling/ancestor DOM managed by HTMX.
9. **Provide complete widget states.** Implement loading, empty, error, and retry states; keep server-rendered fallback or explanation where practical. Fetch/mutate data through authorized server endpoints.
10. **Bundle efficiently and verify.** Reuse the current Vite entry/build strategy. Split heavy widgets where the installed bundler supports it; load only assets needed by the page. Test initial mount, repeated scans, multiple instances, HTMX replacement, and cleanup.

## Illustrative mount pattern

This browser-side pseudocode is not a drop-in implementation. Confirm React root APIs and HTMX event names against the versions actually installed and loaded:

```js
const roots = new Map();

function mountIslands(scope = document) {
  scope.querySelectorAll('[data-react-island]').forEach((element) => {
    if (roots.has(element)) return;

    const props = JSON.parse(element.dataset.props || '{}');
    const root = createRoot(element);
    roots.set(element, root);
    root.render(renderIsland(element.dataset.reactIsland, props));
  });
}

function unmountIslandsWithin(element) {
  for (const [container, root] of roots) {
    if (container === element || element.contains(container)) {
      root.unmount();
      roots.delete(container);
    }
  }
}
```

Wire mounting and teardown to documented lifecycle points for the project's HTMX version. Do not assume `querySelectorAll` includes the scope itself; account for an inserted/replaced element that is itself a mount container. Ensure `createRoot`, `renderIsland`, prop parsing, and error handling follow the actual codebase. A `Map` is illustrative; avoid unnecessary global registries if a small page-scoped lifecycle manager already exists. In a full React application, follow its normal application-root setup instead of using this island pattern.

## Props and server boundaries

- Treat serialized props as an initial display snapshot, not as trusted authorization state.
- Use stable, non-sensitive identifiers only where the widget needs them; the server must re-check permissions on every follow-up request.
- Avoid embedding large datasets, secrets, tokens, or records the user is not authorized to view.
- Prefer server-side HTML fallback for content that must be available before scripts load; use a clear widget placeholder if a meaningful fallback cannot be rendered.
- Keep React state local to the widget. Share state only when there is a concrete interaction requirement and define one authoritative owner.
- Escape data according to the context (HTML text, attribute, URL, or JSON container); one encoding is not interchangeable with another.

## Lifecycle and multiple instances

- Mount only marked, connected elements and make setup idempotent.
- Handle both initial document load and fragment insertions.
- If an HTMX target is an ancestor of an island, unmount every contained root before swap cleanup/removal. If exact timing cannot be guaranteed, change the swap boundary instead.
- Do not unmount on unrelated HTMX requests or leave a detached root in a registry.
- Components must clean their own effects/resources on unmount.
- Give each instance scoped props and DOM queries; avoid global element IDs that collide across instances.
- Report malformed props as a widget error rather than throwing an unhandled global exception or silently rendering misleading content.

## Constraints and anti-patterns

- When using the island architecture, do not mount the whole page into one React root by default; a full React application should follow its own application-root architecture.
- Do not use unsupported React APIs or assume version support.
- Do not let HTMX swap within a mounted React root or let React directly manipulate HTMX-owned nodes.
- Do not double-mount on `DOMContentLoaded` plus HTMX events.
- Do not serialize authorization claims, credentials, or unbounded sensitive datasets into HTML.
- Do not introduce a client-side router/store for page concerns already owned by the server.
- Do not add dependencies or a second bundler without a demonstrated need.

## Verification checklist

- [ ] The widget is justified and its mount boundary is explicit.
- [ ] The server renders the page and authorizes data before props are emitted.
- [ ] Props are contextually and safely serialized; hostile-content cases are tested.
- [ ] React API usage matches the installed version.
- [ ] Multiple instances and repeated mount scans are safe.
- [ ] HTMX tears down outgoing roots before removal and mounts inserted roots once.
- [ ] Component effects/resources clean up and detached roots are not retained.
- [ ] Loading, error, retry, empty, accessibility, and no-script behavior are considered.

## Related skills

- [htmx-react-architecture](../htmx-react-architecture/SKILL.md)
- [htmx-server-interactions](../htmx-server-interactions/SKILL.md)
- [htmx-react-integration-testing](../htmx-react-integration-testing/SKILL.md)
