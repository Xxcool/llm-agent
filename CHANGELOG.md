# CHANGELOG

## Unreleased — 2026-11-12

### UI

- Add illustrated conversation empty states and contextual setup actions.
- Present home page capabilities as informational cards, with actionable getting-started steps and a footer; support narrow layouts and reduced motion.
- Keep the model setup entry available until a connection is confirmed.

### Deployment

- Add a WorkBuddy launch script that enforces anonymous workspace isolation, personal API keys, HTTPS cookies, and a single worker on port 3000.
- Document WorkBuddy publishing parameters and sandbox data retention limits.

## Unreleased — 2026-11-11

### Fixed

- Enforce exclusive plan confirmation and revalidate plan state before applying code.
- Validate every staged file before writing; restore files on write failure and reject stale previews.
- Reject plan evidence without retrieved sources or matching quotations.
- Index `.markdown` uploads and invalidate vectors when the embedding model changes.
- Persist edited and regenerated message branches; emit SSE completion after persistence.
- Keep health probes stateless and recover interrupted tasks for retry.
- Sanitize rich HTML/SVG, handle truncated SSE responses, and retain request errors in the UI.
- Replace destructive deployment synchronization with allowlisted packages.

### Security

- Encrypt personal API keys, prevent implicit reuse across providers, and disable shared-key fallback in multi-tenant mode.
- Initialize anonymous browser identity before concurrent API calls and limit open workspace connections.

### Deployment

- Add a free ModelScope Docker profile, SQLite-consistent snapshots, verified startup restoration, and backup health reporting.
- Align Node.js development and CI with dependency engine requirements; defer rich-text bundles.
- Document anonymous identity limits, delivered scope, and recovery procedures in README and ADR 0001.
