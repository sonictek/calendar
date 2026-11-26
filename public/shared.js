/* Shared date + repeat logic, used by the display, the admin panel and the server. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DiaryShared = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function pad(n) { return String(n).padStart(2, '0'); }

  function toDateStr(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function parseDate(s) {
    var p = s.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  function daysBetween(a, b) {
    var ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    var ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((ub - ua) / 86400000);
  }

  function occursOn(ev, dateStr) {
    if (ev.skipDates && ev.skipDates.indexOf(dateStr) !== -1) return false;
    if (ev.date === dateStr) return true;
    var repeat = ev.repeat || 'none';
    if (repeat === 'none') return false;
    if (dateStr < ev.date) return false;
    if (ev.repeatUntil && dateStr > ev.repeatUntil) return false;
    var start = parseDate(ev.date);
    var day = parseDate(dateStr);
    var diff = daysBetween(start, day);
    switch (repeat) {
      case 'daily': return true;
      case 'weekdays': return day.getDay() >= 1 && day.getDay() <= 5;
      case 'weekly': return diff % 7 === 0;
      case 'fortnightly': return diff % 14 === 0;
      case 'monthly': return day.getDate() === start.getDate();
      case 'yearly': return day.getDate() === start.getDate() && day.getMonth() === start.getMonth();
      default: return false;
    }
  }

  function timeToMinutes(t) {
    if (!t) return null;
    var p = t.split(':').map(Number);
    return p[0] * 60 + p[1];
  }

  /* All entries happening on a given day, all-day ones first, then by time. */
  function entriesForDate(events, dateStr) {
    return events
      .filter(function (ev) { return occursOn(ev, dateStr); })
      .sort(function (a, b) {
        var ta = a.time || '', tb = b.time || '';
        if (ta !== tb) return ta < tb ? -1 : 1;
        return a.title.localeCompare(b.title);
      });
  }

  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function formatTime(t, use24) {
    if (!t) return '';
    var p = t.split(':').map(Number);
    if (use24) return pad(p[0]) + ':' + pad(p[1]);
    var h = p[0] % 12 || 12;
    return h + ':' + pad(p[1]) + (p[0] < 12 ? ' am' : ' pm');
  }

  function describeRepeat(ev) {
    var start = parseDate(ev.date);
    var r = ev.repeat || 'none';
    var text;
    switch (r) {
      case 'daily': text = 'Every day'; break;
      case 'weekdays': text = 'Every weekday (Mon–Fri)'; break;
      case 'weekly': text = 'Every ' + WEEKDAYS[start.getDay()]; break;
      case 'fortnightly': text = 'Every other ' + WEEKDAYS[start.getDay()]; break;
      case 'monthly': text = 'Monthly on the ' + ordinal(start.getDate()); break;
      case 'yearly': text = 'Every year on ' + ordinal(start.getDate()) + ' ' + MONTHS[start.getMonth()]; break;
      default: return '';
    }
    text += ', from ' + start.getDate() + ' ' + MONTHS[start.getMonth()].slice(0, 3) + ' ' + start.getFullYear();
    if (ev.repeatUntil) {
      var u = parseDate(ev.repeatUntil);
      text += ' until ' + u.getDate() + ' ' + MONTHS[u.getMonth()].slice(0, 3) + ' ' + u.getFullYear();
    }
    return text;
  }

  /* Is a home-screen message due right now? days: 0 = Sunday … 6 = Saturday.
     No times = all day. If "end" is earlier than "start" (e.g. 21:00 → 07:00)
     it runs overnight, into the morning after each chosen day. */
  function messageActive(msg, now) {
    if (msg.enabled === false || !msg.days) return false;
    var today = now.getDay();
    if (!msg.start || !msg.end) return msg.days.indexOf(today) !== -1;
    var m = now.getHours() * 60 + now.getMinutes();
    var s = timeToMinutes(msg.start), e = timeToMinutes(msg.end);
    if (s < e) return msg.days.indexOf(today) !== -1 && m >= s && m < e;
    var yesterday = (today + 6) % 7;
    return (msg.days.indexOf(today) !== -1 && m >= s) || (msg.days.indexOf(yesterday) !== -1 && m < e);
  }

  function describeDays(days) {
    var d = (days || []).slice().sort();
    var key = d.join(',');
    if (key === '0,1,2,3,4,5,6') return 'Every day';
    if (key === '1,2,3,4,5') return 'Weekdays';
    if (key === '0,6') return 'Weekends';
    if (!d.length) return 'No days';
    // list Monday first
    return d.slice().sort(function (a, b) { return ((a + 6) % 7) - ((b + 6) % 7); })
      .map(function (x) { return WEEKDAYS[x].slice(0, 3); }).join(', ');
  }

  function describeMessageSchedule(msg, use24) {
    var text = describeDays(msg.days);
    if (msg.start && msg.end) {
      text += ', ' + formatTime(msg.start, use24) + ' – ' + formatTime(msg.end, use24);
      if (msg.end < msg.start) text += ' (overnight)';
    } else {
      text += ', all day';
    }
    return text;
  }

  /* ---------- formatted (HTML) messages ----------
     Messages may contain simple formatting. Before anything is shown, the HTML
     is rebuilt from an allow-list: only formatting tags and a few safe style
     properties survive. Scripts, links, images, forms, event handlers etc. are
     removed. Browser only (uses DOMParser). */
  var ALLOWED_TAGS = {
    B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, STRIKE: 1, BR: 1, P: 1, DIV: 1, SPAN: 1, FONT: 1,
    UL: 1, OL: 1, LI: 1, H1: 1, H2: 1, H3: 1, SMALL: 1, BIG: 1, MARK: 1, HR: 1, SUB: 1, SUP: 1, BLOCKQUOTE: 1
  };
  // Dropped completely, including their contents.
  var DROP_TAGS = /^(SCRIPT|STYLE|IFRAME|FRAME|OBJECT|EMBED|TEMPLATE|NOSCRIPT|TITLE|HEAD|META|LINK|SVG|MATH|FORM|INPUT|BUTTON|SELECT|TEXTAREA|IMG|VIDEO|AUDIO|CANVAS|PICTURE|SOURCE|XML)$/;
  var STYLE_PROPS = ['color', 'background-color', 'font-size', 'font-weight', 'font-style',
    'text-decoration', 'text-decoration-line', 'text-align'];
  var FONT_SIZES = { 1: '0.7em', 2: '0.85em', 3: '1em', 4: '1.2em', 5: '1.5em', 6: '2em', 7: '2.6em' };

  /* Text sizes are made relative to the message's own size, so "Large" is
     always bigger than normal text whatever size the screen uses. */
  var KEYWORD_SIZES = {
    'xx-small': 0.6, 'x-small': 0.7, small: 0.85, medium: 1, large: 1.2, 'x-large': 1.5,
    'xx-large': 2, 'xxx-large': 2.6, smaller: 0.85, larger: 1.2
  };
  function relativeFontSize(v) {
    var em;
    if (KEYWORD_SIZES[v]) em = KEYWORD_SIZES[v];
    else {
      var m = /^(\d{1,3}(?:\.\d+)?)(px|em|rem|%|pt)$/.exec(v);
      if (!m) return null;
      var n = parseFloat(m[1]);
      em = m[2] === 'px' ? n / 16 : m[2] === 'pt' ? n / 12 : m[2] === '%' ? n / 100 : n;
    }
    em = Math.min(3, Math.max(0.5, em)); // keep it readable and on the screen
    return (Math.round(em * 100) / 100) + 'em';
  }

  function safeStyleValue(prop, v) {
    v = String(v || '').trim().toLowerCase();
    if (!v || v.length > 60 || /url\(|expression|javascript:|[<>{}\;@]/.test(v)) return null;
    if (prop === 'text-align') return /^(left|right|center|justify|start|end)$/.test(v) ? v : null;
    if (prop === 'font-size') return relativeFontSize(v);
    if (prop === 'color' || prop === 'background-color') {
      return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/.test(v) ? v : null;
    }
    return /^[a-z0-9 -]+$/.test(v) ? v : null;
  }

  function parseStyle(str) {
    var out = [];
    String(str || '').split(';').forEach(function (part) {
      var i = part.indexOf(':');
      if (i < 1) return;
      var prop = part.slice(0, i).trim().toLowerCase();
      if (STYLE_PROPS.indexOf(prop) === -1) return;
      var val = safeStyleValue(prop, part.slice(i + 1).replace(/!important/i, ''));
      if (val) out.push([prop, val]);
    });
    return out;
  }

  /* Returns a DocumentFragment containing only safe, formatting-only nodes. */
  function sanitizeHtml(html) {
    var doc = new DOMParser().parseFromString('<!doctype html><body>' + String(html || ''), 'text/html');
    var frag = document.createDocumentFragment();
    function walk(src, dest, depth) {
      if (depth > 30) return;
      for (var n = src.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) { dest.appendChild(document.createTextNode(n.nodeValue)); continue; }
        if (n.nodeType !== 1) continue;            // comments etc.
        var tag = n.tagName.toUpperCase();
        if (DROP_TAGS.test(tag)) continue;
        if (!ALLOWED_TAGS[tag]) { walk(n, dest, depth + 1); continue; } // unknown tag: keep its text
        var el = document.createElement(tag === 'FONT' ? 'span' : tag.toLowerCase());
        parseStyle(n.getAttribute('style')).forEach(function (p) { el.style.setProperty(p[0], p[1]); });
        if (tag === 'FONT') {
          var c = safeStyleValue('color', n.getAttribute('color'));
          if (c) el.style.color = c;
          var sz = FONT_SIZES[String(n.getAttribute('size') || '').trim()];
          if (sz) el.style.fontSize = sz;
        }
        var align = safeStyleValue('text-align', n.getAttribute('align'));
        if (align) el.style.textAlign = align;
        walk(n, el, depth + 1);
        dest.appendChild(el);
      }
    }
    walk(doc.body, frag, 0);
    return frag;
  }

  function sanitizeToHtml(html) {
    var div = document.createElement('div');
    div.appendChild(sanitizeHtml(html));
    return div.innerHTML;
  }

  function textToHtml(text) {
    return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/\r?\n/g, '<br>');
  }

  /* Plain-text version of (already sanitized) HTML, for summaries. */
  function htmlToText(html) {
    var div = document.createElement('div');
    div.appendChild(sanitizeHtml(String(html || '').replace(/<(br|\/p|\/div|\/li|\/h[1-3])\b[^>]*>/gi, ' $&')));
    return div.textContent.replace(/\s+/g, ' ').trim();
  }

  /* Message priority: 1 = highest (shown first) … 5 = lowest. Older messages have none = Normal. */
  var PRIORITY_NAMES = { 1: 'Highest', 2: 'High', 3: 'Normal', 4: 'Low', 5: 'Lowest' };
  function messagePriority(m) { return Number(m.priority) || 3; }
  /* Display order: priority, then timed before all-day, then the order they were added. */
  function sortMessages(list) {
    return list.map(function (m, i) { return { m: m, i: i }; }).sort(function (a, b) {
      return (messagePriority(a.m) - messagePriority(b.m)) ||
        ((a.m.start ? 0 : 1) - (b.m.start ? 0 : 1)) || (a.i - b.i);
    }).map(function (x) { return x.m; });
  }

  return {
    PRIORITY_NAMES: PRIORITY_NAMES, messagePriority: messagePriority, sortMessages: sortMessages,
    sanitizeHtml: sanitizeHtml, sanitizeToHtml: sanitizeToHtml, textToHtml: textToHtml, htmlToText: htmlToText,
    messageActive: messageActive, describeDays: describeDays, describeMessageSchedule: describeMessageSchedule,
    pad: pad, toDateStr: toDateStr, parseDate: parseDate, addDays: addDays,
    daysBetween: daysBetween, occursOn: occursOn, entriesForDate: entriesForDate,
    timeToMinutes: timeToMinutes, formatTime: formatTime, ordinal: ordinal,
    describeRepeat: describeRepeat, WEEKDAYS: WEEKDAYS, MONTHS: MONTHS,
    REPEATS: ['none', 'daily', 'weekdays', 'weekly', 'fortnightly', 'monthly', 'yearly']
  };
});
