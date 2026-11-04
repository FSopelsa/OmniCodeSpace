const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']

function parts(rule: string) {
  const p: Record<string, string> = Object.fromEntries(rule.replace(/^RRULE:/, '').split(';').map((kv) => kv.split('=')))
  const nums = (key: string, all: number[]): number[] => (p[key] ? p[key].split(',').map(Number) : all)
  const hours = Array.from({ length: 24 }, (_, h) => h)
  return {
    freq: p.FREQ,
    days: p.BYDAY ? p.BYDAY.split(',').map((d) => DAYS.indexOf(d.slice(-2))) : undefined,
    hours: nums('BYHOUR', p.FREQ === 'HOURLY' ? hours : [0]),
    minutes: nums('BYMINUTE', [0]),
  }
}

// shortcut: reads FREQ, BYDAY, BYHOUR and BYMINUTE in local time only. INTERVAL, COUNT, UNTIL and monthly rules are ignored, add them when a schedule uses them.
export function timesOn(rule: string, day: Date) {
  const { freq, days, hours, minutes } = parts(rule)
  if (!['HOURLY', 'DAILY', 'WEEKLY'].includes(freq) || (days ? !days.includes(day.getDay()) : freq === 'WEEKLY')) return []
  return hours.flatMap((h) => minutes.map((m) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m))).sort((a, b) => +a - +b)
}

export function nextTime(rule: string, from: Date) {
  for (let i = 0; i < 8; i++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i)
    const next = timesOn(rule, day).find((t) => t > from)
    if (next) return next
  }
}

export function describe(rule: string) {
  const { freq, days, hours, minutes } = parts(rule)
  const at = hours.length * minutes.length <= 3 ? ` at ${hours.flatMap((h) => minutes.map((m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)).join(', ')}` : ''
  if (freq === 'HOURLY') return `Every hour${minutes[0] ? ` at :${String(minutes[0]).padStart(2, '0')}` : ''}`
  if (days) return `${days.map((d) => NAMES[d]).join(', ')}${at}`
  if (freq === 'DAILY') return `Every day${at}`
  return rule
}
