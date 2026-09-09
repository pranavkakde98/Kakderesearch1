# V15 positioning preview

Based on production commit `5f02f83c1fc39e6a9593fceecddebf43bc740d8e`. Work belongs to branch `v15-consulting-positioning`, never `main` until the owner tests and approves it.

## Changes

- Global consulting and research lead the commercial narrative. EM and India remain specialist capabilities.
- About describes the client's decision as the founding rationale. London remains professional biography.
- Founder and team copy explains involvement, evidence and direct access.
- Homepage adds clearly illustrative client questions and broadens coverage language.
- Consulting, Research, Methodology, Insights, Contact and both desks use consistent positioning. Every service supports projects and retained work.
- Existing production design, hero industry chart, testimonials, photographs and research documents remain in place.
- Common descriptions, footer and relevant structured data reflect the broader practice.

## Dummy environment

Non-production API deployments validate forms but return an explicit preview response before calling email, storage or database services. Unsubscribe previews do not alter subscriptions. The report request fallback posts to the same host. Preview pages have noindex metadata and a visible V15 notice.

Tests: `node --test tests/*.test.js`. The preview regression suite configures dummy external credentials and fails if any outbound request occurs.

This is a positioning preview, not a declaration that the entire historical technical audit is complete. Full release QA and performance work remain a separate finalisation stage. Before an approved production release, remove the V15 notice and preview-only noindex metadata; recheck delivery using the intended production configuration. Do not promote this preview without the owner's approval.
