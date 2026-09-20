export function formatNumber(value) {
  return new Intl.NumberFormat('th-TH').format(Number(value) || 0)
}

export function statusLabel(status) {
  return { ok: 'ปกติ', low: 'ใกล้หมด', out: 'หมดสต็อค' }[status] || status
}

export function statusClass(status) {
  return {
    ok: 'bg-emerald-100 text-emerald-800',
    low: 'bg-amber-100 text-amber-800',
    out: 'bg-rose-100 text-rose-800',
  }[status] || 'bg-slate-100 text-slate-700'
}
