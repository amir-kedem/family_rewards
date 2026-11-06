import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pbkdf2Sync, randomBytes } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--reset')) throw new Error('Usage: npm run local:setup or npm run local:reset');
const reset = args.includes('--reset');
function wrangler(command, options = []) {
  const result = spawnSync(process.execPath, [
    'node_modules/wrangler/bin/wrangler.js', 'd1', ...command,
    'family-rewards-local', '--local', '--config', 'wrangler.local.jsonc', ...options,
  ], { encoding: 'utf8', env: { ...process.env, CI: 'true' } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const hash = password => {
  const salt = randomBytes(24).toString('hex');
  return `pbkdf2$100000$${salt}$${pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex')}`;
};
console.log('Preparing the local SQLite database (no Cloudflare login needed)...');
console.log(wrangler(['migrations', 'apply']));
const state = JSON.parse(wrangler(['execute'], ['--json', '--command',
  'SELECT (SELECT COUNT(*) FROM members)+(SELECT COUNT(*) FROM catalog)+(SELECT COUNT(*) FROM history)+(SELECT COUNT(*) FROM onboarding)+(SELECT COUNT(*) FROM instance_identity)+(SELECT COUNT(*) FROM password_credentials) AS count;']));
if (!reset && state[0].results[0].count > 0) {
  console.log('Existing local data kept. Run npm run local:reset to replace it with samples.');
  process.exit(0);
}
const sql = [];
if (reset) {
  // These deletes are only ever passed to Wrangler with --local and the dummy local binding.
  for (const table of ['goals', 'history', 'member_preferences', 'catalog', 'members',
    'sessions', 'login_attempts', 'password_credentials', 'parent_recovery', 'recovery_guard',
    'onboarding', 'instance_identity', 'setup_completion_guard', 'member_update_guard']) {
    sql.push(`DELETE FROM ${table};`);
  }
  sql.push('UPDATE member_management SET version=0 WHERE id=1;');
}
sql.push('UPDATE settings SET family_goal=500 WHERE id=1;');
sql.push(`INSERT INTO password_credentials VALUES ('family',${quote(hash('family-local'))}),('parent',${quote(hash('parent-local'))});`);
sql.push("INSERT INTO members(id,name,emoji,points,is_child) VALUES ('local-noa','נועה','🌻',120,1),('local-ori','אורי','🚀',80,1);");
sql.push("INSERT INTO member_preferences VALUES ('local-noa',0,0),('local-ori',1,0);");
sql.push(`INSERT INTO catalog(id,kind,category,title,value,emoji) VALUES
  ('local-tidy','task','chores','סידור החדר',10,'🧹'),
  ('local-read','task','education','קריאה במשך עשרים דקות',20,'📚'),
  ('local-help','task','behavior','עזרה לחבר',15,'💛'),
  ('local-icecream','reward','chores','גלידה',50,'🍦'),
  ('local-movie','reward','chores','ערב סרט משפחתי',150,'🎬');`);
sql.push("INSERT INTO goals VALUES ('local-noa','local-movie'),('local-ori','local-icecream');");
// Opening balances above are independent of recent earned activity, as in the real app.
for (const [index, member, delta, label] of [[0, 'local-noa', 20, 'קריאה במשך עשרים דקות'], [1, 'local-ori', 10, 'סידור החדר']]) {
  const at = new Date(Date.now() - (index + 1) * 3600000).toISOString();
  sql.push(`INSERT INTO history(id,member_id,delta,label,kind,at) VALUES ('local-history-${index}',${quote(member)},${delta},${quote(label)},'task',${quote(at)});`);
}
mkdirSync('.wrangler', { recursive: true });
writeFileSync('.wrangler/local-seed.sql', sql.join('\n'), 'utf8');
console.log(wrangler(['execute'], ['--file', '.wrangler/local-seed.sql']));
console.log('Sample data ready. Family password: family-local | Parent password: parent-local');
console.log('Run npm run build, then npm run dev. Open http://localhost:4173');
