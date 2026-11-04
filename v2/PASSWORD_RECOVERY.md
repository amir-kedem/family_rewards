# Password recovery

Parents can sign in directly from the initial family login screen with their private parent password. This uses the same rate-limited parent authentication as entering parent mode. A family password is not required for direct parent login. A parent who forgot only the family password can enter this way and replace it under **ניהול → סיסמאות**.

For a forgotten parent password, save a recovery code in advance:

1. Enter parent mode and open **ניהול → קוד שחזור להורה**.
2. Re-enter the current parent password and create a code.
3. Copy the code into a password manager or another private place outside the app, then choose **שמרתי את הקוד**. It is shown once, held only in component memory, and never written to browser storage.

The code has 256 random bits, is grouped for copying, lasts one year, and works once. Generate another while signed in to renew it; generation immediately invalidates the previous code. Each household has its own code in its own D1 database. Only a SHA-256 verifier and expiry are stored. There is no email service or public recovery through family/child names.

Choose **שכחתם את הסיסמה?** on the initial login screen or **שכחתי סיסמת הורה** from parent entry. Supply the saved recovery code and a new parent password (at least four characters, different from the family password). Recovery atomically consumes the code, changes the parent password, and revokes all family/parent sessions. It does not sign the user in automatically. Return to login, choose **כניסת הורה**, and manually enter the new password. Family passwords, points, settings, catalogs, and history are unchanged. Create and save a replacement recovery code afterward.

If both app passwords were forgotten, the saved code resets the parent password; direct parent login then permits replacing the forgotten family password. If the recovery code was never saved, expired, lost, or already used, this feature cannot prove ownership. A separate verified-owner maintenance procedure is still required; the app offers no bypass.

Generation requires a valid parent session and fresh parent-password verification. Its transaction rechecks that the session is still active and the verified parent credential has not changed. Public reset and password reauthentication each allow at most ten attempts per fifteen minutes per household. Same-origin JSON requests, byte limits, instance identity checks, no-store responses, and secure cookie rules apply. A transaction guard ensures simultaneous valid submissions consume a code exactly once; failed database writes preserve the code and old credentials/sessions for a retry.

`0003_password_recovery.sql` is idempotent for managed migrations. Existing manually initialized installations remain compatible: recovery tables are lazily created only after successful parent reauthentication when first generating a code. Ordinary login and viewing the app do not initialize recovery or change household data. Apply the migration through the established managed migration process when available; do not rerun initial migrations on existing databases.

A raw recovery code is returned only in the successful generation response. Do not log it, publish it, commit it, put it in a URL, or paste it into a support chat. Ordinary parent-password changes keep a saved code valid until it is used, rotated, or expires; rotate the code explicitly if it may have been exposed.
