/* Admin panel logic. */
(function () {
  'use strict';
  var S = window.DiaryShared;
  var $ = function (id) { return document.getElementById(id); };

  var ICONS = ['📌', '🩺', '💊', '🏥', '🦷', '👓', '👂', '🧑‍⚕️', '👪', '👩', '👨', '👵', '👴', '👧', '👦', '👶',
    '🐶', '☕', '🍽️', '🥪', '🍰', '🛒', '🚗', '🚕', '🚌', '💇', '🛁', '🧺', '📞', '💻', '⛪', '🎂', '🎉',
    '🎵', '📺', '🌳', '🚶', '🧶', '🎨', '🃏', '🏠', '🛏️', '✉️', '🗑️', '⭐'];

  var state = { me: null, events: [], settings: null, editing: null };

  /* ---------- API ---------- */
  function api(method, url, body) {
    return fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: body !== undefined ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.status === 401 && url !== '/api/login') { showLogin(); throw new Error('Please log in again.'); }
        if (!r.ok) throw new Error(data.error || 'Something went wrong (' + r.status + ')');
        return data;
      });
    });
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.add('hidden'); }, 2500);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function button(text, cls, onClick) {
    var b = el('button', 'btn small' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  /* ---------- login ---------- */
  function showLogin() {
    $('main').classList.add('hidden');
    $('login').classList.remove('hidden');
  }
  function showMain() {
    $('login').classList.add('hidden');
    $('main').classList.remove('hidden');
    $('me').textContent = 'Logged in as ' + state.me;
    loadAll();
  }

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    $('login-error').textContent = '';
    api('POST', '/api/login', { username: f.username.value, password: f.password.value })
      .then(function (d) { state.me = d.username; f.password.value = ''; showMain(); })
      .catch(function (err) { $('login-error').textContent = err.message; });
  });
  $('logout').addEventListener('click', function () {
    api('POST', '/api/logout', {}).finally(showLogin);
  });

  /* ---------- tabs ---------- */
  $('tabs').addEventListener('click', function (e) {
    var tab = e.target.getAttribute('data-tab');
    if (!tab) return;
    Array.prototype.forEach.call($('tabs').children, function (b) { b.classList.toggle('active', b === e.target); });
    ['entries', 'settings', 'people'].forEach(function (t) { $('tab-' + t).classList.toggle('hidden', t !== tab); });
    if (tab === 'people') loadUsers();
  });

  function loadAll() {
    api('GET', '/api/events').then(function (d) { state.events = d.events; renderAgenda(); }).catch(function (e) { toast(e.message); });
    api('GET', '/api/settings').then(function (d) { state.settings = d.settings; renderSettings(); }).catch(function () {});
  }

  /* ---------- entry form ---------- */
  var form = $('entry-form');

  function buildIconPicker() {
    var box = $('icon-picker');
    ICONS.forEach(function (ic) {
      var b = el('button', null, ic);
      b.type = 'button';
      b.title = ic;
      b.addEventListener('click', function () { selectIcon(ic); });
      box.appendChild(b);
    });
  }
  function selectIcon(ic) {
    form.icon.value = ic;
    Array.prototype.forEach.call($('icon-picker').children, function (b) { b.classList.toggle('selected', b.textContent === ic); });
  }

  function updateRepeatUI() {
    $('until-label').classList.toggle('hidden', form.repeat.value === 'none');
  }
  form.repeat.addEventListener('change', updateRepeatUI);

  function resetForm(dateStr) {
    form.reset();
    state.editing = null;
    form.date.value = dateStr || S.toDateStr(new Date());
    selectIcon('📌');
    updateRepeatUI();
    $('form-title').textContent = 'Add an entry';
    $('save-btn').textContent = 'Add to diary';
    $('cancel-edit').textContent = 'Clear';
    $('delete-btn').classList.add('hidden');
    $('form-error').textContent = '';
    $('form-meta').textContent = '';
    form.classList.remove('editing');
  }

  function editEvent(ev) {
    state.editing = ev;
    form.title.value = ev.title;
    form.date.value = ev.date;
    form.time.value = ev.time || '';
    form.endTime.value = ev.endTime || '';
    form.notes.value = ev.notes || '';
    form.repeat.value = ev.repeat || 'none';
    form.repeatUntil.value = ev.repeatUntil || '';
    form.important.checked = !!ev.important;
    selectIcon(ev.icon || '📌');
    updateRepeatUI();
    $('form-title').textContent = ev.repeat && ev.repeat !== 'none' ? 'Edit repeating entry (all dates)' : 'Edit entry';
    $('save-btn').textContent = 'Save changes';
    $('cancel-edit').textContent = 'Cancel';
    $('delete-btn').classList.remove('hidden');
    $('form-error').textContent = '';
    var meta = 'Added by ' + (ev.createdBy || '?');
    if (ev.updatedBy && ev.updatedAt !== ev.createdAt) meta += ' · last changed by ' + ev.updatedBy + ' on ' + new Date(ev.updatedAt).toLocaleString('en-GB');
    $('form-meta').textContent = meta;
    form.classList.add('editing');
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form.title.focus({ preventScroll: true });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var body = {
      title: form.title.value, date: form.date.value, time: form.time.value, endTime: form.endTime.value,
      icon: form.icon.value, notes: form.notes.value, repeat: form.repeat.value,
      repeatUntil: form.repeatUntil.value, important: form.important.checked
    };
    var req = state.editing
      ? api('PUT', '/api/events/' + state.editing.id, Object.assign(body, { skipDates: state.editing.skipDates || [] }))
      : api('POST', '/api/events', body);
    req.then(function (d) {
      var i = state.events.findIndex(function (x) { return x.id === d.event.id; });
      if (i >= 0) state.events[i] = d.event; else state.events.push(d.event);
      toast(state.editing ? 'Saved' : 'Added to the diary');
      resetForm(body.date);
      renderAgenda();
    }).catch(function (err) { $('form-error').textContent = err.message; });
  });

  $('cancel-edit').addEventListener('click', function () { resetForm(); });

  $('delete-btn').addEventListener('click', function () {
    var ev = state.editing;
    if (!ev) return;
    var repeating = ev.repeat && ev.repeat !== 'none';
    if (!confirm(repeating ? 'Delete "' + ev.title + '" on ALL dates?' : 'Delete "' + ev.title + '"?')) return;
    api('DELETE', '/api/events/' + ev.id).then(function () {
      state.events = state.events.filter(function (x) { return x.id !== ev.id; });
      resetForm();
      renderAgenda();
      toast('Deleted');
    }).catch(function (err) { toast(err.message); });
  });

  function skipDate(ev, dateStr, undo) {
    api('POST', '/api/events/' + ev.id + '/skip', { date: dateStr, undo: !!undo }).then(function (d) {
      var i = state.events.findIndex(function (x) { return x.id === d.event.id; });
      state.events[i] = d.event;
      if (state.editing && state.editing.id === ev.id) state.editing = d.event;
      renderAgenda();
      toast(undo ? 'Put back' : 'Removed from that day only');
    }).catch(function (err) { toast(err.message); });
  }

  /* ---------- agenda ---------- */
  function dayLabel(d, todayD) {
    var n = S.daysBetween(todayD, d);
    var base = S.WEEKDAYS[d.getDay()] + ' ' + d.getDate() + ' ' + S.MONTHS[d.getMonth()];
    if (n === 0) return 'Today – ' + base;
    if (n === 1) return 'Tomorrow – ' + base;
    return base;
  }

  function renderAgenda() {
    var use24 = state.settings ? state.settings.clock24 : false;
    var days = Number($('agenda-range').value);
    var t = new Date(); t = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    var box = $('agenda');
    box.textContent = '';
    var any = false;

    for (var i = 0; i < days; i++) {
      var d = S.addDays(t, i);
      var ds = S.toDateStr(d);
      var items = S.entriesForDate(state.events, ds);
      if ($('hide-routine').checked) items = items.filter(function (e) { return e.repeat !== 'daily' && e.repeat !== 'weekdays'; });
      if (!items.length && i !== 0) continue;
      any = any || items.length > 0;
      var g = el('div', 'day-group' + (i === 0 ? ' is-today' : ''));
      g.appendChild(el('h3', null, dayLabel(d, t)));
      if (!items.length) g.appendChild(el('div', 'empty', 'Nothing yet today.'));
      items.forEach(function (ev) { g.appendChild(occurrenceRow(ev, ds, use24)); });
      var add = button('+ Add on this day', '', (function (dstr) { return function () { resetForm(dstr); form.title.focus(); form.scrollIntoView({ behavior: 'smooth' }); }; })(ds));
      add.style.marginTop = '0.2rem';
      g.appendChild(add);
      box.appendChild(g);
    }
    if (!any) box.appendChild(el('p', 'empty', 'Nothing in the diary for this period yet. Use the form to add something.'));

    // repeating list
    var rep = state.events.filter(function (e) { return e.repeat && e.repeat !== 'none'; })
      .sort(function (a, b) { return (a.time || '') < (b.time || '') ? -1 : 1; });
    $('rep-count').textContent = rep.length;
    var rl = $('repeating-list');
    rl.textContent = '';
    rep.forEach(function (ev) {
      var li = el('li');
      var span = el('span');
      span.appendChild(document.createTextNode((ev.icon || '📌') + ' ' + ev.title + (ev.time ? ' at ' + S.formatTime(ev.time, use24) : '')));
      span.appendChild(el('small', null, S.describeRepeat(ev) + (ev.skipDates && ev.skipDates.length ? ' · skipped on ' + ev.skipDates.length + ' date(s)' : '')));
      li.appendChild(span);
      if (ev.skipDates && ev.skipDates.length) {
        var sel = el('select');
        sel.appendChild(el('option', null, 'Put back a skipped date…'));
        ev.skipDates.forEach(function (sd) { var o = el('option', null, sd); o.value = sd; sel.appendChild(o); });
        sel.style.width = 'auto';
        sel.addEventListener('change', function () { if (sel.value && sel.selectedIndex > 0) skipDate(ev, sel.value, true); });
        li.appendChild(sel);
      }
      li.appendChild(button('Edit', '', function () { editEvent(ev); }));
      rl.appendChild(li);
    });

    // past one-offs
    var todayStr = S.toDateStr(t);
    var past = state.events.filter(function (e) { return (!e.repeat || e.repeat === 'none') && e.date < todayStr; })
      .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    $('past-count').textContent = past.length;
    var pl = $('past-list');
    pl.textContent = '';
    past.slice(0, 200).forEach(function (ev) {
      var li = el('li');
      var span = el('span');
      span.appendChild(document.createTextNode((ev.icon || '📌') + ' ' + ev.title));
      span.appendChild(el('small', null, ev.date + (ev.time ? ' ' + S.formatTime(ev.time, use24) : '')));
      li.appendChild(span);
      li.appendChild(button('Edit', '', function () { editEvent(ev); }));
      pl.appendChild(li);
    });
  }

  function occurrenceRow(ev, ds, use24) {
    var row = el('div', 'occ' + (ev.important ? ' important' : ''));
    row.appendChild(el('div', 'o-time', ev.time ? S.formatTime(ev.time, use24) + (ev.endTime ? '–' + S.formatTime(ev.endTime, use24) : '') : 'All day'));
    row.appendChild(el('div', 'o-icon', ev.icon || '📌'));
    var body = el('div', 'o-body');
    body.appendChild(el('div', 'o-title', ev.title));
    var sub = [];
    if (ev.notes) sub.push(ev.notes);
    if (ev.repeat && ev.repeat !== 'none') sub.push('🔁 ' + S.describeRepeat(ev));
    if (sub.length) body.appendChild(el('div', 'o-sub', sub.join(' · ')));
    row.appendChild(body);
    var actions = el('div', 'o-actions');
    actions.appendChild(button('Edit', '', function () { editEvent(ev); }));
    if (ev.repeat && ev.repeat !== 'none') {
      actions.appendChild(button('Skip this day', 'danger', function () {
        if (confirm('Remove "' + ev.title + '" from ' + ds + ' only? Other dates stay.')) skipDate(ev, ds);
      }));
    }
    row.appendChild(actions);
    return row;
  }
  $('agenda-range').addEventListener('change', renderAgenda);
  $('hide-routine').addEventListener('change', renderAgenda);

  /* ---------- settings ---------- */
  var sform = $('settings-form');
  function displayLink() {
    return location.origin + '/?key=' + encodeURIComponent(state.settings.displayKey);
  }
  function renderSettings() {
    var s = state.settings;
    sform.personName.value = s.personName || '';
    sform.homeMessage.value = s.homeMessage || '';
    sform.idleMinutes.value = s.idleMinutes;
    sform.calendarWeeks.value = s.calendarWeeks;
    sform.clock24.checked = !!s.clock24;
    $('display-link').textContent = displayLink();
    $('open-display').href = displayLink();
    renderAgenda();
  }
  sform.addEventListener('submit', function (e) {
    e.preventDefault();
    api('PUT', '/api/settings', {
      personName: sform.personName.value, homeMessage: sform.homeMessage.value,
      idleMinutes: sform.idleMinutes.value, calendarWeeks: sform.calendarWeeks.value, clock24: sform.clock24.checked
    }).then(function (d) {
      state.settings = d.settings; renderSettings();
      $('settings-ok').textContent = 'Saved. The tablet will update within a minute.';
      setTimeout(function () { $('settings-ok').textContent = ''; }, 4000);
    }).catch(function (err) { toast(err.message); });
  });
  $('copy-link').addEventListener('click', function () {
    var link = displayLink();
    if (navigator.clipboard) navigator.clipboard.writeText(link).then(function () { toast('Link copied'); }, function () { prompt('Copy this link:', link); });
    else prompt('Copy this link:', link);
  });
  $('regen-key').addEventListener('click', function () {
    if (!confirm('Make a new display key? The tablet will stop updating until you open the new link on it.')) return;
    api('PUT', '/api/settings', { regenerateKey: true }).then(function (d) { state.settings = d.settings; renderSettings(); toast('New key made'); });
  });

  /* ---------- people ---------- */
  function loadUsers() {
    api('GET', '/api/users').then(function (d) {
      var ul = $('user-list');
      ul.textContent = '';
      d.users.forEach(function (u) {
        var li = el('li');
        var span = el('span', null, u.username + (u.username === state.me ? ' (you)' : ''));
        if (u.created) span.appendChild(el('small', null, 'Added ' + new Date(u.created).toLocaleDateString('en-GB')));
        li.appendChild(span);
        if (u.username !== state.me) {
          li.appendChild(button('Remove', 'danger', function () {
            if (!confirm('Remove ' + u.username + '? They will no longer be able to log in.')) return;
            api('DELETE', '/api/users/' + encodeURIComponent(u.username)).then(loadUsers).catch(function (err) { toast(err.message); });
          }));
        }
        ul.appendChild(li);
      });
    }).catch(function () {});
  }
  $('user-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    $('user-error').textContent = ''; $('user-ok').textContent = '';
    api('POST', '/api/users', { username: f.username.value, password: f.password.value }).then(function () {
      $('user-ok').textContent = 'Added ' + f.username.value + '. Send them the admin address and their password.';
      f.reset(); loadUsers();
    }).catch(function (err) { $('user-error').textContent = err.message; });
  });
  $('pw-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    $('pw-error').textContent = ''; $('pw-ok').textContent = '';
    api('PUT', '/api/users/me/password', { current: f.current.value, password: f.password.value }).then(function () {
      $('pw-ok').textContent = 'Password changed.'; f.reset();
    }).catch(function (err) { $('pw-error').textContent = err.message; });
  });

  /* ---------- start ---------- */
  buildIconPicker();
  resetForm();
  fetch('/api/me', { credentials: 'same-origin' }).then(function (r) {
    if (!r.ok) throw new Error();
    return r.json();
  }).then(function (d) { state.me = d.username; showMain(); }).catch(showLogin);
})();
