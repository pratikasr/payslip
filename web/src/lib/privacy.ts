/*
  Privacy mode (Mercury's eye): blurs every amount (html[data-private] .money) while the payer
  shares their screen. Kept for the browser tab in sessionStorage, so it survives navigation,
  reloads and links opened straight into Run payroll.
*/
export const PRIVATE_KEY = "payslip.private";
export const PRIVATE_ATTR = "data-private";

/**
 * Runs before first paint (inlined at the top of the console layout), so a reload with privacy
 * on never shows the amounts, even for a moment.
 */
export const privacyBootScript = `(function(){try{if(window.sessionStorage.getItem(${JSON.stringify(PRIVATE_KEY)})==="1")document.documentElement.setAttribute(${JSON.stringify(PRIVATE_ATTR)},"")}catch(e){}})();`;
