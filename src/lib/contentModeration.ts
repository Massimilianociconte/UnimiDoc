// --------------------------------------------------------------------------
// Public-text moderation: block contact details and off-platform references in
// seller-authored public fields (document description, etc.).
//
// Goal: keep all communication inside the platform. We intercept emails, phone
// numbers, URLs, social handles/usernames and explicit "contact me" invitations,
// INCLUDING common obfuscations (e.g. "nome (at) gmail dot com", "whats app",
// "tele gram", "chiamami al tre tre nove..."). On a hit the save is blocked with
// a clear, professional message.
// --------------------------------------------------------------------------

export type ModerationHit = {
  kind: 'email' | 'phone' | 'url' | 'social' | 'handle' | 'invite'
  match: string
}

export type ModerationResult = { ok: true } | { ok: false; hits: ModerationHit[]; message: string }

// Normalise obfuscations so a single set of patterns catches the variants.
function normalizeForScan(text: string): string {
  return text
    .toLowerCase()
    // "at"/"chiocciola" only as a STANDALONE token (spaced or bracketed), so we
    // don't corrupt words like "contattami" / "whatsapp".
    .replace(/\s*[([{]\s*(?:at|chiocciola)\s*[)\]}]\s*/g, '@')
    .replace(/\s+(?:at|chiocciola)\s+/g, '@')
    // "dot"/"punto" only as a standalone token.
    .replace(/\s*[([{]\s*(?:dot|punto)\s*[)\]}]\s*/g, '.')
    .replace(/\s+(?:dot|punto)\s+/g, '.')
    // collapse spaced-out letters used to dodge filters: "t e l e g r a m"
    .replace(/\b(?:\w\s){3,}\w\b/g, (run) => run.replace(/\s+/g, ''))
    // unify separators
    .replace(/[_-]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
}

const EMAIL = /[a-z0-9][a-z0-9.+]*@[a-z0-9][a-z0-9.]*\.[a-z]{2,}/i
// Phone: 8+ digits allowing spaces/dots/dashes/parentheses and a leading +/00.
const PHONE = /(?:\+|00)?\s?(?:\d[\s.\-()]?){8,}\d/
const URL = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|it|net|org|io|me|co|link|gg|xyz|info)\b/i
const SOCIAL =
  /\b(?:whats\s?app|telegram|insta(?:gram)?|face\s?book|tik\s?tok|snap\s?chat|discord|linked\s?in|twitter|reddit|only\s?fans|wechat|signal|skype|messenger)\b/i
const HANDLE = /(?:^|\s)@[a-z0-9._]{2,}/i
const INVITE =
  /\b(?:scriv(?:i|imi|etemi)|contatta(?:mi|temi|re)|chiama(?:mi|temi|re)|mand(?:a|o|ami|atemi)\s+(?:un[ao]?\s+)?(?:mail|email|dm|messaggio|sms)|ti\s+lascio\s+(?:il|la)\s+(?:mio|mia)|cerca(?:mi)?\s+su|trovami\s+su|seguimi\s+su|dm\s+me|contact\s+me|reach\s+me|add\s+me)\b/i

const PATTERNS: Array<{ kind: ModerationHit['kind']; re: RegExp }> = [
  { kind: 'email', re: EMAIL },
  { kind: 'social', re: SOCIAL },
  { kind: 'invite', re: INVITE },
  { kind: 'url', re: URL },
  { kind: 'handle', re: HANDLE },
  { kind: 'phone', re: PHONE },
]

const LABELS: Record<ModerationHit['kind'], string> = {
  email: 'un indirizzo email',
  phone: 'un numero di telefono',
  url: 'un link esterno',
  social: 'un riferimento a un social o app di messaggistica',
  handle: 'un nome utente/handle',
  invite: 'un invito al contatto diretto',
}

/**
 * Scan a public seller field. Returns ok, or the hits + a ready-to-show message.
 */
export function moderatePublicText(rawText: string): ModerationResult {
  const text = rawText ?? ''
  if (!text.trim()) return { ok: true }
  const scan = normalizeForScan(text)

  const hits: ModerationHit[] = []
  for (const { kind, re } of PATTERNS) {
    const found = scan.match(re)
    if (found) {
      // Avoid a phone false-positive on things like long ISBNs only if no other
      // signal — but a run of 8+ grouped digits in a description is almost always
      // a contact number, so we keep it.
      hits.push({ kind, match: found[0].trim() })
    }
  }

  if (hits.length === 0) return { ok: true }

  const kinds = Array.from(new Set(hits.map((hit) => LABELS[hit.kind])))
  const message =
    `Per la tua sicurezza e quella degli acquirenti, le comunicazioni devono restare dentro UnimiDoc. ` +
    `La descrizione sembra contenere ${listToText(kinds)}: rimuovilo prima di pubblicare.`

  return { ok: false, hits, message }
}

function listToText(items: string[]): string {
  if (items.length === 1) return items[0]
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`
}
