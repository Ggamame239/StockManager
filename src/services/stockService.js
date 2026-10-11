import { firestoreData } from './firestoreData'
import { request } from './api'

export const stockService = {
    list: () => firestoreData.listStock(),
    subscribe: (onData, onError) => firestoreData.subscribeStock(onData, onError),
    retrySync: (id) => firestoreData.retryStockSync(id),
    logs: (productId) => firestoreData.listStockLogs(productId),
    create: (product) => firestoreData.saveStock(product),
    update: (product) => firestoreData.saveStock(product),
    save: (product) => firestoreData.saveStock(product),
    adjust: (data) => firestoreData.adjustStock(data),
    remove: (id) => firestoreData.deleteStock(id),
    upload: async ({ sku, image }) => {
        await firestoreData.ensureStockSyncReady()
        return request('upload', { sku, image })
    },
    invalidateListCache: () => {},
}

export function getProductImageUrl(imageId) {
    return getProductImageUrls(imageId)[0] || ''
}

export function getProductImageUrls(imageId) {
    const value = String(imageId || '').trim()
    if (!value) return []
    if (/^https?:\/\//i.test(value)) return [value]
    const id = encodeURIComponent(value)
    return [
        `https://drive.google.com/thumbnail?id=${id}&sz=w400`,
        `https://lh3.googleusercontent.com/d/${id}=w400`,
        `https://drive.google.com/uc?export=view&id=${id}`,
    ]
}
