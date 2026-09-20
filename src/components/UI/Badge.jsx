import { statusClass, statusLabel } from '../../utils/format'

export function Badge({ status }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(status)}`}>{statusLabel(status)}</span>
}
