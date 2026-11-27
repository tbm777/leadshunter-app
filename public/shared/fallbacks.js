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
  city: { value: () => DEFAULT_ADDRESS.city, hint: () => `the business’s own city (${DEFAULT_ADDRESS.city} if unknown)` },
  state: { value: () => DEFAULT_ADDRESS.state, hint: () => `the business’s state (${DEFAULT_ADDRESS.state} if unknown)` },
  zip: { value: () => DEFAULT_ADDRESS.zip, hint: () => `the business’s ZIP (${DEFAULT_ADDRESS.zip} if unknown)` },
  country: { value: () => DEFAULT_ADDRESS.country, hint: () => DEFAULT_ADDRESS.country },
};

const US_STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };

/**
 * With no address in the sender profile, use the city, state and ZIP of the business being contacted,
 * so the sender looks local and service-area checks pass. Only for US businesses with a complete,
 * matching set; otherwise the coherent placeholder address stays. The street stays the placeholder.
 */
export function localizeProfile(profile, sender, lead) {
  if (!lead || ['address', 'city', 'state', 'zip'].some(k => String(sender[k] || '').trim())) return profile;
  const st = String(lead.state || '').trim().toUpperCase(), city = String(lead.city || '').trim(), zip = String(lead.zip || '').trim();
  if ((lead.country && lead.country !== 'US') || !US_STATES[st] || !city || !/^\d{5}(-\d{4})?$/.test(zip)) return profile;
  return { ...profile, city, state: st, stateName: US_STATES[st], zip, country: DEFAULT_ADDRESS.country };
}

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
