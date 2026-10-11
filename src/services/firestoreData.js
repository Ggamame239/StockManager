import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    serverTimestamp,
    updateDoc,
    where,
} from 'firebase/firestore'
import { ensureAnonymousAuth, db } from './firebase'
import { request } from './api'

const INVENTORY = 'inventory'
const STOCK_LOGS = 'stockLogs'
const PURCHASE_ORDERS = 'purchaseOrders'
const PO_CUSTOMERS = 'poCustomers'
const PO_SETTINGS = 'poSettings'
const SYNC_CONFLICTS = 'syncConflicts'
const DEFAULT_PO_OPTIONS = {
    payStatus: ['Unpaid', 'Paid'],
    delivery: ['รอผลิต', 'ผลิตเสร็จ', 'ส่งของแล้ว', 'วางบิลแล้ว', 'ยกเลิก'],
}

async function requestWithRetry(action, payload, service) {
    for (let attempt = 0; ; attempt++) {
        try {
            return await request(action, payload, service)
        } catch (error) {
            const status = error.response?.status
            const retryable = !error.response || status === 429 || status >= 500
            if (!retryable || attempt >= 2) throw error
            await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)))
        }
    }
}

async function ensureSheetSyncReady(service) {
    const action = service === 'po' ? 'po_sync_health' : 'stock_sync_health'
    try {
        const result = await request(action, {}, service)
        if (result.ready !== true) throw new Error('Apps Script ไม่ได้ยืนยันความพร้อมของการซิงก์')
    } catch (error) {
        throw new Error(`ยังไม่บันทึกข้อมูล: ${service === 'po' ? 'PO' : 'Stock'} Google Sheets sync ยังไม่พร้อม (${error.message})`)
    }
}

function requireText(value, label) {
    const text = String(value ?? '').trim()
    if (!text) throw new Error(`กรุณากรอก${label}`)
    return text
}

function toProduct(snapshot) {
    const product = snapshot.data()
    return {
        ...product,
        id: snapshot.id,
        row: snapshot.id,
        qty: Number(product.qty) || 0,
        minQty: Number(product.minQty) || 0,
        status: Number(product.qty) <= 0 ? 'out' : Number(product.qty) <= Number(product.minQty) ? 'low' : 'ok',
    }
}

function productSummary(items) {
    return items.reduce((summary, product) => ({
        totalSku: summary.totalSku + 1,
        totalQty: summary.totalQty + product.qty,
        lowCount: summary.lowCount + (product.status === 'low' ? 1 : 0),
        zeroCount: summary.zeroCount + (product.status === 'out' ? 1 : 0),
    }), { totalSku: 0, totalQty: 0, lowCount: 0, zeroCount: 0 })
}

function toDateText(value) {
    if (!value) return ''
    if (typeof value === 'string') return value.slice(0, 10)
    if (typeof value.toDate === 'function') return value.toDate().toISOString().slice(0, 10)
    return ''
}

function displayDate(value) {
    if (!value) return ''
    const date = new Date(`${value}T00:00:00Z`)
    if (Number.isNaN(date.getTime())) return ''
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: 'UTC',
        day: '2-digit',
        month: 'short',
        year: '2-digit',
    }).format(date).replaceAll(' ', '-')
}

function bangkokDateText() {
    const parts = new Intl.DateTimeFormat('en', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date())
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
    return `${values.year}-${values.month}-${values.day}`
}

function poIsPaid(status) {
    const value = String(status || '').toLowerCase().trim()
    return /(paid|รับแล้ว|ได้รับ|ชำระแล้ว|จ่ายแล้ว|เรียบร้อย)/.test(value) && !/unpaid|ยังไม่/.test(value)
}

function poIsDelivered(status) {
    return /(ส่งแล้ว|ส่งของแล้ว|จัดส่งแล้ว|delivered|shipped)/i.test(String(status || '').trim())
}

function toPORecord(snapshot) {
    const data = snapshot.data()
    const poDateISO = toDateText(data.poDateISO)
    const invDateISO = toDateText(data.invDateISO)
    const dueDateISO = toDateText(data.dueDateISO)
    const paid = poIsPaid(data.payStatus)
    const daysLeft = dueDateISO
        ? Math.round((Date.parse(`${dueDateISO}T00:00:00Z`) - Date.parse(`${bangkokDateText()}T00:00:00Z`)) / 86400000)
        : null
    let state = paid ? 'paid' : 'unpaid'
    if (!paid && daysLeft !== null && daysLeft < 0) state = 'overdue'
    else if (!paid && daysLeft !== null && daysLeft <= 7) state = 'duesoon'
    return {
        ...data,
        id: snapshot.id,
        row: snapshot.id,
        poNumber: String(data.poNumber || '').trim(),
        customer: String(data.customer || '').trim(),
        quotation: String(data.quotation || '').trim(),
        poDateISO,
        poDate: displayDate(poDateISO),
        amount: Number(data.amount) || 0,
        invoice: String(data.invoice || '').trim(),
        invDateISO,
        invDate: displayDate(invDateISO),
        credit: Number(data.credit) || 0,
        dueDateISO,
        dueDate: displayDate(dueDateISO),
        payStatus: String(data.payStatus || 'Unpaid').trim(),
        delivery: String(data.delivery || '').trim(),
        paid,
        delivered: poIsDelivered(data.delivery),
        daysLeft,
        state,
    }
}

function poSummary(records) {
    return records.reduce((summary, record) => {
        summary.total++
        summary.totalAmount += record.amount
        if (record.paid) {
            summary.paidAmount += record.amount
            summary.paidCount++
        } else {
            summary.unpaidAmount += record.amount
            summary.unpaidCount++
            if (record.state === 'overdue') summary.overdueCount++
            if (record.state === 'duesoon') summary.dueSoonCount++
        }
        return summary
    }, { total: 0, totalAmount: 0, paidAmount: 0, unpaidAmount: 0, paidCount: 0, unpaidCount: 0, overdueCount: 0, dueSoonCount: 0 })
}

export const firestoreData = {
    ensureStockSyncReady: () => ensureSheetSyncReady('stock'),

    async listStock() {
        await ensureAnonymousAuth()
        const snapshot = await getDocs(query(collection(db, INVENTORY), orderBy('sku')))
        const allItems = snapshot.docs.map(toProduct)
        const items = allItems.filter((product) => !product.deletedAt)
        return {
            success: true,
            items,
            syncErrors: allItems.filter((product) => product.sheetSync?.status === 'error'),
            summary: productSummary(items),
            customers: [...new Set(items.map((product) => product.customer).filter(Boolean))].sort(),
        }
    },

    subscribeStock(onData, onError) {
        let active = true
        let unsubscribe
        Promise.resolve().then(() => ensureAnonymousAuth()).then(() => {
            if (active) {
                unsubscribe = onSnapshot(query(collection(db, INVENTORY), orderBy('sku')), (snapshot) => {
                    const allItems = snapshot.docs.map(toProduct)
                    const items = allItems.filter((product) => !product.deletedAt)
                    onData({
                        success: true,
                        items,
                        syncErrors: allItems.filter((product) => product.sheetSync?.status === 'error'),
                        summary: productSummary(items),
                        customers: [...new Set(items.map((product) => product.customer).filter(Boolean))].sort(),
                    })
                }, onError)
            }
        }).catch(onError)
        return () => {
            active = false
            unsubscribe?.()
        }
    },

    async saveStock(input) {
        await ensureAnonymousAuth()
        await ensureSheetSyncReady('stock')
        const sku = requireText(input.sku, 'รหัสสินค้า')
        const name = requireText(input.name, 'ชื่อสินค้า')
        const qty = Number(input.qty)
        const minQty = Number(input.minQty) || 0
        if (!Number.isFinite(qty) || qty < 0 || !Number.isFinite(minQty) || minQty < 0) {
            throw new Error('จำนวนสินค้าและจำนวนขั้นต่ำต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป')
        }
        const id = input.id || doc(collection(db, INVENTORY)).id
        const reference = doc(db, INVENTORY, id)
        const normalizedSku = sku.toLocaleLowerCase()
        const logReference = doc(collection(db, STOCK_LOGS))
        let qtyChange
        let revision = 1
        await runTransaction(db, async (transaction) => {
            const matches = await transaction.get(query(collection(db, INVENTORY), where('normalizedSku', '==', normalizedSku)))
            if (matches.docs.some((match) => match.id !== id && !match.data().deletedAt)) {
                throw new Error(`รหัสสินค้า ${sku} มีอยู่แล้ว`)
            }
            const current = await transaction.get(reference)
            revision = (Number(current.data()?.revision) || 0) + 1
            const before = Number(current.data()?.qty) || 0
            qtyChange = current.exists() && before !== qty
            const fields = { ...input }
            delete fields.id
            delete fields.image
            delete fields.row
            delete fields.status
            transaction.set(reference, {
                ...fields,
                sku,
                normalizedSku,
                name,
                qty,
                minQty,
                imageId: input.imageId || current.data()?.imageId || '',
                updatedAt: serverTimestamp(),
                createdAt: current.data()?.createdAt || serverTimestamp(),
                revision,
                ...(qtyChange ? { lastStockLogId: logReference.id } : {}),
            }, { merge: true })
            if (qtyChange) {
                transaction.set(logReference, {
                    id: logReference.id,
                    productId: id,
                    sku,
                    name,
                    type: 'EDIT',
                    change: qty - before,
                    before,
                    after: qty,
                    reason: 'แก้ไขข้อมูลสินค้า',
                    createdAt: serverTimestamp(),
                })
            }
        })
        const record = {
            ...input,
            id,
            sku,
            name,
            qty,
            minQty,
            imageId: input.imageId || '',
            lastStockLogId: qtyChange ? logReference.id : input.lastStockLogId,
            revision,
        }
        try {
            await requestWithRetry('stock_sync_from_firestore', { id, revision, record }, 'stock')
            await updateDoc(reference, { sheetSync: { status: 'synced', revision, updatedAt: serverTimestamp(), error: '' } })
        } catch (error) {
            await updateDoc(reference, { sheetSync: { status: 'error', revision, updatedAt: serverTimestamp(), error: error.message } })
            error.persisted = true
            error.documentId = id
            throw error
        }
        return { success: true, id }
    },

    async adjustStock({ id, type, amount, reason }) {
        await ensureAnonymousAuth()
        await ensureSheetSyncReady('stock')
        const quantity = Number(amount)
        if (!Number.isFinite(quantity) || quantity < 0 || !['IN', 'OUT', 'SET'].includes(type)) {
            throw new Error('ข้อมูลการปรับสต็อกไม่ถูกต้อง')
        }
        const reference = doc(db, INVENTORY, id)
        const logReference = doc(collection(db, STOCK_LOGS))
        let revision = 1
        let record
        await runTransaction(db, async (transaction) => {
            const snapshot = await transaction.get(reference)
            if (!snapshot.exists() || snapshot.data().deletedAt) throw new Error('ไม่พบสินค้าในสต็อก')
            const product = snapshot.data()
            const before = Number(product.qty) || 0
            const after = type === 'IN' ? before + quantity : type === 'OUT' ? before - quantity : quantity
            if (after < 0) throw new Error('จำนวนคงเหลือไม่สามารถติดลบได้')
            revision = (Number(product.revision) || 0) + 1
            record = {
                ...product,
                id,
                qty: after,
                revision,
                lastStockLogId: logReference.id,
                lastStockChange: { type, change: after - before, before, after, reason: String(reason || '') },
            }
            transaction.update(reference, { qty: after, updatedAt: serverTimestamp(), revision, lastStockLogId: logReference.id })
            transaction.set(logReference, {
                productId: id, sku: product.sku, name: product.name, type, id: logReference.id,
                change: after - before, before, after, reason: String(reason || ''),
                createdAt: serverTimestamp(),
            })
        })
        try {
            await requestWithRetry('stock_sync_from_firestore', { id, revision, record }, 'stock')
            await updateDoc(reference, { sheetSync: { status: 'synced', revision, updatedAt: serverTimestamp(), error: '' } })
        } catch (error) {
            await updateDoc(reference, { sheetSync: { status: 'error', revision, updatedAt: serverTimestamp(), error: error.message } })
            error.persisted = true
            error.documentId = id
            throw error
        }
        return { success: true }
    },

    async deleteStock(id) {
        await ensureAnonymousAuth()
        await ensureSheetSyncReady('stock')
        const reference = doc(db, INVENTORY, id)
        let revision = 1
        await runTransaction(db, async (transaction) => {
            const snapshot = await transaction.get(reference)
            if (!snapshot.exists() || snapshot.data().deletedAt) throw new Error('ไม่พบสินค้าในสต็อก')
            revision = (Number(snapshot.data().revision) || 0) + 1
            transaction.update(reference, {
                deletedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                revision,
            })
        })
        try {
            await requestWithRetry('stock_sync_from_firestore', {
                id,
                revision,
                record: { id, deletedAt: new Date().toISOString(), revision },
            }, 'stock')
            await updateDoc(reference, { sheetSync: { status: 'synced', revision, updatedAt: serverTimestamp(), error: '' } })
        } catch (error) {
            await updateDoc(reference, { sheetSync: { status: 'error', revision, updatedAt: serverTimestamp(), error: error.message } })
            error.persisted = true
            error.documentId = id
            throw error
        }
        return { success: true }
    },

    async retryStockSync(id) {
        await ensureAnonymousAuth()
        await ensureSheetSyncReady('stock')
        const reference = doc(db, INVENTORY, id)
        const snapshot = await getDoc(reference)
        if (!snapshot.exists()) throw new Error('ไม่พบสินค้าในสต็อก')
        const record = { id, ...snapshot.data() }
        const revision = Number(record.revision) || 1
        try {
            await requestWithRetry('stock_sync_from_firestore', {
                id,
                revision,
                record: record.deletedAt ? { id, deletedAt: toDateText(record.deletedAt), revision } : record,
            }, 'stock')
            await updateDoc(reference, { sheetSync: { status: 'synced', revision, updatedAt: serverTimestamp(), error: '' } })
            return { success: true }
        } catch (error) {
            await updateDoc(reference, { sheetSync: { status: 'error', revision, updatedAt: serverTimestamp(), error: error.message } })
            throw error
        }
    },

    async listStockLogs(productId = '') {
        await ensureAnonymousAuth()
        const constraints = productId
            ? [where('productId', '==', productId), orderBy('createdAt', 'desc'), limit(100)]
            : [orderBy('createdAt', 'desc'), limit(100)]
        const snapshot = await getDocs(query(collection(db, STOCK_LOGS), ...constraints))
        const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
            .sort((left, right) => (right.createdAt?.toMillis?.() || 0) - (left.createdAt?.toMillis?.() || 0))
            .map((item) => ({
                ...item,
                timestamp: item.createdAt?.toDate?.().toLocaleString('th-TH') ||
                    (typeof item.createdAt === 'string' ? new Date(item.createdAt).toLocaleString('th-TH') : ''),
            }))
        return { success: true, items }
    },

    async listPOs() {
        await ensureAnonymousAuth()
        const [poSnapshot, customerSnapshot, optionsSnapshot, conflictSnapshot] = await Promise.all([
            getDocs(query(collection(db, PURCHASE_ORDERS), orderBy('poNumber'))),
            getDocs(query(collection(db, PO_CUSTOMERS), orderBy('name'))),
            getDoc(doc(db, PO_SETTINGS, 'options')),
            getDocs(query(collection(db, SYNC_CONFLICTS), where('module', '==', 'po'))),
        ])
        const allRecords = poSnapshot.docs.map(toPORecord)
        const records = allRecords.filter((item) => !item.deletedAt)
        return {
            success: true,
            records,
            customers: customerSnapshot.docs.filter((item) => !item.data().deletedAt).map((item) => item.data().name),
            options: optionsSnapshot.exists() ? optionsSnapshot.data() : DEFAULT_PO_OPTIONS,
            conflicts: conflictSnapshot.docs.filter((item) => item.data().status === 'open').map((item) => ({ id: item.id, ...item.data() })),
            syncErrors: [
                ...allRecords.filter((item) => item.sheetSync?.status === 'error')
                    .map((item) => ({ ...item, entityType: 'po' })),
                ...customerSnapshot.docs
                    .filter((item) => !item.data().deletedAt && item.data().sheetSync?.status === 'error')
                    .map((item) => ({ id: item.id, ...item.data(), entityType: 'customer' })),
            ],
            summary: poSummary(records),
        }
    },

    subscribePOs(onData, onError) {
        let active = true
        let unsubscribers = []
        Promise.resolve().then(() => ensureAnonymousAuth()).then(() => {
            if (!active) return
            const state = { orders: null, customers: null, options: undefined, conflicts: null }
            const publish = () => {
                if (!state.orders || !state.customers || state.options === undefined || !state.conflicts) return
                const records = state.orders.filter((item) => !item.data().deletedAt).map(toPORecord)
                onData({
                    success: true,
                    records,
                    customers: state.customers.filter((item) => !item.data().deletedAt).map((item) => item.data().name),
                    options: state.options || DEFAULT_PO_OPTIONS,
                    conflicts: state.conflicts.filter((item) => item.data().status === 'open').map((item) => ({ id: item.id, ...item.data() })),
                    syncErrors: [
                        ...state.orders.map(toPORecord)
                            .filter((item) => item.sheetSync?.status === 'error')
                            .map((item) => ({ ...item, entityType: 'po' })),
                        ...state.customers
                            .filter((item) => !item.data().deletedAt && item.data().sheetSync?.status === 'error')
                            .map((item) => ({ id: item.id, ...item.data(), entityType: 'customer' })),
                    ],
                    summary: poSummary(records),
                })
            }
            unsubscribers = [
                onSnapshot(query(collection(db, PURCHASE_ORDERS), orderBy('poNumber')), (snapshot) => {
                    state.orders = snapshot.docs
                    publish()
                }, onError),
                onSnapshot(query(collection(db, PO_CUSTOMERS), orderBy('name')), (snapshot) => {
                    state.customers = snapshot.docs
                    publish()
                }, onError),
                onSnapshot(doc(db, PO_SETTINGS, 'options'), (snapshot) => {
                    state.options = snapshot.exists() ? snapshot.data() : null
                    publish()
                }, onError),
                onSnapshot(query(collection(db, SYNC_CONFLICTS), where('module', '==', 'po')), (snapshot) => {
                    state.conflicts = snapshot.docs
                    publish()
                }, onError),
            ]
        }).catch(onError)
        return () => {
            active = false
            unsubscribers.forEach((unsubscribe) => unsubscribe())
        }
    },

    async savePO(input) {
        await ensureAnonymousAuth()
        await ensureSheetSyncReady('po')
        const customer = requireText(input.customer, 'ชื่อลูกค้า')
        const quotation = requireText(input.quotation, 'เลขใบเสนอราคา')
        const amount = Number(input.amount)
        if (!Number.isFinite(amount) || amount < 0) throw new Error('ยอดเงินต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป')
        const id = input.id || doc(collection(db, PURCHASE_ORDERS)).id
        const reference = doc(db, PURCHASE_ORDERS, id)
        const poNumber = String(input.poNumber || '').trim()
        const invoice = String(input.invoice || '').trim()
        const normalizedInvoice = invoice.toLowerCase()
        let revision = 1
        let sheetRow
        await runTransaction(db, async (transaction) => {
            if (normalizedInvoice) {
                const duplicates = await transaction.get(query(collection(db, PURCHASE_ORDERS), where('normalizedInvoice', '==', normalizedInvoice)))
                if (duplicates.docs.some((item) => item.id !== id && !item.data().deletedAt)) throw new Error(`Invoice ${invoice} ซ้ำ`)
            }
            const current = await transaction.get(reference)
            revision = (Number(current.data()?.revision) || 0) + 1
            sheetRow = current.data()?.sheetRow ?? input.sheetRow ?? null
            const fields = { ...input }
            delete fields.id
            delete fields.row
            delete fields.paid
            delete fields.delivered
            delete fields.daysLeft
            delete fields.state
            transaction.set(reference, {
                ...fields,
                customer,
                quotation,
                amount,
                poNumber,
                invoice,
                normalizedPONumber: poNumber.toLocaleLowerCase(),
                normalizedInvoice,
                sheetRow,
                payStatus: input.payStatus || 'Unpaid',
                delivery: input.delivery || '',
                updatedAt: serverTimestamp(),
                createdAt: current.data()?.createdAt || serverTimestamp(),
                revision,
            }, { merge: true })
        })
        const syncRecord = {
            ...input,
            id,
            customer,
            quotation,
            poNumber,
            invoice,
            amount,
            sheetRow,
            revision,
            payStatus: input.payStatus || 'Unpaid',
            delivery: input.delivery || '',
        }
        try {
            await requestWithRetry('po_sync_from_firestore', { id, revision, record: syncRecord }, 'po')
            await updateDoc(reference, { sheetSync: { status: 'synced', revision, updatedAt: serverTimestamp(), error: '' } })
        } catch (error) {
            await updateDoc(reference, { sheetSync: { status: 'error', revision, updatedAt: serverTimestamp(), error: error.message } })
            error.persisted = true
            error.documentId = id
            throw error
        }
        return { success: true, id, message: input.id ? 'อัปเดตข้อมูลเรียบร้อย' : 'บันทึก PO เรียบร้อย' }
    },

    async deletePO(id) {
        await ensureAnonymousAuth()
        await ensureSheetSyncReady('po')
        const reference = doc(db, PURCHASE_ORDERS, id)
        let revision
        let record
        await runTransaction(db, async (transaction) => {
            const snapshot = await transaction.get(reference)
            if (!snapshot.exists() || snapshot.data().deletedAt) throw new Error('ไม่พบ PO ที่ต้องการลบ')
            const current = snapshot.data()
            revision = (Number(current.revision) || 0) + 1
            record = { ...current, id, revision, deletedAt: new Date().toISOString() }
            transaction.update(reference, { deletedAt: serverTimestamp(), updatedAt: serverTimestamp(), revision })
        })
        try {
            await requestWithRetry('po_sync_from_firestore', { id, revision, record }, 'po')
            await updateDoc(reference, { sheetSync: { status: 'synced', revision, updatedAt: serverTimestamp(), error: '' } })
            return { success: true }
        } catch (error) {
            await updateDoc(reference, { sheetSync: { status: 'error', revision, updatedAt: serverTimestamp(), error: error.message } })
            error.persisted = true
            error.documentId = id
            throw error
        }
    },

    async retryPOSync(id) {
        await ensureAnonymousAuth()
        await ensureSheetSyncReady('po')
        const reference = doc(db, PURCHASE_ORDERS, id)
        const snapshot = await getDoc(reference)
        if (!snapshot.exists()) throw new Error('ไม่พบ PO ที่ต้องการซิงก์')
        const record = { id, ...snapshot.data() }
        const revision = Number(record.revision) || 1
        try {
            await requestWithRetry('po_sync_from_firestore', { id, revision, record }, 'po')
            await updateDoc(reference, { sheetSync: { status: 'synced', revision, updatedAt: serverTimestamp(), error: '' } })
            return { success: true }
        } catch (error) {
            await updateDoc(reference, { sheetSync: { status: 'error', revision, updatedAt: serverTimestamp(), error: error.message } })
            throw error
        }
    },

    async retryPOCustomerSync(id) {
        await ensureAnonymousAuth()
        await ensureSheetSyncReady('po')
        const reference = doc(db, PO_CUSTOMERS, id)
        const snapshot = await getDoc(reference)
        if (!snapshot.exists() || snapshot.data().deletedAt) throw new Error('ไม่พบลูกค้าที่ต้องการซิงก์')
        const name = requireText(snapshot.data().name, 'ชื่อลูกค้า')
        try {
            await requestWithRetry('po_sync_customer_from_firestore', { id, name }, 'po')
            await updateDoc(reference, { sheetSync: { status: 'synced', updatedAt: serverTimestamp(), error: '' } })
            return { success: true }
        } catch (error) {
            await updateDoc(reference, { sheetSync: { status: 'error', updatedAt: serverTimestamp(), error: error.message } })
            throw error
        }
    },

    async addCustomer(input) {
        await ensureAnonymousAuth()
        await ensureSheetSyncReady('po')
        const name = requireText(input, 'ชื่อลูกค้า')
        const normalizedName = name.toLocaleLowerCase()
        let customerId
        await runTransaction(db, async (transaction) => {
            const duplicates = await transaction.get(query(collection(db, PO_CUSTOMERS), where('normalizedName', '==', normalizedName)))
            const existing = duplicates.docs.find((item) => !item.data().deletedAt)
            if (existing) {
                customerId = existing.id
                return
            }
            const reference = doc(collection(db, PO_CUSTOMERS))
            customerId = reference.id
            transaction.set(reference, { name, normalizedName, createdAt: serverTimestamp() })
        })
        const reference = doc(db, PO_CUSTOMERS, customerId)
        try {
            await requestWithRetry('po_sync_customer_from_firestore', { id: customerId, name }, 'po')
            await updateDoc(reference, { sheetSync: { status: 'synced', updatedAt: serverTimestamp(), error: '' } })
        } catch (error) {
            await updateDoc(reference, { sheetSync: { status: 'error', updatedAt: serverTimestamp(), error: error.message } })
            error.persisted = true
            error.documentId = customerId
            throw error
        }
        const customerSnapshot = await getDocs(query(collection(db, PO_CUSTOMERS), orderBy('name')))
        const customers = customerSnapshot.docs
            .filter((item) => !item.data().deletedAt)
            .map((item) => item.data().name)
        return { success: true, message: `เพิ่มลูกค้า "${name}" เรียบร้อย`, customers }
    },

    async togglePaid(id, status) {
        await ensureAnonymousAuth()
        const snapshot = await getDoc(doc(db, PURCHASE_ORDERS, id))
        if (!snapshot.exists() || snapshot.data().deletedAt) throw new Error('ไม่พบ PO ที่ต้องการแก้ไข')
        return this.savePO({ ...toPORecord(snapshot), id, payStatus: String(status || 'Paid') })
    },
}
