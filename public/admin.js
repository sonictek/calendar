/* Admin panel logic. */
(function () {
  'use strict';
  var S = window.DiaryShared;
  var $ = function (id) { return document.getElementById(id); };

  var ICONS = ['📌', '🩺', '💊', '🏥', '🦷', '👓', '👂', '🧑‍⚕️', '👪', '👩', '👨', '👵', '👴', '👧', '👦', '👶',
    '🐶', '☕', '🍽️', '🥪', '🍰', '🛒', '🚗', '🚕', '🚌', '💇', '🛁', '🧺', '📞', '💻', '⛪', '🎂', '🎉',
    '🎵', '📺', '🌳', '🚶', '🧶', '🎨', '🃏', '🏠', '🛏️', '✉️', '🗑️', '⭐'];

  var state = { me: null, events: [], messages: [], settings: null, editing: null, editingMsg: null };

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
    toast._t = setTimeout(function () { t.classList.add('hidden'); }, msg.length > 40 ? 5000 : 2500);
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
    ['entries', 'messages', 'settings', 'people'].forEach(function (t) { $('tab-' + t).classList.toggle('hidden', t !== tab); });
    if (tab === 'people') loadUsers();
    // Always show the latest from the server (someone else may have changed it).
    if (tab === 'messages') api('GET', '/api/messages').then(function (d) { state.messages = d.messages; renderMessages(); }).catch(function () {});
    if (tab === 'entries') api('GET', '/api/events').then(function (d) { state.events = d.events; renderAgenda(); }).catch(function () {});
  });

  function loadAll() {
    api('GET', '/api/events').then(function (d) { state.events = d.events; renderAgenda(); }).catch(function (e) { toast(e.message); });
    api('GET', '/api/settings').then(function (d) { state.settings = d.settings; renderSettings(); }).catch(function () {});
    api('GET', '/api/messages').then(function (d) { state.messages = d.messages; renderMessages(); }).catch(function () {});
  }

  /* ---------- entry form ---------- */
  var form = $('entry-form');

  function buildIconPicker() {
    var box = $('icon-picker');
    ICONS.forEach(function (ic) {
      var b = el('button', null, ic);
      b.type = 'button';
      b.title = ic === '⭐' ? 'Routine – not counted in the 4-week calendar' : ic;
      b.addEventListener('click', function () { selectIcon(ic); });
      box.appendChild(b);
    });
  }
  function isStar(ic) { return (ic || '').replace(/\uFE0F/g, '') === '⭐'; }
  function selectIcon(ic) {
    form.icon.value = ic;
    Array.prototype.forEach.call($('icon-picker').children, function (b) { b.classList.toggle('selected', b.textContent === ic); });
    // Explain straight away that ⭐ entries are left out of the 4-week calendar.
    $('star-note').classList.toggle('hidden', !isStar(ic));
    $('star-help').classList.toggle('hidden', isStar(ic));
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
      toast((state.editing ? 'Saved' : 'Added to the diary') +
        (isStar(d.event.icon) ? ' – ⭐ routine, not added to the 4-week calendar' : ''));
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
    sform.idleMinutes.value = s.idleMinutes;
    sform.calendarWeeks.value = s.calendarWeeks;
    sform.clock24.checked = !!s.clock24;
    $('display-link').textContent = displayLink();
    $('open-display').href = displayLink();
    renderAgenda();
    renderMessages();
  }
  sform.addEventListener('submit', function (e) {
    e.preventDefault();
    api('PUT', '/api/settings', {
      personName: sform.personName.value,
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

  /* ---------- home messages ---------- */
  var mform = $('msg-form');
  var DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

  /* ---- formatting editor ---- */
  var rteArea = $('rte-area'), rteSource = $('rte-source'), rteBar = $('rte-bar');
  var sourceMode = false, savedRange = null;

  function saveSel() {
    var sel = window.getSelection();
    if (sel.rangeCount && rteArea.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  }
  function restoreSel() {
    rteArea.focus();
    if (savedRange) { var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(savedRange); }
  }
  function exec(cmd, val) {
    if (sourceMode) return;
    restoreSel();
    try { document.execCommand('styleWithCSS', false, true); } catch (e) { /* ignore */ }
    document.execCommand(cmd, false, val);
    saveSel();
    updateBarState();
  }
  function updateBarState() {
    Array.prototype.forEach.call(rteBar.querySelectorAll('button[data-cmd]'), function (b) {
      var cmd = b.getAttribute('data-cmd');
      if (!/^(bold|italic|underline|strikeThrough|insertUnorderedList|justifyCenter)$/.test(cmd)) return;
      var on = false;
      try { on = document.queryCommandState(cmd); } catch (e) { /* ignore */ }
      b.classList.toggle('on', !!on && rteArea.contains(window.getSelection().anchorNode));
    });
  }
  document.addEventListener('selectionchange', function () { saveSel(); updateBarState(); });

  Array.prototype.forEach.call(rteBar.querySelectorAll('button[data-cmd]'), function (b) {
    b.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep the text selected
    b.addEventListener('click', function () { exec(b.getAttribute('data-cmd')); });
  });
  [['rte-size', 'fontSize'], ['rte-color', 'foreColor'], ['rte-hilite', 'hiliteColor']].forEach(function (pair) {
    var sel = $(pair[0]);
    sel.addEventListener('change', function () {
      if (sel.value) exec(pair[1], sel.value);
      sel.value = '';
    });
  });

  // Pasting from Word, web pages etc.: keep only safe formatting.
  rteArea.addEventListener('paste', function (e) {
    var cd = e.clipboardData;
    if (!cd) return;
    e.preventDefault();
    var html = cd.getData('text/html');
    var ins = html ? S.sanitizeToHtml(html) : S.textToHtml(cd.getData('text/plain'));
    document.execCommand('insertHTML', false, ins);
  });
  // Dropped content gets the same treatment.
  rteArea.addEventListener('drop', function (e) { e.preventDefault(); });

  $('rte-source-btn').addEventListener('click', function () {
    if (!sourceMode) {
      rteSource.value = S.sanitizeToHtml(rteArea.innerHTML);
      sourceMode = true;
    } else {
      rteArea.innerHTML = S.sanitizeToHtml(rteSource.value);
      sourceMode = false;
    }
    rteArea.classList.toggle('hidden', sourceMode);
    rteSource.classList.toggle('hidden', !sourceMode);
    rteBar.classList.toggle('source-mode', sourceMode);
    $('rte-source-btn').classList.toggle('on', sourceMode);
    (sourceMode ? rteSource : rteArea).focus();
  });

  function setEditorHtml(html) {
    if (sourceMode) $('rte-source-btn').click();
    rteArea.innerHTML = S.sanitizeToHtml(html || '');
    savedRange = null;
  }
  function getEditorHtml() {
    var html = S.sanitizeToHtml(sourceMode ? rteSource.value : rteArea.innerHTML).trim();
    // An editor left with only empty tags counts as empty.
    return S.htmlToText(html) ? html : '';
  }

  function buildDayChecks() {
    var box = $('day-checks');
    DAY_ORDER.forEach(function (d) {
      var lab = el('label');
      var cb = el('input');
      cb.type = 'checkbox'; cb.name = 'day'; cb.value = String(d);
      cb.addEventListener('change', function () { lab.classList.toggle('on', cb.checked); });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(S.WEEKDAYS[d].slice(0, 3)));
      box.appendChild(lab);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-days]'), function (b) {
      b.addEventListener('click', function () { setDays(b.getAttribute('data-days').split(',').map(Number)); });
    });
  }
  function dayBoxes() { return Array.prototype.slice.call(mform.querySelectorAll('input[name=day]')); }
  function setDays(days) {
    dayBoxes().forEach(function (cb) {
      cb.checked = days.indexOf(Number(cb.value)) !== -1;
      cb.parentNode.classList.toggle('on', cb.checked);
    });
  }
  function updateTimesUI() {
    var allDay = mform.allDay.checked;
    $('msg-times').classList.toggle('hidden', allDay);
    $('msg-times-help').classList.toggle('hidden', allDay);
  }
  mform.allDay.addEventListener('change', updateTimesUI);

  function resetMsgForm() {
    mform.reset();
    setEditorHtml('');
    state.editingMsg = null;
    setDays([0, 1, 2, 3, 4, 5, 6]);
    updateTimesUI();
    $('msg-form-title').textContent = 'Add a home-screen message';
    $('msg-save').textContent = 'Add message';
    $('msg-cancel').textContent = 'Clear';
    $('msg-delete').classList.add('hidden');
    $('msg-error').textContent = '';
    $('msg-meta').textContent = '';
    mform.classList.remove('editing');
  }

  function editMsg(m) {
    state.editingMsg = m;
    setEditorHtml(m.html || S.textToHtml(m.text));
    setDays(m.days || []);
    mform.allDay.checked = !(m.start && m.end);
    mform.start.value = m.start || '';
    mform.end.value = m.end || '';
    mform.enabled.checked = m.enabled !== false;
    mform.priority.value = String(S.messagePriority(m));
    updateTimesUI();
    $('msg-form-title').textContent = 'Edit message';
    $('msg-save').textContent = 'Save changes';
    $('msg-cancel').textContent = 'Cancel';
    $('msg-delete').classList.remove('hidden');
    $('msg-error').textContent = '';
    $('msg-meta').textContent = m.createdBy ? 'Added by ' + m.createdBy + (m.updatedBy && m.updatedAt !== m.createdAt ? ' · last changed by ' + m.updatedBy : '') : '';
    mform.classList.add('editing');
    mform.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  mform.addEventListener('submit', function (e) {
    e.preventDefault();
    var allDay = mform.allDay.checked;
    var body = {
      html: getEditorHtml(),
      text: '',
      days: dayBoxes().filter(function (cb) { return cb.checked; }).map(function (cb) { return Number(cb.value); }),
      start: allDay ? '' : mform.start.value,
      end: allDay ? '' : mform.end.value,
      enabled: mform.enabled.checked,
      priority: Number(mform.priority.value)
    };
    body.text = S.htmlToText(body.html);
    if (!body.text) { $('msg-error').textContent = 'Please type the message.'; rteArea.focus(); return; }
    var editing = state.editingMsg;
    (editing ? api('PUT', '/api/messages/' + editing.id, body) : api('POST', '/api/messages', body))
      .then(function (d) {
        var i = state.messages.findIndex(function (x) { return x.id === d.message.id; });
        if (i >= 0) state.messages[i] = d.message; else state.messages.push(d.message);
        toast(editing ? 'Saved' : 'Message added');
        resetMsgForm();
        renderMessages();
      }).catch(function (err) { $('msg-error').textContent = err.message; });
  });
  $('msg-cancel').addEventListener('click', resetMsgForm);
  function deleteMsg(m) {
    if (!m || !confirm('Delete this message?\n\n"' + m.text.slice(0, 200) + '"')) return;
    api('DELETE', '/api/messages/' + m.id).then(function () {
      state.messages = state.messages.filter(function (x) { return x.id !== m.id; });
      if (state.editingMsg && state.editingMsg.id === m.id) resetMsgForm();
      renderMessages(); toast('Deleted');
    }).catch(function (err) { toast(err.message); });
  }
  function toggleMsg(m) {
    var body = { text: m.text, html: m.html || '', days: m.days, start: m.start, end: m.end, enabled: m.enabled === false, priority: S.messagePriority(m) };
    api('PUT', '/api/messages/' + m.id, body).then(function (d) {
      var i = state.messages.findIndex(function (x) { return x.id === d.message.id; });
      state.messages[i] = d.message;
      if (state.editingMsg && state.editingMsg.id === m.id) editMsg(d.message);
      renderMessages(); toast(d.message.enabled ? 'Switched on' : 'Switched off');
    }).catch(function (err) { toast(err.message); });
  }
  $('msg-delete').addEventListener('click', function () { deleteMsg(state.editingMsg); });

  function renderMessages() {
    var ul = $('msg-list');
    if (!ul) return;
    var use24 = state.settings ? state.settings.clock24 : false;
    var now = new Date();
    ul.textContent = '';
    if (!state.messages.length) {
      ul.appendChild(el('li', 'empty', 'No messages yet. Add one with the form.'));
      return;
    }
    S.sortMessages(state.messages).forEach(function (m) {
      var li = el('li');
      var span = el('span');
      if (m.html) {
        var preview = el('div', 'msg-text rich');
        preview.appendChild(S.sanitizeHtml(m.html));
        span.appendChild(preview);
      } else {
        span.appendChild(el('div', 'msg-text', m.text));
      }
      var sub = el('small', null, S.describeMessageSchedule(m, use24));
      var p = S.messagePriority(m);
      sub.appendChild(el('span', 'badge prio p' + p, 'Priority ' + p + ' – ' + S.PRIORITY_NAMES[p]));
      if (m.enabled === false) sub.appendChild(el('span', 'badge off', 'Switched off'));
      else if (S.messageActive(m, now)) sub.appendChild(el('span', 'badge now', 'Showing now'));
      span.appendChild(sub);
      li.appendChild(span);
      var actions = el('div', 'row-actions');
      actions.appendChild(button('Edit', '', function () { editMsg(m); }));
      actions.appendChild(button(m.enabled === false ? 'Switch on' : 'Switch off', '', function () { toggleMsg(m); }));
      actions.appendChild(button('Delete', 'danger', function () { deleteMsg(m); }));
      li.appendChild(actions);
      ul.appendChild(li);
    });
  }
  setInterval(renderMessages, 60000);

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
  buildDayChecks();
  resetMsgForm();
  fetch('/api/me', { credentials: 'same-origin' }).then(function (r) {
    if (!r.ok) throw new Error();
    return r.json();
  }).then(function (d) { state.me = d.username; showMain(); }).catch(showLogin);
})();
