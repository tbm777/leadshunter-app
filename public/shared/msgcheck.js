// Message checks before launch: things that make a contact-form message look like spam to filters
// (Akismet, CleanTalk) or to the person reading it. Advice only; nothing is blocked.
import { unknownTags } from './personalize.js';

const SHORTENERS = /\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|buff\.ly|rebrand\.ly|cutt\.ly|is\.gd|shorturl\.at|tiny\.cc|rb\.gy)\b/i;
const SPAMMY = /\b(100% free|risk[- ]free|guaranteed|act now|click here|limited time|no obligation|winner|congratulations|cash bonus|double your|earn \$|\$\$\$)/i;
const WAY_OUT = /reply\s+(with\s+)?["'“‘]?(no|stop|not interested|remove)|won['’]?t\s+(reach out|contact|follow up|email|message)|not a (good )?fit|unsubscribe|opt[- ]?out|let me know if (you['’]?re|you are) not/i;

/** Returns [{ level: 'warn' | 'tip', text }] for a subject and message. */
export function checkMessage({ subject = '', message = '' } = {}) {
  const out = [], text = `${subject}\n${message}`;
  const links = (text.match(/\bhttps?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(com|net|org|io|co|us)(\/\S*)?\b/gi) || []).length;
  if (links > 2) out.push({ level: 'warn', text: `${links} links. Spam filters score messages with several links much higher. One link, or none, works best.` });
  if (SHORTENERS.test(text)) out.push({ level: 'warn', text: 'A link shortener (like bit.ly). Filters treat shortened links as a strong spam signal. Use your full website address.' });
  const tags = unknownTags(text);
  if (tags.length) out.push({ level: 'warn', text: `${tags.join(', ')} ${tags.length === 1 ? "isn't a merge tag" : "aren't merge tags"}, so ${tags.length === 1 ? 'it' : 'they'} would be sent as written.` });
  if (message.length > 1200) out.push({ level: 'warn', text: `${message.length.toLocaleString('en-US')} characters. Long messages read as mass mail, and many forms cut text off at 500 to 1,000 characters.` });
  const words = text.match(/\b[A-Z]{4,}\b/g) || [];
  if (words.length >= 3 || (text.match(/!/g) || []).length >= 3) out.push({ level: 'warn', text: 'Several words in capitals or exclamation marks. They look like shouting to readers and to filters.' });
  const phrase = text.match(SPAMMY);
  if (phrase) out.push({ level: 'warn', text: `“${phrase[0]}” is a common spam phrase. Plain wording gets past filters and reads as more trustworthy.` });
  if (message.trim().length >= 40 && !WAY_OUT.test(message)) out.push({ level: 'tip', text: 'Add a one-line way out, for example “Not a fit? Reply ‘no’ and I won’t reach out again.” It lowers spam reports, which protect your sender profile everywhere.' });
  return out;
}
