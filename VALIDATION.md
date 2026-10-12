# Validation — Firebase edition v0.2

Passed:
- Vue/Vite production build.
- Auth gate DOM check: missing Firebase configuration shows setup, not a workspace.
- Electron main syntax check.
- 10 Python SQLite compatibility tests, including start-date migration and persistence.
- Python Cloud Function import with installed requirements and eligibility filter check.

Prepared but NOT run:
- `npm run test:firebase`: Firestore Emulator integration tests for ownership, anonymous denial,
  CRUD audit transaction, immutable events, version checks, server-only reminder receipts,
  verified email preferences and one-time import.
- Emulator execution was blocked because this environment has Java 17; the installed Firebase CLI requires Java 21+.

Not verified:
- Actual Firebase project configuration, authentication, rules deployment or live Firestore writes.
- Native Electron/Windows rendering, installer or packaging.
- Live SMTP or deployed scheduled function. No emails sent and no billing or cloud resources enabled.

Before trusting the cloud edition with important data, publish rules and run the two-account
checklist in FIREBASE-SETUP.md. Keep the original SQLite/JSON backup. Live Firebase testing
needs the user's project configuration; no cloud project or credentials were supplied.
