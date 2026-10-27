---
name: node-server-rendering
description: "Implement or review server-rendered HTML pages, templates, layouts, and Node.js HTML response rendering only when this project explicitly selects server-rendered pages. Do not use for its standard Express JSON API or React SPA."
argument-hint: "Describe the route, page, or server-rendered response to implement"
---

# Node Server Rendering

Implement full HTML documents, templates, and HTML responses while keeping business logic, authorization, and data access on the server. This skill owns how the server constructs and renders HTML, including fragments when a route needs them. Use [htmx-server-interactions](../htmx-server-interactions/SKILL.md) for HTMX request attributes, target/swap decisions, triggers, history behavior, and interaction UX. Follow the ownership and DOM-boundary rules in [htmx-react-architecture](../htmx-react-architecture/SKILL.md).

## Activate only when server-rendered pages have been explicitly selected; this project otherwise uses a React SPA and Express API.

## Activate when

- Adding/changing a Node route, controller, service, template, layout, or server-rendered page.
- Rendering full documents, reusable templates, or HTML fragments from Node routes.
- Reviewing server-side validation, auth/session boundaries, response codes, or output encoding.
- Diagnosing why an HTMX interaction receives JSON, the wrong status, or a full document instead of a fragment.

## Responsibilities

- Preserve the existing Node framework, template engine, module system, route structure, and error conventions.
- Render the initial document on the server and return HTML fragments for appropriate HTMX interactions.
- Keep request parsing, validation, authentication/authorization, business logic, and data access on the trusted server boundary.
- Escape untrusted output in the correct HTML context and return deliberate HTTP statuses, redirects, and headers.

## Implementation workflow

1. **Inspect the repository.** Read server package scripts/dependencies, entry point, route/controller/service patterns, template engine, error middleware, session/auth setup, and relevant tests. Do not add a framework or template engine if none has been selected.
2. **Define the HTTP contract.** Specify method, path, accepted input, authentication/authorization, normal-navigation response, HTMX response, status codes, redirect behavior, and failure cases.
3. **Validate at the boundary.** Validate path, query, body, and uploaded data on the server using existing schemas/helpers. Reject invalid input with the established error flow; do not rely on browser validation alone.
4. **Enforce session and authorization rules.** Resolve identity from trusted session/token middleware. Check authorization for each resource/action. Never trust user IDs, roles, or other permission claims supplied by the browser. Apply CSRF protection to state-changing requests when the session/auth model requires it.
5. **Keep concerns separated appropriately.** Route/controller code adapts HTTP input/output; services apply business rules; data-access code uses safe, parameterized operations. Avoid unnecessary layers for a small existing codebase, but never move authorization into templates.
6. **Render the response body.** A normal page request should produce the complete HTML document/layout. When a route serves an HTMX interaction, render the HTML fragment that its documented interaction contract expects, or return the documented redirect/response. The HTMX skill owns the `hx-*` attributes, target/swap choice, trigger, history, and client-visible interaction behavior. Do not assume every `HX-Request` must be a fragment if the application contract says otherwise.
7. **Handle errors deliberately.** Use framework error handling and meaningful status codes. For HTMX requests return an accessible HTML error/validation fragment or a deliberate redirect according to the established UX; do not accidentally return JSON or a generic success-shaped response.
8. **Set appropriate response metadata.** Consider cache controls for personalized/sensitive pages, content type, security headers, and redirect semantics. Do not cache user-specific HTML publicly.
9. **Test both paths.** Verify complete-document navigation and fragment behavior, including validation, unauthenticated, unauthorized, not-found, and server-error cases.

## Framework-aware example

The repository's manifest currently declares Express, but there is no server source or template engine to establish a convention. The following is conceptual Express-style pseudocode; adapt it to the actual router, renderer, schema validation, session middleware, and service APIs rather than copying it as working code:

```js
router.post('/reports/search', requireUser, async (req, res, next) => {
  const parsed = searchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).render('reports/_search-errors', {
      errors: parsed.error.issues,
    });
  }

  try {
    const rows = await reportService.searchForUser(req.user.id, parsed.data);
    return res.status(200).render('reports/_results', { rows });
  } catch (error) {
    return next(error);
  }
});
```

The service must apply the authorization/data-scope rule itself or receive a trusted identity and enforce equivalent policy. Template rendering must escape untrusted data. Do not expose `req.user` wholesale to the browser.

## HTML and response guidance

- Use semantic templates and reusable layouts. Keep full document shells separate from reusable fragment templates when supported by the chosen engine.
- Render user-controlled text using the template engine's escaping behavior. Avoid raw/unescaped HTML helpers for untrusted values; when rich HTML is a real requirement, use an explicit, reviewed sanitization policy.
- Do not interpolate untrusted data into inline scripts, event-handler attributes, CSS, or URLs. Contextual HTML escaping does not make arbitrary JavaScript safe.
- Return a correct content type and status. Typical distinctions include `200` success, `201` creation where appropriate, `302/303` redirects after form posts according to the app contract, `401/403` auth failures, `404` missing resources, and `422` semantically invalid form input. Follow framework/app conventions.
- Use framework error middleware; do not swallow exceptions or return success-shaped fallback data.
- Use cache validators or caching only where correct for the data and authorization context.
- For HTMX validation errors, ensure the response status and HTMX client behavior are intentional. HTMX may not swap non-2xx responses by default; configure/document a deliberate response strategy rather than disguising failure as success.

## Constraints and anti-patterns

- Do not prescribe Express solely because it appears in dependencies; inspect the real server first.
- Do not render sensitive values, secrets, stack traces, raw database errors, or session identifiers into HTML or logs.
- Do not confuse CORS with authorization or CSRF protection.
- Do not return JSON to an interaction expecting HTML unless JSON is an explicit API contract.
- Do not duplicate business logic in templates or client scripts.
- Do not use unsafe SQL interpolation for user input.
- Do not add a second environment/configuration, validation, or error-handling mechanism without a need.

## Verification checklist

- [ ] Full page navigation returns a valid document and server-rendered initial content.
- [ ] HTMX endpoints return the fragment/document/redirect specified by the interaction contract.
- [ ] Inputs and authorization are checked on the server for each request.
- [ ] Templates contextually escape untrusted output.
- [ ] Auth, CSRF, validation, not-found, and unexpected-error paths use intentional responses.
- [ ] Sensitive personalized output has appropriate cache behavior and headers.
- [ ] Tests follow existing framework and repository conventions.

## Related skills

- [htmx-react-architecture](../htmx-react-architecture/SKILL.md)
- [htmx-server-interactions](../htmx-server-interactions/SKILL.md)
- [htmx-react-integration-testing](../htmx-react-integration-testing/SKILL.md)
