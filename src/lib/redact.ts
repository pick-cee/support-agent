// Tool-call inputs are stored with emails masked (DESIGN §17): the log must be
// useful for debugging without becoming a second copy of contact details.

const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

export function maskEmails(text: string): string {
  return text.replace(EMAIL, (_match, first: string, domain: string) => `${first}***@${domain}`);
}

/** A copy of a tool input with every string's emails masked and long strings cut. */
export function redactInput(value: unknown, maxString = 300): unknown {
  if (typeof value === "string") {
    const masked = maskEmails(value);
    return masked.length > maxString ? `${masked.slice(0, maxString)}...` : masked;
  }
  if (Array.isArray(value)) return value.map((item) => redactInput(item, maxString));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactInput(item, maxString)]));
  }
  return value;
}
