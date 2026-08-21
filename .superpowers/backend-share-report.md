# Backend report: owner-controlled public sharing of a result

## What this adds

The task adds one nullable field to `Assessment` and three routes. The field is
`publicSlug: String? = null`. A null value means the result stays private. A slug value
means the owner made the result public. The change adds no migration. Old documents keep
their current shape.

## The new field

File: `backend/src/main/kotlin/app/geostrategy/assessment/Assessment.kt`

- `Assessment.publicSlug: String? = null`
- `AssessmentRepository.findByPublicSlug(slug)` — finds the assessment for a slug, or null.
- `AssessmentRepository.setPublicSlug(id, slug)` — stores the slug and stamps `updatedAt`.
- `AssessmentRepository.clearPublicSlug(id)` — sets the slug back to null and stamps
  `updatedAt`. The call is safe to repeat.

No index change. No document migration. No existing field changed.

## The endpoints

File: `backend/src/main/kotlin/app/geostrategy/assessment/AssessmentRoutes.kt`. The routes
sit in the same `assessmentRoutes(deps)` function as the existing assessment routes, so
`Application.kt` needs no new registration call.

1. `POST /v1/assessments/{id}/share`
   - Requires a session (`call.requireUser(deps)`).
   - 404 `not_found` when the assessment does not exist or belongs to another user. The
     message is the same for both cases, so a caller cannot tell them apart.
   - 409 `not_ready` when `status != "ready"`.
   - Generates a slug the first time and stores it. A second call returns the same slug,
     with no new write.
   - Returns `{"slug": "..."}` with status 200.
2. `DELETE /v1/assessments/{id}/share`
   - Requires a session, owner only. Same 404 rule as above.
   - Clears the slug and returns 204. A repeat call still returns 204.
3. `GET /v1/public/results/{slug}`
   - No session check. The route sits next to the owner-only routes but never calls
     `requireUser`, the same pattern the login and register routes already use.
   - 404 `not_found` for an unknown slug and for any assessment whose `publicSlug` is null,
     with one shared message.
   - Returns a hand-built DTO, not the `Assessment` class.

## The slug

`randomPublicSlug()` in `AssessmentRoutes.kt` draws 16 bytes from `java.security.SecureRandom`
(128 bits) and hex-encodes them in lowercase, the same `"%02x"` pattern the codebase already
uses in `auth/Crypto.kt` for token hashes. The result is 32 lowercase hex characters: URL-safe,
128 bits of entropy, and independent of the assessment id, so a reader cannot enumerate
results from it.

## The public DTO

`PublicResultDto` in `AssessmentRoutes.kt`:

```
domain: String            // site.domain — a host name, e.g. "example.com"
createdAt: String
completedAt: String?
scores: Scores?
scoreNotes: ScoreNotes?
findings: List<PublicFindingDto>
summary: String?
```

`PublicFindingDto`: `title` (the finding id), `area` (the finding category), `severity`,
`description` (the finding evidence text). The DTO drops `affectedPages`: a public reader
sees the problem, not the crawler's URL list for it.

The DTO carries no `userId`, no `siteId`, no cost field, no token count, and no
`crawlDigest`. The plan (`PlanDoc`/`PlanTask` in `plans/Plans.kt`) is a separate collection
that the route never reads, so no plan field — no step list, no `whyItMatters`, no
`doneCheck` — can reach the response.

## Tests

File: `backend/src/test/kotlin/app/geostrategy/assessment/PublicResultRoutesTest.kt`. 6 new
tests, all pass:

1. `share returns a slug and a second call returns the same slug` — pass.
2. `share on a non-ready assessment returns 409` — pass.
3. `share on another user's assessment returns 404` — pass.
4. `public endpoint serves a shared result with no cookie and hides private fields` — pass.
   Builds a plain client with no cookie plugin, then asserts the raw JSON text carries none
   of `userId`, `siteId`, `costUsd`, `inputTokens`, `outputTokens`, `crawlDigest`, `email`,
   `whyItMatters`, `doneCheck`, `effortMinutes`, `steps`, `affectedPages`.
5. `public endpoint 404s for an unshared assessment and for an unknown slug` — pass.
6. `unshare makes the public endpoint 404 again and is idempotent` — pass.

## Test run

Command: the env-seam form from the task, against a throwaway Mongo container on port
27019.

- Baseline before this change: 132 tests.
- Total after this change: 138 tests (132 + 6 new).
- Failures: 0. Errors: 0. Skipped: 0.
- Source: `backend/build/test-results/test/*.xml`, summed across all 38 suite files.

## Concerns

- The public endpoint's Mongo query has no dedicated index. A unique index on `publicSlug`
  is unsafe to add without a migration: MongoDB treats every document that lacks the field
  as a null value for indexing, and a unique index over many nulls fails to build. A
  non-unique index would be safe and would help lookup speed once traffic grows, but the
  task asked for no migration and no index change, so this report flags it rather than
  adding it.
- `title` in the public finding DTO carries the finding's internal id (for example
  `missing-meta-description:/about`), because `Finding` has no separate human-readable
  title field today. The id already embeds the affected page's path, so it reveals
  page-level detail similar to `affectedPages`, even though the DTO omits that field by
  name. This is the closest honest mapping available without changing the `Finding` model,
  which was out of scope for this task.
- CORS is unchanged. If a browser ever calls the public endpoint directly from another
  origin, check `http/Cors.kt` before relying on it; this task did not touch that file.
