export function Modal({ title, children, onClose }) {
  return <div className="fixed inset-0 z-20 grid place-items-end bg-[#20313d]/30 p-0 sm:place-items-center sm:p-4"><section className="w-full max-w-lg rounded-t-3xl bg-[#fbfaf7] p-5 shadow-2xl sm:rounded-3xl"><div className="mb-5 flex items-center justify-between"><h2 className="font-['Space_Grotesk'] text-xl font-bold">{title}</h2><button className="text-2xl text-[#718087]" onClick={onClose} aria-label="ปิด">×</button></div>{children}</section></div>
}
