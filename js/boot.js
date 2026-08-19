/* Arms the animation start-states only when JS is alive and the reader has
   not asked for reduced motion. Externalised from an inline <head> block so
   the site can ship a Content-Security-Policy without script 'unsafe-inline'.
   The watchdog un-arms the states if the animation layer never reports in. */
(function () {
  var d = document.documentElement;
  d.className += ' js';
  try {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      d.className += ' anim';
      window.setTimeout(function () {
        if (!window.__kr_ready) d.className = d.className.replace(' anim', '');
      }, 2500);
    }
  } catch (e) {}
})();
