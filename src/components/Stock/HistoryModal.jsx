import { Modal } from '../UI/Modal'

export function HistoryModal({ logs, onClose }) {
  return <Modal title="ประวัติการเคลื่อนไหว" onClose={onClose}><div className="grid gap-3">{logs.length ? logs.map((log, index) => <div className="flex justify-between border-b border-[#e5dfd4] pb-3 text-sm" key={index}><span>{log.type} · {log.reason || '-'}</span><strong>{log.change > 0 ? '+' : ''}{log.change}</strong></div>) : <p className="text-[#718087]">ยังไม่มีประวัติ</p>}</div></Modal>
}
