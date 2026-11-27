/** Shared with the client theme module; kept out of 'use client' so the root layout can inline it. */
export const THEME_STORAGE_KEY = 'athena-theme';

/** Runs in <head> before first paint so the first frame already has the right theme. */
export const themeScript = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.classList.remove('light','dark');r.classList.add(d?'dark':'light');r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;
