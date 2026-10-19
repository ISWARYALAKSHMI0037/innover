// Free / consumer mailbox providers. A company using these for official offers is a (weak) signal, not proof.
const FREE = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.in', 'yahoo.co.in', 'yahoo.co.uk', 'ymail.com', 'rocketmail.com',
  'outlook.com', 'outlook.in', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'live.in', 'msn.com', 'aol.com',
  'icloud.com', 'me.com', 'mac.com', 'protonmail.com', 'proton.me', 'pm.me', 'zohomail.com', 'zohomail.in',
  'mail.com', 'gmx.com', 'gmx.net', 'yandex.com', 'yandex.ru', 'mail.ru', 'rediffmail.com', 'rediff.com',
  'inbox.com', 'tutanota.com', 'tuta.io', 'hushmail.com', 'qq.com', '163.com', '126.com', 'naver.com', 'daum.net',
  'sify.com', 'aim.com',
];

const DISPOSABLE = [
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', 'tempmail.com', 'temp-mail.org',
  '10minutemail.com', 'yopmail.com', 'trashmail.com', 'getnada.com', 'dispostable.com', 'maildrop.cc',
  'throwawaymail.com', 'fakeinbox.com', 'mohmal.com', 'tempail.com', 'emailondeck.com', 'mintemail.com',
];

const freeSet = new Set(FREE);
const disposableSet = new Set(DISPOSABLE);

/** @returns {'free'|'disposable'|'other'} */
export function classifyEmailDomain(registrableOrHost) {
  const d = (registrableOrHost || '').toLowerCase();
  if (disposableSet.has(d)) return 'disposable';
  if (freeSet.has(d)) return 'free';
  return 'other';
}

export const isFreeOrDisposable = (d) => classifyEmailDomain(d) !== 'other';
