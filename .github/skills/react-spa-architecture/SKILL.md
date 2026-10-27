---
name: react-spa-architecture
description: "Design, implement, or review this project's React SPA using Vite and React Router with its Express API. Use for client routes, page/component boundaries, API integration, React Query data flow, forms, authentication boundaries, and SPA architecture."
argument-hint: "Describe the SPA feature, route, API interaction, or architecture decision"
---

# React SPA Architecture

Use this skill for the selected application architecture: a Vite-built React single-page application using React Router and a separate Express API. The browser owns rendering and transient interaction state; the server remains authoritative for identity, authorization, input validation, business rules, and protected data.

## Activate when

- Adding or changing React pages, client-side routes, layouts, reusable components, or application navigation.
- Integrating the React client with Express API endpoints.
- Managing server data, caching, invalidation, or mutations with React Query.
- Building validated forms with React Hook Form, Zod, and the existing resolver.
- Reviewing authentication, authorization boundaries, accessibility, or security in the SPA.
- Evaluating whether a feature belongs in the client or API.

## Current project evidence

The manifests declare React 19, React Router, React Query, React Hook Form, Zod, AG Grid, Vite, and an Express server package. The starter includes a Vite client, React Router entry, React Query setup, and an Express API with `GET /api/health`. Workspace `.env.example` files describe the client development proxy and server binding/request limits; local `.env` files are ignored. No authentication, domain API, or test framework is established yet. Recheck current source before choosing APIs or extending its patterns.

## Implementation workflow

1. **Inspect before editing.** Read the current client/server source, package scripts, Vite config, route setup, API conventions, shared schemas, environment handling, and relevant tests. Preserve established patterns; if there are none, choose the smallest coherent approach for the feature.
2. **Define client/server ownership.** React handles presentation, navigation, and transient interaction state. Express enforces authentication, authorization, validation, business logic, and data access on every request. Client route guards and hidden controls are UX only, never access controls.
3. **Define the API contract first.** Specify endpoint, method, request/response shape, status codes, authentication and authorization requirements, validation errors, and loading/empty/error behavior. Parse and validate untrusted input at the API boundary using existing schemas or established validation helpers.
4. **Use router state deliberately.** Put shareable navigation state (such as resource IDs, filters, and pagination where appropriate) in URLs. Keep local UI-only state in the smallest owning component. Avoid duplicate sources of truth for server data.
5. **Handle remote data consistently.** Use the configured React Query client for server state. Define stable query keys, scope cache entries to the relevant identity/tenant context, invalidate or update queries after mutations, and handle loading, empty, stale, and error states. Do not treat cached data as authorization.
6. **Validate forms at both boundaries.** Use React Hook Form and the existing Zod resolver for useful client feedback; independently validate every submitted value on the server. Render field-level and form-level failures accessibly and do not discard user input unnecessarily.
7. **Respect trust and credential boundaries.** Never place secrets, signing keys, or server credentials in Vite-exposed variables or client bundles. Do not select token storage, cookie, refresh, or CSRF behavior by assumption; inspect the established auth design. If cookie credentials are used, assess CSRF protections for state-changing requests. Keep CORS narrow and never use it as authorization.
8. **Keep components focused and accessible.** Prefer semantic HTML, labels, keyboard operation, visible focus, and accessible status/error messages. Use AG Grid only where its data-grid behavior is needed; configure columns and data according to existing conventions and avoid exposing unauthorized fields.
9. **Test the actual boundaries.** Follow the installed test tools. Cover route behavior, user-visible states, API validation/authorization, mutation effects, and critical navigation flows. Do not invent commands or report unrun checks.
10. **Run real project validation.** Check package scripts before invoking lint, build, or test commands. Do not claim the application builds if source/configuration or a build script is absent.

## Security and reliability constraints

- Never rely on client-side route guards, role props, query parameters, or UI visibility to authorize a request.
- Do not return secrets or unnecessary personal/sensitive fields in API responses or serialized client state.
- Do not interpolate untrusted content into HTML. Use React's normal text rendering; review any raw HTML mechanism and require an explicit sanitization policy.
- Bound and validate server inputs, pagination, uploads, and expensive queries; apply authorization before returning protected records.
- Use parameterized database operations and deliberate error responses. Do not reveal stack traces, SQL details, tokens, or internal secrets to the browser.
- Avoid storing authentication tokens in browser storage unless the project has explicitly selected and reviewed that threat model.
- Do not assume CORS, client validation, HTTPS alone, or a security-related dependency replaces server-side authorization and input checks.
- Preserve compatible keyboard, screen-reader, responsive, and error behavior when changing UI.

## Verification checklist

- [ ] Current source, scripts, API conventions, and auth design were inspected.
- [ ] Server enforces authorization and validates all untrusted input.
- [ ] Client API contracts and query invalidation match server behavior.
- [ ] Loading, empty, validation, auth, and unexpected-error states are intentional.
- [ ] No secrets or unauthorized data are included in the client bundle or responses.
- [ ] Forms and navigation are keyboard accessible and have meaningful labels/statuses.
- [ ] Only existing, runnable validation commands are reported as run.

## Related skills

- [repo-engineering-review](../repo-engineering-review/SKILL.md)
- [htmx-react-architecture](../htmx-react-architecture/SKILL.md) (optional alternative; use only when explicitly requested)
