export function Input({ label, ...props }) {
    return <label className="grid gap-1.5 text-sm font-semibold text-[#52636b]">{label}<input className="min-h-11 rounded-xl border border-[#d9d2c6] bg-white px-3 outline-none focus:border-[#173f5f] focus:ring-2 focus:ring-[#173f5f]/10" {...props} /></label>
}
