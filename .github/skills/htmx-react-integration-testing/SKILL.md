---
name: htmx-react-integration-testing
description: "Test a hybrid server-rendered Node.js application using HTMX and React islands only when the project explicitly adopts that architecture. Do not use for the default React SPA and Express JSON API."
argument-hint: "Describe the user workflow or HTMX/React boundary you need to verify"
---

# HTMX + React Integration Testing

For a project that has selected the hybrid architecture, verify the server-rendered page, HTMX response contract, and React island lifecycle together. Use the shared rules in [htmx-react-architecture](../htmx-react-architecture/SKILL.md); do not impose these test layers on a project that has not selected that design.

## Activate when

- Adding or changing routes, templates, HTMX interactions, or React island bootstrapping.
- Testing validation, authorization, CSRF, error, or session-expiry behavior.
- Debugging duplicate mounts, stale widgets, incorrect swaps, or resource leaks.
- Establishing integration/browser checks for hybrid workflows.

## Responsibilities

- Discover and reuse the installed test, DOM, browser, and accessibility tools.
- Verify server-side policy and response shapes independently of client rendering.
- Cover lifecycle boundaries where HTMX and React meet.
- Report commands only when defined and runnable; do not install test tooling speculatively.

## Testing workflow

1. **Inspect the test environment.** Read package scripts, installed dependencies/lockfile, test configuration, server bootstrap, client bundling, template engine, HTMX version, and existing fixtures. Verify current files before choosing test commands or adding a framework.
2. **Map the workflow and trust boundary.** Identify initial page request, form/control request, HTMX response, React mount point, subsequent widget requests, auth/authorization, CSRF, and failure states.
3. **Test business logic independently.** Unit-test validation, authorization policy, service rules, data transformation, and error mapping using existing patterns.
4. **Test routes and templates.** Assert full documents for ordinary navigation and the expected fragment/content type/status for HTMX interactions. Verify output escaping and that unauthenticated/unauthorized requests cannot retrieve data.
5. **Test HTMX contracts.** Cover methods, target-specific fragment shape, status handling, validation errors, empty states, auth expiry, CSRF, pagination/filtering, and ordinary non-HTMX fallback.
6. **Test React components.** Test rendering, interactions, loading/error/empty states, accessible semantics, and resource cleanup with existing component tools.
7. **Test integration lifecycle.** Verify initial mount, multiple instances, repeated discovery idempotence, HTMX insertion, teardown before removal, swap behavior, and no React operations in HTMX-owned DOM.
8. **Test real browser behavior when justified.** Use existing browser automation to exercise direct page navigation, no-JavaScript fallback where practical, keyboard/focus behavior, history/back-forward, network/error conditions, and complete workflows.
9. **Run focused then broader checks.** Prefer relevant existing test selectors/scripts, then lint/build as appropriate. Record exact commands and outcomes. If the framework/tools are absent or dependencies are not installed, say validation is blocked/unavailable instead of inventing a passing result.

## Coverage matrix

| Layer | Essential assertions |
|---|---|
| Business/service unit tests | Valid/invalid input, authorization decisions, boundary conditions, error propagation, and data scope. |
| Server route tests | Correct method/path, schema validation, session/auth, CSRF, access control, status, redirect, and response content type. |
| Template tests | Initial document and fragment structure; escaped user content; labels, field errors, empty/loading/status regions. |
| HTMX interaction tests | Correct method/target response contract, partial HTML, non-2xx behavior, fallback route, pagination/filtering, and auth expiry. |
| React component tests | User-visible behavior, props boundaries, loading/error/empty/retry, keyboard and accessible semantics, effect cleanup. |
| Browser integration | Document navigation, HTMX swap lifecycle, React mount/unmount, multiple widgets, history/focus, and a full user workflow. |

## Illustrative workflow example

For a report-search page, adapt these assertions to the actual route and test framework:

1. A normal `GET` returns a complete HTML document with the search form and initial server-rendered results.
2. A valid enhanced search request returns the expected results fragment, scoped to the authenticated user, with no unrelated page shell.
3. Invalid input returns the documented validation response with field-associated errors; a request without HTMX still has a usable response.
4. An unauthenticated or unauthorized request does not reveal report data, regardless of whether it includes an `HX-Request` header.
5. If the response inserts a React chart mount, the widget mounts once. Repeating island discovery does not create a second root.
6. Replacing that fragment unmounts the outgoing root and cleans its resources before removal; the newly inserted instance mounts once.
7. Keyboard navigation, focus, result/status announcements, empty results, and server errors remain understandable.

## Critical regressions to catch

- HTMX replaces a subtree containing a mounted React root without first unmounting that root.
- React mounts twice after initial page load plus an HTMX insertion/lifecycle event.
- A detached React root, listener, timer, subscription, observer, or request remains alive after a swap.
- HTMX response contains a full document where the target expects a fragment, or JSON where HTML is expected.
- Non-HTMX navigation/form submission does not work because the feature depends entirely on JavaScript.
- Error/validation responses are returned as success-shaped `200` data or do not match HTMX's configured swap behavior.
- A client-supplied prop, hidden input, or UI-only route guard is treated as authorization.
- Tests assert implementation details while missing accessible names, focus, status announcements, or meaningful response behavior.

## Tool and command adaptation

- Use existing scripts from the root/workspace manifests and current package manager. The observed manifests use npm workspaces, but root script names and workspace selectors need to be checked before use.
- Do not invent `npm test`, Playwright, Vitest, Jest, Testing Library, or other commands unless present or explicitly introduced.
- Do not install dependencies merely to make an assumed test command work.
- If no tests exist yet, recommend the smallest test layers needed for the changed behavior; ask before adding a framework if that choice is consequential.
- Keep browser tests focused and deterministic; avoid external production systems or real credentials.

## Constraints and anti-patterns

- Do not claim full integration is verified by a unit test or a build alone.
- Do not use real secrets, production data, or destructive external systems in tests.
- Do not mock away the authorization or lifecycle behavior under test.
- Do not create flaky timing-based HTMX tests when the installed tools offer observable events or deterministic waits.
- Do not write tests for an invented framework setup as if it were current repository practice.

## Verification checklist

- [ ] The normal server-rendered page and enhanced interaction are both covered.
- [ ] Server validation, authorization, CSRF (where applicable), and error responses are exercised.
- [ ] HTML fragments and status codes match the HTMX contract.
- [ ] React mount, duplicate prevention, teardown, and multiple instances are covered.
- [ ] No active root is replaced without unmounting; no React/HTMX DOM ownership overlap remains.
- [ ] Accessibility and keyboard/focus behavior are tested at the appropriate level.
- [ ] Only real repository commands/tools are reported as run, with outcomes.

## Related skills

- [htmx-react-architecture](../htmx-react-architecture/SKILL.md)
- [node-server-rendering](../node-server-rendering/SKILL.md)
- [htmx-server-interactions](../htmx-server-interactions/SKILL.md)
- [react-island-components](../react-island-components/SKILL.md)
