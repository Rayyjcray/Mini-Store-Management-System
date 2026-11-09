# Changelog

## 1.3.1 — November 9, 2026

- Removed duplicate Add product buttons from empty Products and Inventory tables; the header action remains.
- Removed the duplicate Add customer button from the empty Customers table.
- Removed the dashboard's Open checkout shortcut, keeping New sale as its checkout action.
- Replaced the two icons in the empty Sales view with one receipt icon.
- Updated the desktop workflow to use the remaining Add actions without selecting the first of multiple matches.
- Allowed up to 30 seconds for desktop assertions so secure password operations can finish on slower test hosts.

This release does not change the business or authentication database schemas. Existing account credentials, shop membership, products, sales, stock, customer balances and expenses are retained when updating the same Windows user profile.

Save shop backups before updating, close DormStore, then run `DormStore-Setup-1.3.1-x64.exe`. After installation, the footer and Settings show version 1.3.1.
