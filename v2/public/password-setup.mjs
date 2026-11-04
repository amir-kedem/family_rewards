const textEncoder = new TextEncoder();
const hex = bytes => Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');

export async function makePasswordVerifier(password) {
  if (typeof password !== 'string' || password.length < 4 || password.length > 256) {
    throw new Error('יש לבחור סיסמה באורך 4 עד 256 תווים');
  }
  const salt = hex(crypto.getRandomValues(new Uint8Array(24)));
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', iterations:100000, salt:textEncoder.encode(salt)}, key, 256);
  return `pbkdf2$100000$${salt}$${hex(new Uint8Array(bits))}`;
}

if (typeof document !== 'undefined') {
  const $ = id => document.getElementById(id);
  const fields = ['secretName', 'newPassword', 'confirmPassword'];
  let generating = false;
  const clearResult = () => { $('result').hidden = true; $('verifier').value = ''; $('status').textContent = ''; };
  for (const id of fields) $(id).addEventListener('input', clearResult);
  $('setupForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (generating) return;
    clearResult();
    if ($('newPassword').value !== $('confirmPassword').value) {
      $('status').textContent = 'הסיסמאות אינן זהות';
      return;
    }
    generating = true;
    $('generate').disabled = true;
    for (const id of fields) $(id).disabled = true;
    try {
      const name = $('secretName').value;
      const verifier = await makePasswordVerifier($('newPassword').value);
      $('verifier').value = verifier;
      $('resultName').textContent = name;
      $('result').hidden = false;
      $('newPassword').value = '';
      $('confirmPassword').value = '';
      $('status').textContent = 'הערך מוכן. הסיסמה נוקתה מהשדות.';
    } catch (error) {
      $('status').textContent = error.message || 'לא ניתן ליצור ערך מוגן בדפדפן הזה';
    } finally {
      generating = false;
      $('generate').disabled = false;
      for (const id of fields) $(id).disabled = false;
    }
  });
  $('copyValue').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('verifier').value);
      $('status').textContent = 'הערך הועתק. הדביקו אותו בשדה Value ב־Cloudflare.';
    } catch {
      $('verifier').focus();
      $('verifier').select();
      $('status').textContent = 'אפשר להעתיק את הערך המסומן ידנית.';
    }
  });
  window.addEventListener('pagehide', () => {
    $('newPassword').value = '';
    $('confirmPassword').value = '';
    $('verifier').value = '';
    $('result').hidden = true;
  });
}
