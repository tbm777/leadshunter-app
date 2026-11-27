// What goes into a form when a sender profile field is left empty. Shared by the app (shown as hints) and the runner (used).
// Name, email and phone are required, so they never fall back.
const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|aol|proton|protonmail|gmx|mail|zoho)\./i;
const emailDomain = (email) => { const d = String(email || '').split('@')[1] || ''; return d && !FREE_MAIL.test(d) ? d.toLowerCase() : ''; };

// One coherent placeholder address, so city, state and ZIP always agree.
export const DEFAULT_ADDRESS = { address: '100 Congress Ave', city: 'Austin', state: 'TX', stateName: 'Texas', zip: '78701', country: 'United States' };

/** Each optional field: how its fallback is worked out, and how the app describes it. */
export const SENDER_FALLBACKS = {
  company: { value: s => `${s.first_name || ''} ${s.last_name || ''}`.trim(), hint: s => `${`${s.first_name || ''} ${s.last_name || ''}`.trim() || 'your full name'} (your full name)` },
  website: { value: s => emailDomain(s.email) || 'N/A', hint: s => emailDomain(s.email) ? `${emailDomain(s.email)} (from your email)` : 'N/A, or your email domain if it isn’t Gmail/Outlook' },
  address: { value: () => DEFAULT_ADDRESS.address, hint: () => DEFAULT_ADDRESS.address },
  city: { value: () => DEFAULT_ADDRESS.city, hint: () => DEFAULT_ADDRESS.city },
  state: { value: () => DEFAULT_ADDRESS.state, hint: () => DEFAULT_ADDRESS.state },
  zip: { value: () => DEFAULT_ADDRESS.zip, hint: () => DEFAULT_ADDRESS.zip },
  country: { value: () => DEFAULT_ADDRESS.country, hint: () => DEFAULT_ADDRESS.country },
};

/** Sender profile (database shape) → the profile the form engine uses, with every empty field filled. */
export function engineProfile(s) {
  const pick = (k) => String(s[k] || '').trim() || SENDER_FALLBACKS[k].value(s);
  const addressGiven = ['address', 'city', 'state', 'zip'].some(k => String(s[k] || '').trim());
  // With no address at all, use the whole placeholder address; with part of one, only fill the gaps.
  const state = pick('state');
  return {
    firstName: s.first_name, lastName: s.last_name, email: s.email, phone: s.phone,
    company: pick('company'), website: pick('website'),
    address: pick('address'), city: pick('city'), state, stateName: !addressGiven || state === 'TX' ? DEFAULT_ADDRESS.stateName : '', zip: pick('zip'), country: pick('country'),
  };
}

/** Values the engine picks for form fields that aren't in the profile or campaign (shown in the app). */
export const OTHER_FIELDS = [
  ['Dropdowns (service, topic…)', '“General inquiry”, “Other” or “Quote” if offered, otherwise a random real option'],
  ['How did you hear about us', '“Google” or “Online search” if offered'],
  ['Radio buttons', 'Email, General, Other or Yes if offered, otherwise a random option'],
  ['Consent and terms boxes', 'Ticked'],
  ['Dates', 'Two business days from today, within any allowed range'],
  ['Times', '10:00 am, or the earliest allowed time'],
  ['Numbers and sliders', 'The lowest allowed value (at least 1); budgets use the middle of the range'],
  ['Required file upload', 'Your branded PDF, or page 1 as an image for image-only forms'],
  ['Anything else required', '“N/A”, adjusted to any length or format rule'],
];
