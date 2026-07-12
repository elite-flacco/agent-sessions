# Definition of Done

Every implementation plan in this repository uses this completion bar:

1. Acceptance criteria are met without unrelated changes.
2. `npm run verify` exits successfully without weakening a check.
3. New behavior is covered by tests.
4. No lint or type suppressions are added to conceal failures.
5. User-facing behavior is documented in `README.md`; architecture or conventions are documented in `AGENTS.md` and `CLAUDE.md`.
6. The final plan task reviews and updates documentation after all code changes.

If verification fails, fix the underlying cause and rerun the complete command before reporting completion.
