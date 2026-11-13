# Security

The development server binds only to `127.0.0.1`. It validates Host and Origin values, rejects cross-origin browser requests, requires an explicit custom header and JSON content type for mutations, validates request bodies, caps payload sizes, and avoids logging request bodies or UIDs. Loopback is not a security boundary against other local processes; the application must never collect HoYoverse credentials.

This is a Phase 1 baseline, not a complete session/CSRF model. Before exposing additional state-changing workflows, add a local session token with origin-bound CSRF protection, strict file import boundaries, and security review.
