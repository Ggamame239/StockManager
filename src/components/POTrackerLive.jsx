import { useEffect, useMemo, useState } from 'react'
import { Button } from './UI/Button'
import { poApiService } from '../services/poApiService'
import { formatNumber } from '../utils/format'

const emptyRecord = {
    row: '', poNumber: '', customer: '', quotation: '', poDateISO: '', amount: '',
    invoice: '', invDateISO: '', credit: 30, dueDateISO: '', payStatus: 'Unpaid', delivery: '',
}
const emptyRecords = []
const chips = [
    ['all', 'ทั้งหมด', 'bg-slate-900'],
    ['unpaid', 'ค้างรับ', 'bg-amber-500'],
    ['overdue', 'เลยกำหนด', 'bg-rose-600'],
    ['duesoon', 'ใกล้ครบ 7 วัน', 'bg-orange-500'],
    ['paid', 'รับเงินแล้ว', 'bg-emerald-600'],
]

function money(value) {
    return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function dateInputValue(date, credit) {
    if (!date || Number(credit) <= 0) return ''
    const due = new Date(`${date}T00:00:00`)
    due.setDate(due.getDate() + Number(credit))
    due.setMinutes(due.getMinutes() - due.getTimezoneOffset())
    return due.toISOString().slice(0, 10)
}

function Field({ label, value, onChange, type = 'text', required = false, ...props }) {
    return <label className="block text-sm font-semibold text-slate-700">{label}{required && <span className="text-rose-500"> *</span>}<input value={value ?? ''} onChange={(event) => onChange(event.target.value)} type={type} required={required} className="mt-1.5 w-full rounded-xl border-2 border-slate-200 px-3 py-3 outline-none focus:border-slate-800" {...props} /></label>
}

function RecordModal({ record, customers, options, onClose, onSave, onAddCustomer }) {
    const [form, setForm] = useState({ ...emptyRecord, ...record })
    const dueDate = form.dueDateISO || dateInputValue(form.invDateISO, form.credit)
    const set = (key) => (value) => setForm((current) => ({ ...current, [key]: value }))
    function submit(event) {
        event.preventDefault()
        if (!form.customer || !form.quotation || form.amount === '' || Number(form.amount) < 0) return
        onSave({ ...form, amount: Number(form.amount), credit: Number(form.credit) || 0, dueDateISO: dueDate })
    }
    return <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/60 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
        <form onSubmit={submit} onMouseDown={(event) => event.stopPropagation()} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl">
            <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-bold text-slate-900">{record.row ? 'แก้ไข PO' : 'เพิ่ม PO ใหม่'}</h2><button type="button" onClick={onClose} className="text-3xl leading-none text-slate-500" aria-label="ปิด">×</button></div>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="PO Number" value={form.poNumber} onChange={set('poNumber')} />
                <label className="block text-sm font-semibold text-slate-700">ชื่อลูกค้า<span className="text-rose-500"> *</span><span className="mt-1.5 flex gap-2"><select value={form.customer} onChange={(event) => set('customer')(event.target.value)} required className="min-w-0 flex-1 rounded-xl border-2 border-slate-200 bg-white px-3 py-3"><option value="">เลือกลูกค้า</option>{customers.map((customer) => <option key={customer} value={customer}>{customer}</option>)}</select><button type="button" onClick={onAddCustomer} className="shrink-0 rounded-xl bg-slate-100 px-3 font-bold text-slate-700" aria-label="เพิ่มลูกค้า">+</button></span></label>
                <Field label="เลขใบเสนอราคา" value={form.quotation} onChange={set('quotation')} required />
                <Field label="วันที่รับ PO" type="date" value={form.poDateISO} onChange={set('poDateISO')} />
                <Field label="ยอดเงิน (บาท)" type="number" min="0" step="0.01" value={form.amount} onChange={set('amount')} required />
                <Field label="เลขอินวอย" value={form.invoice} onChange={set('invoice')} />
                <Field label="วางบิลวันที่" type="date" value={form.invDateISO} onChange={(value) => setForm((current) => ({ ...current, invDateISO: value, dueDateISO: '' }))} />
                <Field label="เครดิต (วัน)" type="number" min="0" value={form.credit} onChange={(value) => setForm((current) => ({ ...current, credit: value, dueDateISO: '' }))} />
                <Field label="ครบกำหนดรับเงิน" type="date" value={dueDate} onChange={set('dueDateISO')} />
                <label className="block text-sm font-semibold text-slate-700">สถานะรับเงิน<select value={form.payStatus} onChange={(event) => set('payStatus')(event.target.value)} className="mt-1.5 w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-3">{options.payStatus.map((status) => <option key={status}>{status}</option>)}</select></label>
                <label className="block text-sm font-semibold text-slate-700">สถานะส่งของ<select value={form.delivery} onChange={(event) => set('delivery')(event.target.value)} className="mt-1.5 w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-3"><option value=""></option>{options.delivery.map((status) => <option key={status}>{status}</option>)}</select></label>
            </div>
            <div className="mt-6 flex gap-3"><Button type="button" variant="secondary" className="w-1/3" onClick={onClose}>ยกเลิก</Button><Button type="submit" className="w-2/3">บันทึกข้อมูล</Button></div>
        </form>
    </div>
}

function CustomerModal({ onClose, onSave }) {
    const [name, setName] = useState('')
    return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
        <form onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSave(name.trim()) }} onMouseDown={(event) => event.stopPropagation()} className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between"><h2 className="font-bold text-slate-900">เพิ่มรายชื่อลูกค้า</h2><button type="button" onClick={onClose} className="text-2xl text-slate-500" aria-label="ปิด">×</button></div>
            <Field label="ชื่อบริษัทลูกค้า" value={name} onChange={setName} required autoFocus placeholder="ชื่อบริษัท" />
            <div className="mt-5 flex gap-3"><Button type="button" variant="secondary" className="w-1/3" onClick={onClose}>ยกเลิก</Button><Button type="submit" className="w-2/3">บันทึก</Button></div>
        </form>
    </div>
}

function dueCell(record) {
    if (!record.dueDate) return <span className="text-slate-300">-</span>
    if (record.paid || record.daysLeft == null) return <span className="text-xs text-slate-500">{record.dueDate}</span>
    if (record.daysLeft < 0) return <span className="text-xs font-bold text-rose-600">{record.dueDate}<br /><span className="text-[10px]">เลย {Math.abs(record.daysLeft)} วัน</span></span>
    if (record.daysLeft <= 7) return <span className="text-xs font-bold text-amber-600">{record.dueDate}<br /><span className="text-[10px]">อีก {record.daysLeft} วัน</span></span>
    return <span className="text-xs text-slate-600">{record.dueDate}<br /><span className="text-[10px] text-slate-400">อีก {record.daysLeft} วัน</span></span>
}

function PayBadge({ record }) {
    const color = record.paid ? 'bg-emerald-100 text-emerald-700' : record.state === 'overdue' ? 'bg-rose-600 text-white' : 'bg-amber-100 text-amber-700'
    const text = record.paid ? `✓ ${record.payStatus}` : record.state === 'overdue' ? 'เลยกำหนด' : record.payStatus || 'Unpaid'
    return <span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold ${color}`}>{text}</span>
}

function DeliveryBadge({ record }) {
    if (!record.delivery) return <span className="text-slate-300">-</span>
    return <span className={`whitespace-nowrap rounded px-2 py-1 text-xs font-semibold ${record.delivered ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600'}`}>{record.delivery}</span>
}

export function POTracker() {
    const [data, setData] = useState({ records: [], customers: [], summary: {}, options: { payStatus: ['Unpaid', 'Paid'], delivery: [] } })
    const [query, setQuery] = useState('')
    const [customer, setCustomer] = useState('')
    const [sort, setSort] = useState('due')
    const [activeChip, setActiveChip] = useState('all')
    const [selected, setSelected] = useState(null)
    const [customerModal, setCustomerModal] = useState(false)
    const [selectCustomerOnSave, setSelectCustomerOnSave] = useState(false)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [toast, setToast] = useState('')

    async function loadData(showLoading = true) {
        if (showLoading) setLoading(true)
        try {
            const result = await poApiService.list()
            setError('')
            setData((current) => ({ ...current, ...result }))
        }
        catch (loadError) { setError(loadError.message) }
        finally { setLoading(false) }
    }
    useEffect(() => {
        let active = true
        poApiService.list().then((result) => {
            if (!active) return
            setError('')
            setData((current) => ({ ...current, ...result }))
        }).catch((loadError) => {
            if (active) setError(loadError.message)
        }).finally(() => {
            if (active) setLoading(false)
        })
        return () => { active = false }
    }, [])

    const records = data.records ?? emptyRecords
    const filtered = useMemo(() => {
        const text = query.trim().toLowerCase()
        return records.filter((record) => {
            if (customer && record.customer !== customer) return false
            if (activeChip === 'paid' && !record.paid) return false
            if (activeChip === 'unpaid' && record.paid) return false
            if (activeChip === 'overdue' && record.state !== 'overdue') return false
            if (activeChip === 'duesoon' && record.state !== 'duesoon') return false
            return !text || `${record.poNumber} ${record.customer} ${record.quotation} ${record.invoice} ${record.payStatus} ${record.delivery}`.toLowerCase().includes(text)
        }).sort((left, right) => {
            if (sort === 'amount') return right.amount - left.amount
            if (sort === 'podate') return (right.poDateISO || '').localeCompare(left.poDateISO || '')
            if (sort === 'row') return left.row - right.row
            if (left.paid !== right.paid) return left.paid ? 1 : -1
            return (left.dueDateISO || '9999').localeCompare(right.dueDateISO || '9999')
        })
    }, [records, query, customer, activeChip, sort])

    async function saveRecord(record) {
        setSaving(true)
        try {
            const result = await poApiService.save(record)
            setSelected(null)
            setToast(result.message || 'บันทึก PO เรียบร้อย')
            await loadData()
        } catch (saveError) { setError(saveError.message) }
        finally { setSaving(false) }
    }

    async function saveCustomer(name) {
        try {
            const result = await poApiService.addCustomer(name)
            setData((current) => ({ ...current, customers: result.customers || [...current.customers, name] }))
            setCustomerModal(false)
            if (selectCustomerOnSave) setSelected((current) => current ? { ...current, customer: name } : current)
            setToast(result.message || 'เพิ่มลูกค้าเรียบร้อย')
        } catch (saveError) { setError(saveError.message) }
    }

    async function togglePaid(record, toPaid) {
        const options = data.options?.payStatus || []
        const status = toPaid
            ? options.find((value) => /paid|รับแล้ว|ชำระแล้ว/i.test(value) && !/unpaid|ยังไม่/i.test(value)) || 'Paid'
            : options.find((value) => /unpaid|ยังไม่/i.test(value)) || 'Unpaid'
        try {
            const result = await poApiService.togglePaid(record.row, status)
            setToast(result.message || 'อัปเดตสถานะแล้ว')
            await loadData()
        } catch (toggleError) { setError(toggleError.message) }
    }

    const summary = data.summary || {}
    const options = data.options || { payStatus: ['Unpaid', 'Paid'], delivery: [] }
    const openCustomerModal = (selectForRecord = false) => { setSelectCustomerOnSave(selectForRecord); setCustomerModal(true) }
    const openRecord = (record = null) => setSelected(record ? { ...record } : { ...emptyRecord })

    return <div className="space-y-4 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">P.tech interprecision</p><h1 className="font-['Space_Grotesk'] text-2xl font-bold text-slate-900 sm:text-3xl">ระบบติดตามใบสั่งซื้อ</h1></div><div className="flex gap-2"><Button variant="secondary" onClick={loadData} disabled={loading} aria-label="รีเฟรชข้อมูล">{loading ? 'กำลังโหลด...' : 'รีเฟรช'}</Button><Button onClick={() => openRecord()}>+ เพิ่ม PO ใหม่</Button></div></div>

        {error && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"><span>{error}</span><button onClick={() => setError('')} className="font-bold" aria-label="ปิดข้อความผิดพลาด">×</button></div>}
        {toast && <div className="flex items-center justify-between rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white"><span>{toast}</span><button onClick={() => setToast('')} aria-label="ปิดข้อความ">×</button></div>}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <SummaryCard label="PO ทั้งหมด" value={formatNumber(summary.total)} color="border-slate-400" />
            <SummaryCard label="ยอดรวมทั้งหมด" value={`฿${money(summary.totalAmount)}`} color="border-indigo-500" />
            <SummaryCard label="รับเงินแล้ว" value={`฿${money(summary.paidAmount)}`} detail={`${summary.paidCount || 0} รายการ`} color="border-emerald-500" />
            <SummaryCard label="ค้างรับ" value={`฿${money(summary.unpaidAmount)}`} detail={`${summary.unpaidCount || 0} รายการ`} color="border-amber-500" />
            <SummaryCard label="เลยกำหนดรับเงิน" value={`${formatNumber(summary.overdueCount)} รายการ`} detail={summary.dueSoonCount ? `ใกล้ครบกำหนด ${summary.dueSoonCount} รายการ` : ''} color="border-rose-500" />
        </section>

        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row"><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหา PO / ลูกค้า / ใบเสนอราคา / อินวอย" className="min-w-0 flex-1 rounded-xl border-2 border-slate-200 px-4 py-3 outline-none focus:border-slate-800" /><Button variant="secondary" onClick={() => openCustomerModal(false)}>เพิ่มลูกค้า</Button></div>
            <div className="flex flex-wrap items-center gap-2">{chips.map(([key, label, color]) => <button key={key} onClick={() => setActiveChip(key)} className={`rounded-xl border-2 px-3 py-2 text-sm font-semibold ${activeChip === key ? `${color} border-transparent text-white` : 'border-slate-200 bg-white text-slate-600'}`}>{label}</button>)}<select value={customer} onChange={(event) => setCustomer(event.target.value)} className="rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="">ลูกค้าทั้งหมด</option>{data.customers.map((name) => <option key={name}>{name}</option>)}</select><select value={sort} onChange={(event) => setSort(event.target.value)} className="rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5 text-sm"><option value="due">เรียงตามวันครบกำหนด</option><option value="podate">เรียงตามวันที่รับ PO</option><option value="amount">เรียงตามยอดเงิน (มากไปน้อย)</option><option value="row">เรียงตามลำดับในชีต</option></select><span className="ml-auto self-center text-sm text-slate-500">แสดง {filtered.length} / {records.length} รายการ</span></div>
        </section>

        {loading ? <div className="rounded-2xl bg-white py-12 text-center text-slate-400">กำลังโหลดข้อมูล...</div> : <>
            <section className="hidden overflow-hidden rounded-2xl bg-white shadow-sm md:block"><div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-sm"><thead className="bg-slate-100 text-xs text-slate-600"><tr>{['PO Number', 'ลูกค้า', 'ใบเสนอราคา', 'วันที่รับ PO', 'ยอดเงิน', 'อินวอย', 'วางบิล', 'เครดิต', 'ครบกำหนด', 'รับเงิน', 'ส่งของ', 'จัดการ'].map((heading) => <th key={heading} className="px-3 py-3 text-left font-semibold">{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{filtered.map((record) => <tr key={record.row} className={`hover:bg-slate-50 ${record.state === 'overdue' ? 'bg-rose-50/60' : record.state === 'duesoon' ? 'bg-amber-50/60' : ''}`}><td className="px-3 py-3 font-bold">{record.poNumber || '-'}</td><td className="max-w-52 truncate px-3 py-3" title={record.customer}>{record.customer || '-'}</td><td className="px-3 py-3">{record.quotation || '-'}</td><td className="px-3 py-3 text-center text-xs">{record.poDate || '-'}</td><td className="px-3 py-3 text-right font-bold">{money(record.amount)}</td><td className="px-3 py-3">{record.invoice || '-'}</td><td className="px-3 py-3 text-center text-xs">{record.invDate || '-'}</td><td className="px-3 py-3 text-center">{record.credit || '-'}</td><td className="px-3 py-3 text-center">{dueCell(record)}</td><td className="px-3 py-3 text-center"><PayBadge record={record} /></td><td className="px-3 py-3 text-center"><DeliveryBadge record={record} /></td><td className="px-3 py-3"><div className="flex justify-center gap-1.5"><button onClick={() => openRecord(record)} className="rounded-lg bg-slate-700 px-3 py-2 text-xs font-bold text-white">แก้ไข</button><button onClick={() => togglePaid(record, !record.paid)} className={`rounded-lg px-3 py-2 text-xs font-bold ${record.paid ? 'bg-slate-200 text-slate-700' : 'bg-emerald-600 text-white'}`}>{record.paid ? '↩ ยกเลิก Paid' : '✓ ติ๊กว่า Paid'}</button></div></td></tr>)}</tbody></table>{!filtered.length && <p className="py-12 text-center text-slate-400">ไม่พบข้อมูลที่ค้นหา</p>}</div></section>
            <section className="space-y-3 md:hidden">{filtered.map((record) => <article key={record.row} className={`rounded-xl border-l-4 bg-white p-4 shadow-sm ${record.state === 'overdue' ? 'border-rose-500' : record.state === 'duesoon' ? 'border-amber-500' : record.paid ? 'border-emerald-500' : 'border-slate-300'}`}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-bold text-slate-800">{record.poNumber || record.quotation || '-'}</p><p className="truncate text-xs text-slate-500">{record.customer || '-'}</p></div><PayBadge record={record} /></div><p className="mt-2 text-right text-2xl font-extrabold text-slate-800">฿{money(record.amount)}</p><div className="mt-2 grid grid-cols-2 gap-2 text-xs"><MobileInfo label="ใบเสนอราคา" value={record.quotation} /><MobileInfo label="อินวอย" value={record.invoice} /><MobileInfo label="วันที่รับ PO" value={record.poDate} /><MobileInfo label="วางบิล" value={record.invDate} /><MobileInfo label="เครดิต" value={record.credit ? `${record.credit} วัน` : '-'} /><div><span className="text-slate-400">ครบกำหนด</span><br />{dueCell(record)}</div></div><div className="mt-2"><DeliveryBadge record={record} /></div><div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => openRecord(record)} className="rounded-xl bg-slate-700 py-3 text-sm font-bold text-white">แก้ไข</button><button onClick={() => togglePaid(record, !record.paid)} className={`rounded-xl py-3 text-sm font-bold ${record.paid ? 'bg-slate-200 text-slate-700' : 'bg-emerald-600 text-white'}`}>{record.paid ? '↩ ยกเลิก Paid' : '✓ ติ๊กว่า Paid'}</button></div></article>)}{!filtered.length && <div className="rounded-xl bg-white p-10 text-center text-slate-400">ไม่พบข้อมูลที่ค้นหา</div>}</section>
        </>}
        {selected && <RecordModal record={selected} customers={data.customers} options={options} onClose={() => setSelected(null)} onSave={saveRecord} onAddCustomer={() => openCustomerModal(true)} />}
        {customerModal && <CustomerModal onClose={() => setCustomerModal(false)} onSave={saveCustomer} />}
        {saving && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20"><span className="rounded-xl bg-white px-5 py-3 font-semibold shadow-lg">กำลังบันทึก...</span></div>}
    </div>
}

function SummaryCard({ label, value, detail, color }) {
    return <div className={`rounded-xl border-l-4 bg-white p-4 shadow-sm ${color}`}><p className="text-xs font-medium text-slate-500">{label}</p><p className="break-words text-lg font-bold text-slate-800 sm:text-xl">{value}</p>{detail && <p className="text-xs text-slate-400">{detail}</p>}</div>
}

function MobileInfo({ label, value }) {
    return <div><span className="text-slate-400">{label}</span><br /><span className="font-semibold text-slate-700">{value || '-'}</span></div>
}