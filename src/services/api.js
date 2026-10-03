const API_ENDPOINTS = {
    stock: {
        url: (import.meta.env.VITE_APPS_SCRIPT_URL || '').trim(),
        proxy: '/apps-script-api',
        variable: 'VITE_APPS_SCRIPT_URL',
    },
    po: {
        url: (import.meta.env.VITE_PO_APPS_SCRIPT_URL || '').trim(),
        proxy: '/po-tracker-api',
        variable: 'VITE_PO_APPS_SCRIPT_URL',
    },
}

export class ApiError extends Error {
    constructor(message, response) {
        super(message)
        this.name = 'ApiError'
        this.response = response
    }
}

export async function request(action, payload = {}, service = 'stock') {
    const endpoint = API_ENDPOINTS[service] || API_ENDPOINTS.stock
    if (!endpoint.url) {
        throw new ApiError(`ยังไม่ได้ตั้งค่า ${endpoint.variable}`, null)
    }
    const apiUrl = import.meta.env.DEV ? endpoint.proxy : endpoint.url

    let response
    try {
        response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action, ...payload }),
        })
    } catch (error) {
        throw new ApiError(`เชื่อมต่อ Apps Script ไม่ได้: ${error.message || 'ตรวจสอบ CORS และการ deploy'}`, null)
    }

    const text = await response.text()
    let data
    try {
        data = text ? JSON.parse(text) : {}
    } catch {
        if (text.includes('ไม่พบฟังก์ชันของสคริปต์: doPost')) {
            throw new ApiError('Apps Script deployment นี้ยังไม่มีฟังก์ชัน doPost สำหรับรับ API', response)
        }
        throw new ApiError('API ส่งข้อมูลที่อ่านไม่ได้กลับมา', response)
    }

    if (!response.ok || data.success === false) {
        throw new ApiError(data.message || `API request failed (${response.status})`, response)
    }

    return data
}
