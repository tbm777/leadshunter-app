// Requests the form engine never needs: analytics, ads, chat widgets, video players and web fonts.
// CAPTCHA services (google.com/recaptcha, gstatic, hcaptcha, Cloudflare Turnstile) and form builders are never blocked.
const BLOCK_HOSTS = /(^|\.)(google-analytics\.com|googletagmanager\.com|googleadservices\.com|doubleclick\.net|googlesyndication\.com|adservice\.google\.com|facebook\.net|connect\.facebook\.net|hotjar\.com|clarity\.ms|segment\.(io|com)|mixpanel\.com|fullstory\.com|mouseflow\.com|crazyegg\.com|luckyorange\.(com|net)|quantserve\.com|scorecardresearch\.com|bing\.com\/bat|bat\.bing\.com|ads\.linkedin\.com|snap\.licdn\.com|analytics\.tiktok\.com|static\.ads-twitter\.com|intercom\.io|intercomcdn\.com|driftt\.com|drift\.com|tawk\.to|embed\.tawk\.to|zopim\.com|zdassets\.com|livechatinc\.com|crisp\.chat|tidio\.co|olark\.com|podium\.com|birdeye\.com|youtube\.com|ytimg\.com|player\.vimeo\.com|vimeocdn\.com|wistia\.(com|net)|fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|js\.hs-analytics\.net|js\.hs-banner\.com|js\.hsadspixel\.net|js\.usemessages\.com)$/i;
const NEVER = /recaptcha|hcaptcha|challenges\.cloudflare\.com|turnstile|gstatic\.com\/recaptcha|hsforms|jotform|typeform|formstack|wufoo|cognitoforms|formspree|wpforms|gravity/i;

export function shouldBlock(url, type) {
  if (type === 'media' || type === 'font') return true;
  let u; try { u = new URL(url); } catch { return false; }
  if (NEVER.test(u.hostname + u.pathname)) return false;
  return BLOCK_HOSTS.test(u.hostname) || BLOCK_HOSTS.test(u.hostname + u.pathname);
}
