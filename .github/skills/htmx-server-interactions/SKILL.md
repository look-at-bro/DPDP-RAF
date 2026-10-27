---
name: htmx-server-interactions
description: "Build or review HTMX forms, links, search, pagination, filtering, HTML fragment responses, swaps, and browser-history behavior only in a project that explicitly uses HTMX. Do not use for this project's default React SPA or JSON API interactions."
argument-hint: "Describe the HTMX interaction and the server response it needs"
---

# HTMX Server Interactions

This skill applies only if the project owner explicitly adopts the optional HTMX/server-rendered architecture. The project baseline is a React SPA with an Express API; do not use HTMX for its normal UI/API interactions. When selected, follow [htmx-react-architecture](../htmx-react-architecture/SKILL.md): the server owns business logic and authorization, HTMX owns its HTML regions, and a mounted React root is never an ordinary HTMX swap target.

## Activate when

- Adding HTMX attributes to server-rendered links, forms, search, pagination, or controls.
- Implementing HTML fragment endpoints or HTMX-specific validation/error responses.
- Changing swaps, triggers, indicators, history, or out-of-band updates.
- Debugging authentication, CSRF, accessibility, or lifecycle behavior in an HTMX request.

## Responsibilities

- Use native links/forms as the baseline and HTMX as progressive enhancement.
- Specify each request/response contract, target, swap, status behavior, and accessible state.
- Avoid client-side state duplication when the server can render the canonical result.
- Coordinate safely with React island boundaries.

## Implementation workflow

1. **Inspect actual integration.** Confirm whether/how HTMX is loaded, version, script bundling/CSP conventions, server routes, templates, and tests. No HTMX package/integration was present in the inspected manifests; do not assume it exists or add it without a project decision.
2. **Start with semantic HTML.** Choose a real `href` or form `action`/`method` that works as an ordinary browser request. Add HTMX attributes to enhance that behavior, not replace its only usable path.
3. **Define the response contract.** Record method/path, validated inputs, authentication/authorization, normal and HTMX response types, target, swap strategy, status codes, error/redirect behavior, and history effects.
4. **Choose the smallest HTMX behavior.** Use only the attributes needed: `hx-get`, `hx-post`, `hx-put`, `hx-patch`, or `hx-delete` according to server semantics; `hx-target` and `hx-swap` to scope replacement; `hx-trigger` for a justified event; `hx-select` only when selecting from a larger HTML response; `hx-indicator` for visible progress; and `hx-boost` only when boosted navigation preserves expected page behavior.
5. **Render the response on the server.** Return the exact escaped HTML fragment expected at the target. Keep business rules, data access, validation, and permission checks on the server.
6. **Handle state-changing requests securely.** Apply the existing CSRF strategy, validate every request (including HTMX), and authorize every operation. Do not treat `HX-Request` as a trust or permission signal.
7. **Handle failure and empty states.** Return clear, accessible validation, empty, auth-expired, and error feedback. Align non-2xx status behavior with the installed HTMX version/configuration; do not fake success just to force a swap.
8. **Protect DOM ownership.** Do not target or swap inside a mounted React root. If a fragment contains island mount containers, coordinate with the React-island skill so outgoing roots are unmounted before removal and new roots mounted after insertion.
9. **Test browser and non-enhanced paths.** Test ordinary form/link operation, HTMX response shape, status handling, focus/status announcements, keyboard behavior, and history/back-forward behavior where relevant.

## Attribute selection guide

| Attribute | Use | Guardrail |
|---|---|---|
| `hx-get` | Read/search/filter/paginate server data. | Keep inputs bounded; choose cache behavior deliberately. |
| `hx-post` | Submit forms or create a resource. | Validate, authorize, and protect against CSRF. |
| `hx-put`, `hx-patch` | Update a resource using the application's established HTTP semantics. | Ensure method support and CSRF/auth middleware are correct. |
| `hx-delete` | Request deletion where the UI and server contract support it. | Confirm authorization and intentional confirmation/undo UX. |
| `hx-target` | Select the smallest region that should be replaced. | Never point it into an active React root. |
| `hx-swap` | Choose a specific insertion/replacement mode. | Default to the narrowest replacement; beware removing unrelated state/focus. |
| `hx-trigger` | Debounce search or listen for a meaningful event. | Avoid high-frequency requests without debouncing/limits. |
| `hx-select` | Extract a fragment from a server response that intentionally contains more HTML. | Prefer a dedicated fragment endpoint when simpler. |
| `hx-boost` | Progressively enhance ordinary same-origin links/forms. | Verify full page fallback, redirects, history, and page-level asset behavior. |
| `hx-indicator` | Show request progress. | Ensure it is visible to assistive technology and not the only feedback. |

## Illustrative example

This is a template-level example only. The repository has no selected template engine or HTMX integration yet; adapt syntax and error handling to actual conventions:

```html
<form action="/reports/search" method="get"
      hx-get="/reports/search"
      hx-trigger="submit"
      hx-target="#report-results"
      hx-swap="innerHTML"
      hx-indicator="#report-search-status">
  <label for="report-query">Search reports</label>
  <input id="report-query" name="q" type="search">
  <button type="submit">Search</button>
  <span id="report-search-status" role="status" aria-live="polite" class="htmx-indicator">
    Searching…
  </span>
</form>
<section id="report-results" aria-live="polite">
  <!-- Initial results are rendered by the server. -->
</section>
```

The server must validate and bound `q`, scope results to the authenticated user, and return the expected HTML for both ordinary navigation and HTMX enhancement. If the ordinary `GET` route returns a full page while HTMX expects a fragment, make that distinction explicit and tested.

## Interaction patterns

- **Form validation:** Re-render submitted values safely and provide field-associated errors (`aria-describedby`, `aria-invalid`) in the target. Preserve a usable non-HTMX response.
- **Search/filter:** Debounce text input where appropriate; bound query size and result count server-side; provide an empty state and clear-filter path.
- **Pagination:** Use real links with stable query parameters. Preserve filters; ensure the response and browser history behavior match the interaction.
- **Out-of-band swaps:** Use only when one response must update another independent region. Document each target and avoid hidden coupling or duplicate state.
- **Navigation/history:** Ensure normal URLs remain meaningful. Use history features only when back/forward and direct navigation render the same logical view.
- **Authentication expiry:** Return the application's deliberate sign-in response. Do not inject a login document into a table/panel; configure an appropriate redirect/event strategy for the installed HTMX version.
- **Focus and announcements:** After replacement, keep or move focus appropriately; expose validation/results/progress to assistive technology without unexpected focus jumps.

## Constraints and anti-patterns

- Do not put authorization or business decisions in `hx-*` attributes.
- Do not trust hidden form fields, client query strings, or `HX-Request` headers as proof of identity/permission.
- Do not use HTMX to replace a React-owned subtree.
- Do not maintain a duplicate client cache/store for server-rendered results without a concrete requirement.
- Do not attach unbounded polling or high-frequency triggers; apply limits and cleanup.
- Do not assume every non-2xx response swaps, or change a failure into `200` solely to force an update.
- Do not add inline event handlers or unnecessary JavaScript where an HTMX attribute/native control suffices.

## Verification checklist

- [ ] Ordinary link/form fallback works without HTMX.
- [ ] Correct method, target, swap, trigger, and response format are specified.
- [ ] Server validates, authenticates, authorizes, and applies CSRF controls as applicable.
- [ ] Validation, empty, error, loading, and auth-expiry states are intentional and accessible.
- [ ] Status-code handling matches the installed HTMX version/configuration.
- [ ] History, focus, and keyboard behavior remain usable.
- [ ] No swap enters a mounted React root; any inserted islands have a tested lifecycle.

## Related skills

- [htmx-react-architecture](../htmx-react-architecture/SKILL.md)
- [node-server-rendering](../node-server-rendering/SKILL.md)
- [react-island-components](../react-island-components/SKILL.md)
- [htmx-react-integration-testing](../htmx-react-integration-testing/SKILL.md)
