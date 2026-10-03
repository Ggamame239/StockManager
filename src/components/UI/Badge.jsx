import { statusClass, statusLabel } from '../../utils/format'

export function Badge({ status, children }) {
    const value = status ?? children
    return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${statusClass(value)}`}>{statusLabel(value)}</span>
}
