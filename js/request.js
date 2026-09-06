/* ==========================================================================
   Request-a-report dialog, V9.

   One dialog per page, opened by any [data-request-report] button. The
   button carries the report ID, title and a one-line meta; the dialog shows
   them, takes a work email (name and organisation optional), and posts to
   /api/request-report. The server resolves the ID against its own registry
   and sends the document; the browser never names a file.

   Behaviour: focus moves into the dialog on open and returns to the button
   on close; Tab is trapped; Escape and the scrim close it; the page behind
   is made inert; the outcome is announced through a live region. Two
   truthful end states — sent, or not sent with a reason — and never a
   success message the server did not earn.
   ========================================================================== */

(function () {
  'use strict';

  var doc = document;
  var modal = doc.getElementById('reqModal');
  if (!modal) return;

  var form = doc.getElementById('reqForm');
  var panel = modal.querySelector('.req-panel');
  var titleEl = modal.querySelector('[data-req-title]');
  var metaEl = modal.querySelector('[data-req-meta]');
  var idEl = modal.querySelector('[data-req-id]');
  var status = modal.querySelector('.req-status');
  var emailInput = doc.getElementById('rq-email');
  var emailErr = doc.getElementById('rq-email-err');
  var doneTitle = modal.querySelector('[data-req-done-title]');
  var doneBody = modal.querySelector('[data-req-done-body]');
  var doneBodyDefault = doneBody ? doneBody.innerHTML : '';
  var submitBtn = form.querySelector('button[type="submit"]');
  var opener = null;
  var lenis = null;

  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function inertOthers(on) {
    Array.prototype.forEach.call(doc.body.children, function (node) {
      if (node === modal || node.tagName === 'SCRIPT') return;
      if (on) { node.setAttribute('inert', ''); node.setAttribute('aria-hidden', 'true'); }
      else { node.removeAttribute('inert'); node.removeAttribute('aria-hidden'); }
    });
  }

  var busy = false;
  function reset() {
    form.reset();
    busy = false;
    modal.classList.remove('is-done');
    /* The status region stays in the document, empty, so a later message
       is an update to something assistive technology already knows about. */
    if (status) { status.textContent = ''; status.classList.remove('is-error'); }
    if (emailErr) emailErr.hidden = true;
    if (emailInput) emailInput.removeAttribute('aria-invalid');
    if (submitBtn) submitBtn.removeAttribute('aria-busy');
    form.removeAttribute('aria-busy');
    if (doneBody) doneBody.innerHTML = doneBodyDefault;
    if (doneTitle) doneTitle.textContent = 'Check your inbox. The report has been sent.';
  }

  function open(btn) {
    opener = btn;
    reset();
    var id = btn.getAttribute('data-request-report') || '';
    var title = btn.getAttribute('data-report-title') || 'the report';
    var meta = btn.getAttribute('data-report-meta') || '';
    if (idEl) idEl.value = id;
    if (titleEl) titleEl.textContent = title;
    if (metaEl) { metaEl.textContent = meta; metaEl.hidden = !meta; }

    modal.hidden = false;
    /* next frame, so the transition has a start state to leave */
    window.requestAnimationFrame(function () { modal.classList.add('is-open'); });
    doc.body.classList.add('modal-open');
    inertOthers(true);
    lenis = window.__lenis || null;
    if (lenis) lenis.stop();
    window.setTimeout(function () { if (emailInput) emailInput.focus(); }, 30);
  }

  function close() {
    modal.classList.remove('is-open');
    modal.hidden = true;
    doc.body.classList.remove('modal-open');
    inertOthers(false);
    if (lenis) lenis.start();
    if (opener && typeof opener.focus === 'function') opener.focus();
    opener = null;
  }

  /* openers */
  doc.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-request-report]');
    if (btn) { e.preventDefault(); open(btn); return; }
    if (e.target.closest && e.target.closest('[data-req-close]')) { e.preventDefault(); close(); return; }
    if (!modal.hidden && e.target === modal) close();
  });

  /* keyboard: Escape closes; Tab is trapped inside the panel */
  doc.addEventListener('keydown', function (e) {
    if (modal.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    var nodes = Array.prototype.filter.call(panel.querySelectorAll(FOCUSABLE), function (n) {
      return n.offsetParent !== null || n === doc.activeElement;
    });
    if (!nodes.length) return;
    var first = nodes[0], last = nodes[nodes.length - 1];
    if (e.shiftKey && (doc.activeElement === first || !panel.contains(doc.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* Send: validate, post, and report exactly what the server said. */
  var FALLBACK = 'We could not send the report automatically just now. Your request has not been lost: email inquiries@kakderesearch.com and it will be sent directly.';

  function say(text, isError) {
    if (!status) return;
    status.textContent = text;
    status.classList.toggle('is-error', !!isError);
  }

  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    var email = (emailInput && emailInput.value || '').trim();
    if (!validEmail(email)) {
      if (emailErr) emailErr.hidden = false;
      if (emailInput) { emailInput.setAttribute('aria-invalid', 'true'); emailInput.focus(); }
      return;
    }
    if (emailErr) emailErr.hidden = true;
    if (emailInput) emailInput.removeAttribute('aria-invalid');

    var values = Object.fromEntries(new FormData(form).entries());
    values.page_path = window.location.pathname;
    values.referrer = doc.referrer || '';

    /* The button keeps focus and stays enabled while sending; a second press
       is ignored rather than the control vanishing under the reader. */
    busy = true;
    if (submitBtn) submitBtn.setAttribute('aria-busy', 'true');
    form.setAttribute('aria-busy', 'true');
    say('Sending the report to ' + email + '…', false);

    var ctrl = ('AbortController' in window) ? new AbortController() : null;
    var timer = ctrl ? window.setTimeout(function () { ctrl.abort(); }, 20000) : null;

    fetch('/api/request-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (timer) window.clearTimeout(timer);
        if (!res.ok || !data.ok) {
          /* 4xx carries something the visitor can act on; 5xx never does. */
          throw new Error(res.status < 500 && data.error ? data.error : FALLBACK);
        }
        /* The server distinguishes "sent" from "recorded, will follow by
           email" — the dialog says exactly which. */
        if (data.delivered === false) {
          if (doneTitle) doneTitle.textContent = 'Request noted.';
          if (doneBody) doneBody.textContent = data.message || 'This report is nearing completion. We will send it to your email once it is published. Thank you for your interest.';
        } else {
          if (doneTitle) doneTitle.textContent = 'Check your inbox. The report has been sent.';
          if (doneBody && data.message) doneBody.textContent = data.message;
        }
        busy = false;
        if (submitBtn) submitBtn.removeAttribute('aria-busy');
        form.removeAttribute('aria-busy');
        modal.classList.add('is-done');
        /* The dialog's own title and the report name stay visible above the
           outcome, so its accessible name and description do not change.
           Focus moves to the outcome heading, which is what happened. */
        window.setTimeout(function () { if (doneTitle) doneTitle.focus(); }, 30);
        var announce = modal.querySelector('.req-done [role="status"]');
        if (announce) announce.textContent = (doneTitle ? doneTitle.textContent : 'Sent.') + ' ' + (doneBody ? doneBody.textContent : '');
      });
    }).catch(function (err) {
      if (timer) window.clearTimeout(timer);
      busy = false;
      say(err && err.name === 'AbortError' ? FALLBACK : (err && err.message) || FALLBACK, true);
      if (submitBtn) submitBtn.removeAttribute('aria-busy');
      form.removeAttribute('aria-busy');
    });
  });
})();
