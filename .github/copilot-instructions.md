# Project Coding Instructions

Apply these rules to code and documentation changes throughout this repository. Inspect the current source and package scripts before relying on an existing pattern; a dependency being declared does not prove it is configured or used.

## Simplicity and Language

- Prefer the smallest clear implementation that solves the requested problem. Use modular, readable JavaScript and avoid unnecessary abstractions, indirection, generic frameworks, duplicate state, and speculative features.
- The project uses native JavaScript ES modules. Write `.js` and `.jsx`; do not introduce TypeScript, `.ts`/`.tsx` files, type syntax, or TypeScript tooling. The presence of `@types/react` does not change this rule.
- Build React UI from functional components and React's built-in state/effect/context APIs when appropriate. Follow the existing component and hook patterns; do not add a state-management library.
- Keep components focused. Extract a component or helper when it improves reuse or makes meaningful logic easier to understand, not merely to shorten a file.

## Use Existing Packages

Prefer an appropriate package already declared in the relevant workspace over a hand-written substitute. First inspect the installed version and current project usage; use APIs supported by that version. Do not use a package just because it is available when a simple built-in is clearer.

### Client packages

- React UI: `react` `^19.3.1`, `react-dom` `^19.3.1`.
- Navigation: `react-router` `^8.5.0`. Use it for routes, links, and navigation; do not replace it with manual History API handling or add `react-router-dom` without approval.
- Server state and API caching: `@tanstack/react-query` `^5.104.5`. Use it for remote data fetching, caching, mutations, and invalidation rather than building a custom cache.
- Forms and validation: `react-hook-form` `^7.90.0`, `@hookform/resolvers` `^5.2.2`, and `zod` `^4.6.7`. Prefer these for form state and schema validation instead of hand-written validation frameworks.
- Data tables: `ag-grid-react` and `ag-grid-community` `^36.2.0` when full grid behavior is needed. Do not use a grid for a simple static table.
- Icons: `lucide-react` `^1.61.0`; do not draw replacement icons by hand when a suitable icon exists.
- Styling/build integration: `tailwindcss` and `@tailwindcss/vite` `^4.3.3`, configured through Vite. Reuse the existing styling setup instead of adding another CSS framework.

### Server packages

- HTTP API: `express` `^5.3.0`.
- Input validation: `zod` `^4.6.7`; validate untrusted input on the server even when the client also validates it.
- SQL Server access: `mssql` `^12.7.10`. Follow existing repository patterns and parameterize database operations.
- Security and request handling: `helmet` `^8.3.0`, `cors` `^2.8.6`, `express-rate-limit` `^8.7.1`, `cookie-parser` `^1.4.7`, and `jsonwebtoken` `^9.0.3`. Reuse these where appropriate; their presence does not replace correct configuration, authorization, or validation.
- Environment and logging: `dotenv` `^18.0.8` and `pino` `10.4.0`. Never expose server secrets in client code or `VITE_` variables.
- File/data features: `multer` `^2.4.0`, `pdfkit` `^0.20.2`, `read-excel-file` `^9.3.12`, and `write-excel-file` `^4.1.1`; use them only when the requested feature needs their specific capability.

### Development and verification tools

- Client build/dev server: `vite` `^8.3.5`, `@vitejs/plugin-react` `^6.1.2`.
- React compiler-related packages declared in the client workspace: `@babel/core` `^8.0.7`, `@rolldown/plugin-babel` `^0.2.4`, and `babel-plugin-react-compiler` `^1.0.0`. Do not assume they are active; inspect Vite configuration before changing compiler behavior.
- React development support: `@types/react` `^19.3.0`, `@types/react-dom` `^19.3.0`; these do not authorize TypeScript.
- Root checks: `eslint` `^10.13.0`, `@eslint/js` `^10.0.1`, `eslint-plugin-react-hooks` `^7.1.1`, `eslint-plugin-react-refresh` `^0.5.7`, `globals` `^17.13.0`, and `oxlint` `^1.89.0`. Follow the existing configurations.
- Server test packages: `supertest` `^7.3.1` and `jest` `^30.5.2` are declared, but the server's current test script is `node --test`. Check the script and existing tests before choosing a test runner; do not assume Jest is configured.
- Runtime requirements: Node.js `>=22.22.0` and npm `>=11.0.0`; the root package declares npm `11.17.0` as its package manager.

Do not install or recommend additional external npm packages unless the task cannot reasonably be completed with the existing packages and built-in platform APIs. If a new package appears essential, explain the specific gap and ask before adding it. Do not replace an existing package with a custom workaround for functionality that package already provides.

## Structure and Naming

- Keep client code under `apps/client/src` and server code under `apps/server/src`. Respect the existing boundaries: client routes and shared UI belong in their existing route/component areas; server HTTP routes, services, repositories, database code, configuration, and utilities belong in their corresponding server areas.
- Keep API/data access on the server. Do not move secrets, authorization decisions, database access, or trusted business rules into the browser.
- Name React component files and component functions in `PascalCase`. Name hooks `useCamelCase` and other functions, variables, and utility files in `camelCase`. Use descriptive names and match neighboring conventions where they already exist.
- Add a file or folder only when it has a clear role. Avoid barrel files and catch-all utility modules unless the project already uses them for a concrete purpose.

## Behavior and Quality

- Handle meaningful loading, error, empty, success, and validation states. Keep server errors distinct from empty results; provide a useful retry or recovery path where appropriate.
- Use React Router for navigation and React Query for remote state when those concerns are involved. Avoid duplicating URL, component, and query-cache state without a clear reason.
- Use React Hook Form with the existing Zod resolver for validated forms when appropriate. Validate API inputs independently with server-side Zod schemas; never treat browser validation as a security boundary.
- Use semantic HTML, accessible labels, keyboard operation, and visible focus. Make status and error messages perceivable to assistive technology.
- Keep API responses and client state limited to necessary data. Never commit credentials or expose server-only environment values in client bundles.
- Add focused tests using the test runner established by the relevant package script. Do not claim checks passed unless they were run. Before running validation, inspect the scripts and report any failures caused by missing source or configuration rather than masking them.
- Preserve existing behavior and avoid unrelated refactors. Update documentation when a change makes its instructions inaccurate.