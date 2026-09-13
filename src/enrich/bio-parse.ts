import { extractEmails, extractPhones } from './phone.ts';

export type Contact = { phones: string[]; emails: string[] };

export function parseBio(bio: string): Contact {
  return { phones: extractPhones(bio), emails: extractEmails(bio) };
}

export function parsePageText(html: string): Contact {
  // ponytail: scan HTML mentah (termasuk tel: dan inline script). Validasi libphonenumber menahan noise.
  return { phones: extractPhones(html), emails: extractEmails(html) };
}

export function mergeContact(a: Contact, b: Contact): Contact {
  return {
    phones: [...new Set([...a.phones, ...b.phones])],
    emails: [...new Set([...a.emails, ...b.emails])],
  };
}
