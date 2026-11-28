// The instant check, in the browser. Calls /api/check on this site and draws
// the result. Everything in the result comes from a site somebody else controls,
// so it is only ever inserted as text (textContent), never as HTML.
(function () {
  var ISSUE_NEW = 'https://github.com/khalidsaidi/agentability/issues/new?template=audit-request.yml';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  function scoreColor(s) {
    return s >= 85 ? '#46e094' : s >= 70 ? '#9ad94f' : s >= 55 ? '#ffd23f' : s >= 40 ? '#ff9f43' : '#ff5c5c';
  }

  function askLink(domain) {
    var a = el('a', null, 'Ask us to add ' + domain + ' to the Index');
    a.href = ISSUE_NEW + '&title=' + encodeURIComponent('Audit request: ' + domain);
    return a;
  }

  function render(out, data) {
    out.textContent = '';
    var head = el('div', 'chk-head');
    var score = el('span', 'chk-score', data.score);
    score.style.color = scoreColor(data.score);
    head.appendChild(score);
    head.appendChild(el('span', 'chk-of', '/100'));
    var who = el('div', 'chk-who');
    who.appendChild(el('b', null, data.domain));
    who.appendChild(el('span', 'chip', 'Grade ' + data.grade));
    if (data.posture === 'closed') who.appendChild(el('span', 'chip closed', 'closed by policy'));
    head.appendChild(who);
    out.appendChild(head);

    var list = el('ul', 'chk-list');
    (data.checks || []).forEach(function (c) {
      var li = el('li', 'chk-' + c.status);
      var top = el('div', 'chk-row');
      top.appendChild(el('span', 'chk-id', c.id));
      top.appendChild(el('span', 'chk-title', c.title));
      top.appendChild(el('span', 'chk-pts', c.points + '/' + c.maxPoints));
      li.appendChild(top);
      li.appendChild(el('p', 'chk-detail', c.detail));
      list.appendChild(li);
    });
    out.appendChild(list);

    var when = new Date(data.checkedAt);
    var foot = el('p', 'chk-foot');
    foot.appendChild(document.createTextNode((data.cached ? 'Checked ' + when.toLocaleString() + ' (cached for 24 hours). ' : 'Checked just now. ') +
      'This check is not saved to the Index or published. For a public report page that is re-checked every week: '));
    foot.appendChild(askLink(data.domain));
    foot.appendChild(document.createTextNode('.'));
    out.appendChild(foot);
  }

  function run(domain, out, button, source) {
    domain = String(domain || '').trim();
    if (!domain) return;
    out.hidden = false;
    out.textContent = '';
    out.appendChild(el('p', 'chk-wait', 'Checking ' + domain + ' the way an AI agent would… usually 2 to 10 seconds.'));
    if (button) button.disabled = true;
    var started = Date.now();
    fetch('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: domain })
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) { return { ok: r.ok, status: r.status, body: body }; });
      })
      .then(function (r) {
        if (r.ok && typeof r.body.score === 'number') {
          render(out, r.body);
        } else {
          out.textContent = '';
          var p = el('p', 'chk-err', r.body.message || ('The check failed (' + r.status + '). Try again in a minute.'));
          out.appendChild(p);
          if (r.body.error === 'unreachable' || r.body.error === 'timeout') {
            var q = el('p', 'chk-foot');
            q.appendChild(askLink(r.body.domain || domain));
            out.appendChild(q);
          }
        }
        if (window.gtag) {
          gtag('event', 'site_check', {
            site_domain: (r.body && r.body.domain) || domain,
            result: r.ok ? 'scored' : (r.body && r.body.error) || String(r.status),
            score: r.body && r.body.score,
            cached: !!(r.body && r.body.cached),
            seconds: Math.round((Date.now() - started) / 1000),
            page_type: source
          });
        }
      })
      .catch(function () {
        out.textContent = '';
        out.appendChild(el('p', 'chk-err', 'Could not reach the checker. Check your connection and try again.'));
      })
      .then(function () {
        if (button) button.disabled = false;
      });
  }

  window.agentabilityCheck = run;

  // A plain form: <form data-sitecheck> with an input, a button and an output.
  document.querySelectorAll('form[data-sitecheck]').forEach(function (form) {
    var input = form.querySelector('input');
    var button = form.querySelector('button');
    var out = document.getElementById(form.getAttribute('data-sitecheck'));
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      run(input.value, out, button, form.getAttribute('data-source') || 'support');
    });
  });
})();
