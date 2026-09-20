import { request } from './api'

let listCache = null
let listRequest = null
const LIST_CACHE_MS = 30_000

export const stockService = {
  list: (force = false) => {
    if (!force && listCache && Date.now() - listCache.createdAt < LIST_CACHE_MS) {
      return Promise.resolve(listCache.data)
    }
    if (listRequest) return listRequest
    listRequest = request('list').then((data) => {
      listCache = { createdAt: Date.now(), data }
      return data
    }).finally(() => {
      listRequest = null
    })
    return listRequest
  },
  logs: (productId) => request('logs', { productId }),
  create: (product) => request('create', product),
  update: (product) => request('update', product),
  save: (product) => request(product.row ? 'update' : 'create', product),
  adjust: ({ row, type, amount, reason }) => request('adjust', { row, type, amount, reason }),
  remove: (row) => request('delete', { row }),
  upload: ({ sku, image }) => request('upload', { sku, image }),
  invalidateListCache: () => { listCache = null },
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
