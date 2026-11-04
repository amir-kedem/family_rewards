# Changing household participants

In parent mode, **ניהול → המשתתפים בבית** allows adding a participant, changing their name/icon, changing the active order, removing them from participation and restoring them. The first active participant is the default selection. At least one active participant must remain. There may be at most 12 active participants and 50 retained participant records per household.

Removal is reversible archival, not permanent deletion. The participant disappears from active family selection and balance lists. Their identity, points, goals and retained history are preserved, and history still displays their name. Existing rolling six-month history retention continues to apply. Historical earnings still count toward the month in which they happened; opting out does not rewrite monthly progress. Restoring a participant restores the same identity and balance. Historical cancellations remain available to parents; archived participants cannot perform new activities/redemptions or choose a new goal.

Opening points for a newly added participant do not create earned history or inflate the monthly goal. Existing balances use the established documented correction action. Participant names must be unique, including archived participants; restore an old record instead of duplicating its name.

Only parent-authenticated requests can change membership. An optimistic management version and a transaction guard reject stale/concurrent edits. A database trigger prevents an in-flight activity from crediting a participant after removal, including during the first management operation on an older installation. Child sessions cannot edit membership. Names/icons remain inert text.

Fresh instances apply `0004_member_management.sql`. Existing manually initialized families remain compatible: state reads do not alter their data; the supporting tables/trigger are created when a parent first manages participants. Do not rerun initial migrations on existing families.
