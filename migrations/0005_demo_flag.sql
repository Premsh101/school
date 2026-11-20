-- Demo schools hold sample data for trying the app (owner's request, 2026-11-20).
-- "All schools" leaves them out of every list, total and report; they are opened by choosing
-- them at sign-in or in the school switcher. The demo school itself and its sample data are
-- loaded by migration 0006.
ALTER TABLE branches ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;
