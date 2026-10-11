import { createAppsScriptProxy } from '../lib/appsScriptProxy.js'

export default createAppsScriptProxy('PO_APPS_SCRIPT_URL', [
    'po_sync_health',
    'po_sync_from_firestore',
    'po_sync_customer_from_firestore',
])
