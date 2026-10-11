const MAX_REQUEST_BYTES = 4 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 25000

export function createAppsScriptProxy(environmentVariable, allowedActions) {
    return async function appsScriptProxy(request, response) {
        response.setHeader('Cache-Control', 'no-store')

        if (request.method !== 'POST') {
            response.setHeader('Allow', 'POST')
            return response.status(405).json({ success: false, message: 'Method not allowed' })
        }

        const endpoint = process.env[environmentVariable]
        if (!endpoint) {
            return response.status(503).json({
                success: false,
                message: `Vercel environment variable ${environmentVariable} is not configured`,
            })
        }

        let endpointUrl
        try {
            endpointUrl = new URL(endpoint)
        } catch {
            return response.status(500).json({ success: false, message: `${environmentVariable} is invalid` })
        }

        if (endpointUrl.protocol !== 'https:' || endpointUrl.hostname !== 'script.google.com' ||
            !/^\/macros\/s\/[^/]+\/exec$/.test(endpointUrl.pathname)) {
            return response.status(500).json({ success: false, message: `${environmentVariable} is not a valid Apps Script Web App URL` })
        }

        let payload
        try {
            const body = Buffer.isBuffer(request.body) ? request.body.toString('utf8') : request.body
            payload = typeof body === 'string' ? JSON.parse(body) : body
        } catch {
            return response.status(400).json({ success: false, message: 'Request body must be valid JSON' })
        }

        if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
            typeof payload.action !== 'string' || !allowedActions.includes(payload.action.toLowerCase())) {
            return response.status(400).json({ success: false, message: 'Unsupported Apps Script action' })
        }

        const body = JSON.stringify(payload)
        if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) {
            return response.status(413).json({ success: false, message: 'Request is larger than the 4 MB proxy limit' })
        }

        try {
            const upstream = await fetch(endpointUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' },
                body,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            })
            const text = await upstream.text()
            let result
            try {
                result = text ? JSON.parse(text) : {}
            } catch {
                return response.status(502).json({ success: false, message: 'Apps Script returned an invalid JSON response' })
            }

            return response.status(upstream.ok ? 200 : 502).json(result)
        } catch (error) {
            return response.status(502).json({
                success: false,
                message: `Apps Script request failed: ${error.message || 'unknown error'}`,
            })
        }
    }
}
