-- A management login for trying the app on the live site (owner's request, 2026-11-20):
-- manager@sps.com / manager@123. Like the admin login, only a hash is stored and the person
-- must choose a new password at the first sign-in, so manager@123 stops working after that.
-- The admin can rename, reset or switch it off under Logins.
-- Added only when the school has its admin login and no manager@sps.com login yet, so it never
-- touches an existing login and is safe to run twice.

INSERT INTO audit_log (at, user_name, action, entity, summary)
SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'System', 'create', 'user',
       'Added the management login manager@sps.com'
WHERE EXISTS (SELECT 1 FROM users WHERE username = 'admin@sps.com')
  AND NOT EXISTS (SELECT 1 FROM users WHERE username = 'manager@sps.com');

INSERT INTO users (username, name, password_hash, role, active, must_change_password, created_at, updated_at)
SELECT 'manager@sps.com', 'Manager',
       'pbkdf2-sha256$20000$UGlFDm9NLwuTLNeGA00fRQ==$VH7gz8ifoDy2CC4s1zfeoERszK3ikGl8+Qej1D+2z2A=',
       'management', 1, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE EXISTS (SELECT 1 FROM users WHERE username = 'admin@sps.com')
  AND NOT EXISTS (SELECT 1 FROM users WHERE username = 'manager@sps.com');
