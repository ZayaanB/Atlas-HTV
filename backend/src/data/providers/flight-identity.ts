import { AppError } from '../../runtime/errors.js';

/** Build an honest provider identity; never substitute invented contact details. */
export function flightUserAgent(contact: string | undefined): string {
  const invalid = () => new AppError('CONFIG_INVALID', 'FLIGHTS_CONTACT must be a contact email or HTTPS URL when flights are enabled', 500);
  // Header values must be printable ASCII, and parentheses/backslashes would
  // interfere with the User-Agent comment syntax used below.
  if (!contact || contact.length > 512 || /[^\x21-\x7e]|[()\\]/.test(contact)) throw invalid();
  const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact) && !contact.includes('://');
  let https = false;
  try {
    const url = new URL(contact);
    https = url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
  } catch { /* An email does not need to parse as a URL. */ }
  if (!email && !https) throw invalid();
  return `Atlas/0.1 (contact: ${contact})`;
}
