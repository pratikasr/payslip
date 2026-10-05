/*
  Presenter mode: larger type and no secondary chrome, for screen recordings at
  1280x720. Turned on with ?present=1 (off with ?present=0) or Alt+P, and kept
  for the browser tab in sessionStorage so it survives navigation and reloads.
*/
export const PRESENT_KEY = "payslip.present";
export const PRESENT_ATTR = "data-present";
/** The payer setup guide's dismissal (src/components/payer/setup-guide.tsx), applied before first paint too. */
const GUIDE_DISMISS_KEY = "payslip.setup-guide.dismissed";

/**
 * Runs before first paint (inlined in the root layout), so a reload in
 * presenter mode never flashes the normal size first. It also marks a payer
 * setup guide the payer chose to hide, so it is never painted and removed.
 */
export const presenterBootScript = `(function(){try{var k=${JSON.stringify(PRESENT_KEY)},s=window.sessionStorage,q=new URLSearchParams(window.location.search).get("present");if(q==="1")s.setItem(k,"1");else if(q==="0")s.removeItem(k);if(s.getItem(k)==="1")document.documentElement.setAttribute(${JSON.stringify(PRESENT_ATTR)},"")}catch(e){}try{if(window.localStorage.getItem(${JSON.stringify(GUIDE_DISMISS_KEY)})==="1")document.documentElement.setAttribute("data-guide-hidden","")}catch(e){}})();`;
