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

  return {
    messageActive: messageActive, describeDays: describeDays, describeMessageSchedule: describeMessageSchedule,
    pad: pad, toDateStr: toDateStr, parseDate: parseDate, addDays: addDays,
    daysBetween: daysBetween, occursOn: occursOn, entriesForDate: entriesForDate,
    timeToMinutes: timeToMinutes, formatTime: formatTime, ordinal: ordinal,
    describeRepeat: describeRepeat, WEEKDAYS: WEEKDAYS, MONTHS: MONTHS,
    REPEATS: ['none', 'daily', 'weekdays', 'weekly', 'fortnightly', 'monthly', 'yearly']
  };
});
