export const PO_COLUMNS = [
    'PO Number', 'Customer Name', 'Quotation', 'PO Date', 'Total Amount',
    'Invoice number', 'Invoice date', 'Payment Terms (Days)', 'Payment Due Date',
    'Payment Status', 'Status',
]
import * as XLSX from 'xlsx'

let workbook = null
let disabledCustomerNames = new Set()
let poTemplate = null

function sheetRows() {
    const sheet = workbook?.Sheets['PO tracker']
    return sheet ? readLegacyRows(sheet) : []
}

function normalizeHeader(value) {
    return String(value || '').replace(/^\uFEFF/, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function setWorkbookFromBuffer(buffer) {
    const next = XLSX.read(buffer, { type: 'array', cellDates: true })
    if (!next.Sheets['PO tracker']) throw new Error('ไม่พบ Sheet ชื่อ "PO tracker"')
    const metadata = legacyMeta(next.Sheets['PO tracker'])
    const headers = metadata ? metadata.headers.map(normalizeHeader) : []
    const missing = PO_COLUMNS.filter((column) => !headers.includes(normalizeHeader(column)))
    if (missing.length) throw new Error(`Column ไม่ครบ: ${missing.join(', ')}`)
    workbook = next
    poTemplate = metadata
}

function legacyMeta(sheet) {
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', cellDates: true })
    const headerIndex = matrix.findIndex((row) => {
        const headers = row.map(normalizeHeader)
        return headers.includes(normalizeHeader('PO Number')) && headers.includes(normalizeHeader('Total Amount'))
    })
    return headerIndex < 0 ? null : { matrix, headerIndex, headers: matrix[headerIndex], instruction: matrix[headerIndex + 1] || [], prefix: matrix.slice(0, headerIndex) }
}

export function readLegacyRows(sheet) {
    const meta = legacyMeta(sheet)
    if (!meta) return []
    const headers = meta.headers.map(normalizeHeader)
    return meta.matrix.slice(meta.headerIndex + 1).map((row) => PO_COLUMNS.reduce((result, column) => {
        const index = headers.indexOf(normalizeHeader(column))
        result[column] = index >= 0 ? row[index] ?? '' : ''
        return result
    }, {}))
}

function customerNames() {
    const sheet = workbook?.Sheets.Sheet1
    if (!sheet) return []
    return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }).map((row) => String(row[0] || '').trim()).filter(Boolean)
}

function setSheetRows(name, rows, headers) {
    const index = workbook.SheetNames.indexOf(name)
    let sheet
    if (name === 'PO tracker') {
        const rawHeaders = poTemplate?.headers || headers
        const normalizedHeaders = rawHeaders.map(normalizeHeader)
        const dataRows = rows.filter((row) => row['PO Number'] && row['PO Number'] !== 'เลข PO ลูกค้า').map((row) => rawHeaders.map((header, columnIndex) => {
            const column = PO_COLUMNS.find((item) => normalizeHeader(item) === normalizedHeaders[columnIndex])
            return column ? row[column] || '' : ''
        }))
        sheet = XLSX.utils.aoa_to_sheet([...(poTemplate?.prefix || []), rawHeaders, ...(poTemplate?.instruction ? [poTemplate.instruction] : []), ...dataRows])
    } else sheet = XLSX.utils.aoa_to_sheet(rows)
    if (index >= 0) workbook.Sheets[name] = sheet
    else XLSX.utils.book_append_sheet(workbook, sheet, name)
}

async function ensureWorkbook() {
    if (workbook) return
    const response = await fetch('/Over%20all%20tracker%20P.tech.xlsx')
    if (!response.ok) throw new Error('ไม่พบไฟล์ฐานข้อมูล PO Tracker ใน public')
    setWorkbookFromBuffer(await response.arrayBuffer())
}

function asOrder(row, index) {
    return {
        id: String(row['PO Number'] || `row-${index}`),
        poNumber: String(row['PO Number'] || '').trim(),
        customerName: String(row['Customer Name'] || '').trim(),
        quotation: String(row.Quotation || '').trim(),
        poDate: normalizeDate(row['PO Date']),
        totalAmount: Number(row['Total Amount']) || 0,
        invoiceNumber: String(row['Invoice number'] || '').trim(),
        invoiceDate: normalizeDate(row['Invoice date']),
        paymentTerms: Number(row['Payment Terms (Days)']) || 0,
        paymentDueDate: normalizeDate(row['Payment Due Date']),
        paymentStatus: String(row['Payment Status'] || 'Pending').trim(),
        status: String(row.Status || 'Waiting').trim(),
    }
}

function normalizeDate(value) {
    if (!value) return ''
    if (value instanceof Date) return value.toISOString().slice(0, 10)
    const parsed = new Date(String(value))
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString().slice(0, 10)
}

export function fromLegacyRow(row) {
    return asOrder(row, 0)
}

export function toLegacyRow(order) {
    return PO_COLUMNS.reduce((row, column) => {
        const values = {
            'PO Number': order.poNumber, 'Customer Name': order.customerName, Quotation: order.quotation,
            'PO Date': order.poDate, 'Total Amount': Number(order.totalAmount) || 0, 'Invoice number': order.invoiceNumber,
            'Invoice date': order.invoiceDate, 'Payment Terms (Days)': Number(order.paymentTerms) || 0,
            'Payment Due Date': order.paymentDueDate, 'Payment Status': order.paymentStatus || 'Pending', Status: order.status || 'Waiting',
        }
        row[column] = values[column] || ''
        return row
    }, {})
}

export const poTrackerService = {
    openWorkbook: async (file) => {
        setWorkbookFromBuffer(await file.arrayBuffer())
        return poTrackerService.list(true)
    },
    list: async () => {
        await ensureWorkbook()
        const customers = customerNames().map((name, index) => ({ id: `${index}-${name}`, name, enabled: !disabledCustomerNames.has(name) }))
        const orders = sheetRows().map(asOrder).filter((order) => order.poNumber && order.poNumber !== 'เลข PO ลูกค้า')
        const today = new Date().toISOString().slice(0, 10)
        orders.forEach((order) => { if (today > order.paymentDueDate && order.paymentStatus !== 'Paid') order.paymentStatus = 'Overdue' })
        const summary = { totalPO: orders.length, totalAmount: orders.reduce((sum, order) => sum + order.totalAmount, 0), pending: orders.filter((order) => ['Pending', 'Unpaid'].includes(order.paymentStatus)).length, processing: orders.filter((order) => order.status === 'Production / Processing').length, waiting: orders.filter((order) => order.status === 'Waiting').length, delivered: orders.filter((order) => order.status === 'Delivered').length, invoiced: orders.filter((order) => order.status === 'Invoiced' || order.status === 'วางบิลแล้ว').length, overdue: orders.filter((order) => order.paymentStatus === 'Overdue').length }
        return { success: true, orders, customers, summary }
    },
    save: async (order) => {
        await ensureWorkbook()
        const rows = sheetRows()
        const duplicate = rows.findIndex((row) => String(row['PO Number'] || '').trim() === order.poNumber)
        const current = rows.findIndex((row) => String(row['PO Number'] || '').trim() === order.id)
        if (duplicate >= 0 && duplicate !== current) throw new Error('PO Number ซ้ำใน PO Tracker')
        if (current >= 0) rows[current] = toLegacyRow(order)
        else rows.push(toLegacyRow(order))
        setSheetRows('PO tracker', rows, PO_COLUMNS)
        if (order.customerName && !customerNames().some((name) => name.toLowerCase() === order.customerName.toLowerCase())) setSheetRows('Sheet1', [...customerNames(), order.customerName].map((name) => [name]))
        return { success: true }
    },
    saveCustomer: async ({ name }) => {
        await ensureWorkbook()
        if (customerNames().some((item) => item.toLowerCase() === name.trim().toLowerCase())) throw new Error('Customer ซ้ำใน PO Tracker')
        setSheetRows('Sheet1', [...customerNames(), name.trim()].map((item) => [item]))
        return { success: true }
    },
    disableCustomer: async (id) => {
        await ensureWorkbook()
        const name = customerNames().find((item, index) => `${index}-${item}` === id)
        if (name) disabledCustomerNames.add(name)
        return { success: true }
    },
    importRows: async (rows, customers = []) => {
        await ensureWorkbook()
        const existing = new Set(sheetRows().map((row) => String(row['PO Number'] || '').trim()))
        let imported = 0
        const nextRows = sheetRows()
        rows.forEach((row) => { if (row.poNumber && !existing.has(row.poNumber)) { nextRows.push(toLegacyRow(row)); existing.add(row.poNumber); imported++ } })
        setSheetRows('PO tracker', nextRows, PO_COLUMNS)
        const names = customerNames()
        const mergedCustomers = [...names, ...customers.filter((name) => !names.some((item) => item.toLowerCase() === name.toLowerCase()))]
        setSheetRows('Sheet1', mergedCustomers.map((name) => [name]))
        return { success: true, imported, skipped: rows.length - imported, customersImported: mergedCustomers.length - names.length }
    },
    exportFile: async () => {
        await ensureWorkbook()
        XLSX.writeFile(workbook, 'Over all tracker P.tech.xlsx')
    },
}

