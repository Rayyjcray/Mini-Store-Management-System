# Validation record

## Owner-readable backups and restore check — November 10, 2026

- Source build, strict TypeScript checking and formatting passed.
- All **54 integration tests passed**, including **25 store/backup tests**. Coverage includes full DB/CSV/XLSX round trips, every business table, archived products, exact centavos, quoted/multiline Unicode text, null versus empty values, CSV formula escaping, owner-summary reconciliation, safety copies, temporary-file cleanup, malformed/incomplete files, invalid numbers/references/payments, empty shops and foreign-shop rejection. Original v1 CSV files remain restorable. Workbook checks cover modified owner views, corrupt restore data, multiple restore chunks and ordinary unrelated workbooks.
- The full Electron desktop workflow passed with an isolated profile and zero renderer errors. It checks all three format choices, format-specific save filenames/filters, combined restore filters, CSV and workbook export/restore through Settings, cancelled restore confirmation, and DB backup/restore behavior.
- Reviewed `test-output/settings-excel-backup.png` and rendered owner views from a saved fictional workbook under `test-output/owner-backup-demo/`. Customer names, individual debt balances, peso formatting and stock statuses were checked against source records. Results are recorded in `test-output/e2e-result.json`. These checks cover the current source build; the previously generated installers below have not been rebuilt for this change.
- Added ExcelJS 4.4.0 for offline workbook support, with a scoped UUID override to 11.1.1 addressing the advisory reported during installation. A follow-up registry audit was unavailable because the npm registry DNS lookup failed; no clean audit result is claimed for this change.

Date: November 9, 2026. App version: 1.3.1. Host: Windows 11 x64 (build 22621). Development Node.js: 24.21.0. App runtime: Electron 45.2.3; better-sqlite3 13.0.3. Dependency versions are recorded in `package-lock.json`.

## Version 1.3.1 upgrade check

- The packaged executable and installer report version 1.3.1. The application ID, product name, database locations and `deleteAppDataOnUninstall: false` setting are unchanged.
- A consistent SQLite copy of an isolated 1.3.0 desktop test profile was opened by the packaged 1.3.1 executable. The existing owner password worked, the workspace showed v1.3.1, and saved products, sales and customers were accessible.
- After closing 1.3.1, every business table was compared with its baseline using row counts and SHA-256 digests of ordered rows. All business records, account credential rows, shop membership and schema versions were unchanged. Authentication activity logs are expected to record the new sign-in and are excluded from the unchanged-account comparison.
- Only test databases were copied; Chromium cache/lock files were excluded and the test directory used inherited Windows permissions. The owner's normal store profile was never opened or modified by the test.
- Upgrade result: `test-output/upgrade-1.3.1-result.json`. UI release notes: [CHANGELOG.md](CHANGELOG.md).
- The full fresh-profile owner/staff workflow passed on the packaged 1.3.1 executable with zero renderer errors. Desktop assertion waits allow 30 seconds for secure password operations on a slow test host; the original five-second assertion window was insufficient in the first run.

## Completed

The 48 database/authentication/shop integration tests below passed for the 1.3.0 baseline. Version 1.3.1 changes renderer UI, the desktop driver and release metadata; the database, authentication and shop-isolation implementation is unchanged. The additional upgrade verification above checks preservation of existing data in the new executable.

- TypeScript strict checking and production main/preload/renderer builds.
- **19 passing database integration tests** inside Electron's Node runtime, including actual temporary SQLite files:
  - Schema, foreign keys, explicit empty initial state and integer-money validation.
  - Cash payments/change, immutable historical unit prices/costs and stock deduction.
  - Duplicate cart line aggregation, overselling prevention, multi-product rollback and an injected mid-transaction database failure.
  - Customer credit limits, down payments, exact repayments, underpayment rejection and prevention of negative balances.
  - Inventory adjustments and movement ledger; product archival and returned archived inventory.
  - Sale voids, credit reversal, duplicate void rejection, expenses and date-filtered report calculations.
  - Optional zero-stock starter catalog without fabricated transactions.
  - Persistence across database restart, consistent backups, restore safety copy, corrupt/unsupported backup rejection and startup recovery from an interrupted restore rename.
  - Rejection of the active database as a backup/restore target, including case variants on Windows and hard-link aliases.
- **11 owner authentication tests** cover first-run account validation, salted password storage, first-owner enforcement, wrong credentials, logout, session generation invalidation, fresh sign-in after restart, persistent failed-attempt cooldowns, inactivity locking, password changes, recovery-code rotation, cancelling in-flight sign-in on lock, business-backup credential isolation, and preserving existing store data.
- **11 passing account/security tests** cover forced private passwords (including rejection of the existing temporary password), owner reauthentication, staff permission denial, account/username uniqueness, current-owner safeguards, generic failures for disabled/unknown/wrong-password accounts, independent cooldowns and owner unlocking, persistent application-wide rate limiting, session revocation, owner-issued password resets, legacy account migration, protected financial-data redaction, secret-free audit records and the store-command burst limit.
- **7 passing shop isolation tests** cover independent owner accounts, forbidden cross-owner shop switching/account changes, private audit activity, multiple shops under one owner, staff assigned to one shop, separate SQLite files with overlapping SKUs/barcodes and record IDs, isolated sales/debts/expenses/settings, same-shop restores, rejected foreign backups, legacy unlabelled backups restricted to the original shop, managed database output/hard-link protection, and real v1.2 shared-owner migration. **All 48 integration tests passed**.
- **Real Electron desktop workflow test** with an isolated profile:
  - First-run owner creation, recovery-code acknowledgement, wrong-password rejection, password change, logout with draft clearing, Windows lock events, sign-in required after application restart, and offline recovery.
  - All 28 protected data/file/account/shop operations are denied while signed out, including reads, checkout, inventory/customer changes, reports, backups, restore, printing, password changes, account management, security activity and shop management.
  - Owner account creation, staff first sign-in/private-password setup, forbidden owner commands, staff data redaction, staff checkout, account disabling/unlocking, security activity, and the application-wide authentication quota.
  - Renderer sandbox and context isolation enabled; Node.js integration disabled; `window.require` and `window.process` unavailable.
  - Store settings, starter catalog, product and customer creation through the UI.
  - Barcode/SKU entry, cash checkout/change, credit sale with down payment and customer repayment.
  - Native receipt IPC and HTML rendering. Only the final OS printer call is replaced by the test.
  - Restocking, expense entry, reports, CSV export, database backup/restore and whole-sale void.
  - Dashboard totals, inventory history, zero renderer errors, search input padding and checkout control access at 1100 × 720.
  - Actual application close/relaunch preserving sales, debt and settings.
- **Independent owner/shop desktop workflow** uses a separate fresh profile: creates Owner 1's products, customers, debt sale and staff; registers Owner 2 through the sign-in UI and verifies an empty private shop; rejects foreign shop/account/audit/file access; sells identical SKUs with overlapping local IDs independently; rejects Owner 1's backup in Owner 2's shop; adds/switches Owner 2's branch through the UI; confirms and clears a cart on switching; verifies Owner 1's unchanged records and valid same-shop restore; signs in staff assigned only to Owner 1's shop; and confirms both Owner 2 shops remain intact. Zero renderer errors. Results: `test-output/shops-e2e-result.json`.
- Captured and reviewed screenshots of private shops, account management, security activity, setup/sign-in, dashboard, reports and checkout. Test results and images are under `test-output/`. Desktop screenshots use Electron's native visible-page capture, with background throttling disabled only in the test driver, to avoid browser screenshot capture timeouts on this host.
- Prettier check passed for the source. The 1.3.0 dependency audit reported **zero known vulnerabilities**; 1.3.1 does not change dependencies. A scoped minimatch override remains in place for build tooling.
- Electron Builder generated a Windows x64 NSIS installer and unpacked application, including the native SQLite module and app icon.

## Packaged executable

**Passed:** the full owner/staff desktop workflow suite was run against the final 1.3.1 `release/win-unpacked/DormStore Management System.exe`, including real close/relaunch, permission denials, data redaction, account disabling/unlocking, security activity, authentication rate limiting, and zero renderer errors. Results are recorded in `test-output/packaged-e2e-result.json`. The desktop script can target the packaged executable with:

```powershell
$env:DORMSTORE_TEST_EXE = (Resolve-Path 'release/win-unpacked/DormStore Management System.exe').Path
node scripts/e2e.mjs
node scripts/shops-e2e.mjs
```

**1.3.0 baseline passed:** the independent-owner and multi-shop suite ran against the 1.3.0 packaged executable. All three shops retained their own records, foreign-shop access and restores were rejected, shop switching cleared drafts, assigned staff stayed in their shop, and no renderer errors occurred. Results: `test-output/packaged-shops-e2e-result.json`. These backend paths are unchanged in 1.3.1; this release adds the existing-profile upgrade check and reruns the full owner/staff workflow described above.

The same application workflows run with a fresh test profile. Dialog selections are supplied programmatically; the real main-process file handlers and database operations run.

Final installer: `release/DormStore-Setup-1.3.1-x64.exe`.

The installer checksum is recorded in `release/DormStore-Setup-1.3.1-x64.exe.sha256` after packaging.

## Release checks requiring target hardware or credentials

- Physical receipt printer output, paper width, driver configuration and a real barcode scanner. Automated tests use keyboard-style barcode input and inspect the native receipt renderer.
- A Windows 10 machine; the current host is Windows 11. Windows 10/11 x64 are the configured targets.
- Interactive install/update/uninstall walkthrough on a clean user account. The installer build and unpacked executable can be verified here without installing into the owner's normal profile.
- Installer and executable code signing. No certificate was supplied; generated binaries are unsigned.

No automated test modifies the normal store database or creates real sales, repayments or customer records outside its isolated profile.
