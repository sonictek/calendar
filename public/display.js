/* Kiosk display logic. */
(function () {
  'use strict';
  var S = window.DiaryShared;
  var KEY_STORE = 'diary.displayKey';
  var CACHE_STORE = 'diary.cache';
  var POLL_MS = 60 * 1000;

  var state = {
    key: null,
    data: null,          // { settings, events, appVersion, dataVersion }
    view: 'home',
    dayDate: null,       // Date shown in day view
    lastOk: null,
    lastRenderedDay: null
  };

  var $ = function (id) { return document.getElementById(id); };

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  /* ---------- display key (from ?key=… once, then remembered) ---------- */
  var params = new URLSearchParams(location.search);
  if (params.get('key')) {
    store(KEY_STORE, params.get('key'));
    history.replaceState(null, '', location.pathname); // keep the key out of the address bar
  }
  state.key = store(KEY_STORE);

  var cached = store(CACHE_STORE);
  if (cached) { try { state.data = JSON.parse(cached); } catch (e) { /* ignore */ } }

  function settings() {
    return (state.data && state.data.settings) || { clock24: false, idleMinutes: 5, calendarWeeks: 4, personName: '', homeMessage: '' };
  }
  function events() { return (state.data && state.data.events) || []; }

  /* ---------- data loading ---------- */
  function fetchData() {
    if (!state.key) { showSetup(); return; }
    var xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/display?t=' + Date.now());
    xhr.setRequestHeader('X-Display-Key', state.key);
    xhr.timeout = 15000;
    xhr.onload = function () {
      if (xhr.status === 403) { showSetup(); return; }
      if (xhr.status !== 200) { updateStatus(); return; }
      var d;
      try { d = JSON.parse(xhr.responseText); } catch (e) { return; }
      var prev = state.data;
      // New version of the app deployed? Reload once to pick it up.
      if (prev && prev.appVersion && d.appVersion !== prev.appVersion && state.view === 'home') {
        store(CACHE_STORE, JSON.stringify(d));
        location.reload();
        return;
      }
      state.data = d;
      state.lastOk = new Date();
      store(CACHE_STORE, JSON.stringify(d));
      if (state.view === 'setup') state.view = 'home';
      if (!prev || prev.dataVersion !== d.dataVersion) render();
      updateStatus();
    };
    xhr.onerror = xhr.ontimeout = updateStatus;
    xhr.send();
  }

  function updateStatus() {
    // Small, unobtrusive text for carers – not meant to worry the reader.
    var t = state.lastOk;
    $('status').textContent = t
      ? 'updated ' + S.formatTime(S.pad(t.getHours()) + ':' + S.pad(t.getMinutes()), true)
      : (state.data ? 'offline – showing saved diary' : 'connecting…');
  }

  /* ---------- helpers ---------- */
  function today() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }

  function longDate(d) { return S.ordinal(d.getDate()) + ' ' + S.MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }

  function dayPart(h) {
    if (h >= 5 && h < 12) return { text: 'It is morning', icon: '🌅', greet: 'Good morning' };
    if (h >= 12 && h < 17) return { text: 'It is afternoon', icon: '☀️', greet: 'Good afternoon' };
    if (h >= 17 && h < 21) return { text: 'It is evening', icon: '🌇', greet: 'Good evening' };
    return { text: 'It is night time', icon: '🌙', greet: 'Good evening' };
  }

  function relativeDay(d) {
    var n = S.daysBetween(today(), d);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n === -1) return 'Yesterday';
    if (n < 0) return (-n) + ' days ago';
    if (n < 7) return 'In ' + n + ' days';
    var w = Math.floor(n / 7), r = n % 7;
    return 'In ' + n + ' days' + (r === 0 ? ' (' + w + (w === 1 ? ' week' : ' weeks') + ')' : '');
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* Build the list of entries for a day. If isToday, mark past / now / next. */
  function renderEntries(listEl, dateStr, isToday, emptyText) {
    var items = S.entriesForDate(events(), dateStr);
    var use24 = settings().clock24;
    listEl.textContent = '';
    if (!items.length) {
      listEl.appendChild(el('li', 'empty', emptyText));
      return;
    }
    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var nextMarked = false;
    var firstActive = null;

    items.forEach(function (ev) {
      var li = el('li', 'entry');
      if (ev.important) li.classList.add('important');

      var timeBox = el('div', 'e-time');
      if (ev.time) {
        timeBox.textContent = S.formatTime(ev.time, use24);
        if (ev.endTime) timeBox.appendChild(el('small', null, 'until ' + S.formatTime(ev.endTime, use24)));
      } else {
        timeBox.textContent = 'All day';
      }
      li.appendChild(timeBox);
      li.appendChild(el('div', 'e-icon', ev.icon || '📌'));
      var body = el('div', 'e-body');
      body.appendChild(el('div', 'e-title', ev.title));
      if (ev.notes) body.appendChild(el('div', 'e-notes', ev.notes));
      li.appendChild(body);

      if (isToday && ev.time) {
        var start = S.timeToMinutes(ev.time);
        var end = ev.endTime ? S.timeToMinutes(ev.endTime) : start + 60;
        if (nowMin >= end) {
          li.classList.add('is-past');
          li.appendChild(el('span', 'e-tag', 'Earlier'));
        } else if (nowMin >= start) {
          li.classList.add('is-now');
          li.appendChild(el('span', 'e-tag', 'Now'));
          if (!firstActive) firstActive = li;
        } else if (!nextMarked) {
          nextMarked = true;
          li.classList.add('is-next');
          li.appendChild(el('span', 'e-tag', 'Next'));
          if (!firstActive) firstActive = li;
        }
      }
      listEl.appendChild(li);
    });

    // Start at the top; only scroll if the current / next thing would be out of sight.
    listEl.scrollTop = 0;
    if (firstActive && isToday) {
      setTimeout(function () {
        var bottom = firstActive.offsetTop - listEl.offsetTop + firstActive.offsetHeight;
        if (bottom > listEl.clientHeight) listEl.scrollTop = bottom - listEl.clientHeight + 8;
      }, 0);
    }
  }

  /* ---------- views ---------- */
  function show(view) {
    state.view = view;
    ['home', 'calendar', 'day', 'setup'].forEach(function (v) {
      $('view-' + v).classList.toggle('hidden', v !== view);
    });
    render();
  }

  function showSetup() {
    if (!state.data) show('setup');
  }

  function renderClock() {
    var now = new Date();
    var s = settings();
    var dp = dayPart(now.getHours());
    $('greeting').textContent = dp.greet + (s.personName ? ', ' + s.personName : '');
    $('weekday').textContent = S.WEEKDAYS[now.getDay()];
    $('fulldate').textContent = longDate(now);
    $('clock').textContent = S.formatTime(S.pad(now.getHours()) + ':' + S.pad(now.getMinutes()), s.clock24);
    $('daypart-icon').textContent = dp.icon;
    $('daypart-text').textContent = dp.text;
  }

  function renderHome() {
    renderClock();
    var s = settings();
    var msg = $('message');
    msg.textContent = s.homeMessage || '';
    msg.classList.toggle('hidden', !s.homeMessage);

    var t = today();
    renderEntries($('today-list'), S.toDateStr(t), true, 'Nothing planned today. A quiet day.');

    var tomorrow = S.entriesForDate(events(), S.toDateStr(S.addDays(t, 1)));
    var tm = $('tomorrow');
    tm.textContent = '';
    if (tomorrow.length) {
      tm.appendChild(document.createTextNode('Tomorrow (' + S.WEEKDAYS[S.addDays(t, 1).getDay()] + '): '));
      tm.appendChild(el('b', null, tomorrow.slice(0, 3).map(function (e) { return (e.icon ? e.icon + ' ' : '') + e.title; }).join(', ')
        + (tomorrow.length > 3 ? ' and ' + (tomorrow.length - 3) + ' more' : '')));
    } else {
      tm.textContent = 'Tomorrow (' + S.WEEKDAYS[S.addDays(t, 1).getDay()] + '): nothing planned.';
    }
    $('btn-calendar-label').textContent = 'See the next ' + s.calendarWeeks + ' weeks';
    state.lastRenderedDay = S.toDateStr(t);
  }

  function renderCalendar() {
    var s = settings();
    var t = today();
    var weeks = s.calendarWeeks || 4;
    $('cal-title').textContent = 'The next ' + weeks + ' weeks';

    // Start on the Monday of this week; show enough rows to cover `weeks` weeks ahead.
    var offset = (t.getDay() + 6) % 7;
    var start = S.addDays(t, -offset);
    var rows = Math.ceil((offset + weeks * 7) / 7);

    var head = $('cal-head');
    head.textContent = '';
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function (n, i) {
      head.appendChild(el('div', i >= 5 ? 'weekend' : '', n));
    });

    var grid = $('cal-grid');
    grid.textContent = '';
    grid.style.gridTemplateRows = 'repeat(' + rows + ', 1fr)';
    for (var i = 0; i < rows * 7; i++) {
      var d = S.addDays(start, i);
      var ds = S.toDateStr(d);
      var diff = S.daysBetween(t, d);
      var items = S.entriesForDate(events(), ds);
      // Everyday routines (daily / weekday repeats) don't light up the calendar,
      // otherwise every day would look the same. They still show on the day screen.
      var special = items.filter(function (e) { return e.repeat !== 'daily' && e.repeat !== 'weekdays'; });
      var cell = el('button', 'cell');
      cell.type = 'button';
      var top = el('div', 'c-top');
      top.appendChild(el('span', 'c-num', String(d.getDate())));
      if (d.getDate() === 1 || i === 0) top.appendChild(el('span', 'c-month', S.MONTHS[d.getMonth()].slice(0, 3)));
      if (diff === 0) top.appendChild(el('span', 'c-today', 'TODAY'));
      else if (diff > 0 && special.length) {
        top.appendChild(el('span', 'c-icons', special.slice(0, 2).map(function (e) { return e.icon || '📌'; }).join('')));
      }
      cell.appendChild(top);

      if (diff < 0) {
        cell.classList.add('past');
        cell.disabled = true;
      } else {
        if (diff === 0) cell.classList.add('today');
        if (special.length) {
          cell.classList.add('has');
          cell.appendChild(el('div', 'c-first', special[0].title + (special.length > 1 ? ' (+' + (special.length - 1) + ' more)' : '')));
        }
        cell.setAttribute('aria-label', S.WEEKDAYS[d.getDay()] + ' ' + longDate(d) + ', ' + items.length + ' things');
        cell.addEventListener('click', openDay.bind(null, d));
      }
      grid.appendChild(cell);
    }
  }

  function openDay(d) {
    state.dayDate = d;
    show('day');
  }

  function renderDay() {
    var d = state.dayDate || today();
    var isToday = S.daysBetween(today(), d) === 0;
    $('day-title').textContent = S.WEEKDAYS[d.getDay()] + ' ' + S.ordinal(d.getDate()) + ' ' + S.MONTHS[d.getMonth()];
    $('day-rel').textContent = relativeDay(d);
    renderEntries($('day-list'), S.toDateStr(d), isToday, 'Nothing planned for this day.');
    var diff = S.daysBetween(today(), d);
    $('btn-prev-day').disabled = diff <= 0;
    $('btn-next-day').disabled = diff >= (settings().calendarWeeks || 4) * 7 + 6;
  }

  function render() {
    if (state.view === 'home') renderHome();
    else if (state.view === 'calendar') renderCalendar();
    else if (state.view === 'day') renderDay();
  }

  /* ---------- buttons ---------- */
  $('btn-calendar').addEventListener('click', function () { show('calendar'); });
  $('btn-back').addEventListener('click', function () { show('calendar'); });
  $('btn-prev-day').addEventListener('click', function () { openDay(S.addDays(state.dayDate, -1)); });
  $('btn-next-day').addEventListener('click', function () { openDay(S.addDays(state.dayDate, 1)); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-go-home]'), function (b) {
    b.addEventListener('click', function () { show('home'); });
  });

  /* ---------- go back to today after inactivity ---------- */
  var idleTimer = null;
  function resetIdle() {
    clearTimeout(idleTimer);
    var mins = settings().idleMinutes || 5;
    idleTimer = setTimeout(function () {
      if (state.view !== 'home' && state.view !== 'setup') show('home');
      else if (state.view === 'home') renderHome(); // re-scrolls today's list to "now"
    }, mins * 60 * 1000);
  }
  ['pointerdown', 'touchstart', 'mousedown', 'keydown', 'wheel', 'scroll'].forEach(function (evt) {
    document.addEventListener(evt, resetIdle, { passive: true, capture: true });
  });

  // No long-press menus or accidental zooming on the kiosk.
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });

  /* ---------- keep the screen awake (where supported) ---------- */
  var wakeLock = null;
  function requestWakeLock() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () { /* ignore */ });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { requestWakeLock(); fetchData(); render(); }
  });

  /* ---------- ticking ---------- */
  setInterval(function () {
    if (state.view === 'home') {
      // Re-render whole home each minute so "Now / Next / Earlier" stay right,
      // and so the day rolls over at midnight.
      var now = new Date();
      if (now.getSeconds() < 5 || state.lastRenderedDay !== S.toDateStr(today())) renderHome();
      else renderClock();
    } else if (state.view === 'calendar' && state.lastRenderedDay !== S.toDateStr(today())) {
      show('home');
    }
  }, 5000);
  setInterval(fetchData, POLL_MS);

  /* ---------- start ---------- */
  if (!state.key) show('setup');
  else show('home');
  fetchData();
  updateStatus();
  requestWakeLock();
  resetIdle();
})();
