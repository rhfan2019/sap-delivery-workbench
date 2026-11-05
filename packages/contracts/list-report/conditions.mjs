// Filter conditions of a list report (docs/modules/list-report.md 3): the shape of ABAP
// SELECT-OPTIONS. A field holds ranges; a value passes when it meets any including range (or there
// is none) and no excluding one. Pure functions, usable in the browser and on the server.

export const CONDITION_OPTIONS = ['EQ', 'CP', 'BT', 'EMPTY', 'PRESET'];

export const DATE_PRESETS = {
  today: '今天',
  this_week: '本周',
  this_month: '本月',
  next_7: '未来 7 天',
  next_30: '未来 30 天',
  past: '已过去',
};

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (text) => new Date(`${text}T00:00:00Z`);
const plus = (date, days) => new Date(date.getTime() + days * 86400000);

// The dates a preset covers on `today`; an open end is ''. Weeks start on Monday.
export function presetRange(preset, today) {
  const now = utc(today);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'this_week': {
      const monday = plus(now, -((now.getUTCDay() + 6) % 7));
      return { from: iso(monday), to: iso(plus(monday, 6)) };
    }
    case 'this_month':
      return {
        from: `${today.slice(0, 7)}-01`,
        to: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))),
      };
    case 'next_7':
      return { from: today, to: iso(plus(now, 6)) };
    case 'next_30':
      return { from: today, to: iso(plus(now, 29)) };
    case 'past':
      return { from: '', to: iso(plus(now, -1)) };
    default:
      return null;
  }
}

const present = (value) => value !== null && value !== undefined && value !== '';
const list = (value) => (Array.isArray(value) ? value : [value]).filter(present);

function between(value, low, high) {
  if (typeof value === 'number') {
    if (present(low) && value < Number(low)) return false;
    if (present(high) && value > Number(high)) return false;
    return true;
  }
  const text = String(value);
  if (present(low) && text < String(low)) return false;
  if (present(high) && text > String(high)) return false;
  return true;
}

function meets(values, range, today) {
  if (range.option === 'EMPTY') return values.length === 0;
  if (!values.length) return false;
  return values.some((value) => {
    switch (range.option) {
      case 'EQ':
        return String(value) === String(range.low);
      case 'CP':
        return String(value)
          .toLowerCase()
          .includes(String(range.low ?? '').toLowerCase());
      case 'BT':
        return between(value, range.low, range.high);
      case 'PRESET': {
        const dates = presetRange(range.low, today);
        return !!dates && between(value, dates.from, dates.to);
      }
      default:
        return false;
    }
  });
}

// `value` is the field's value on one row, a list for multi-valued fields.
export function matchesRanges(value, ranges, today) {
  if (!ranges?.length) return true;
  const values = list(value);
  const including = ranges.filter((r) => r.sign !== 'E');
  if (including.length && !including.some((r) => meets(values, r, today))) return false;
  return !ranges.some((r) => r.sign === 'E' && meets(values, r, today));
}
