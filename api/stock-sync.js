import { createAppsScriptProxy } from '../lib/appsScriptProxy.js'

export default createAppsScriptProxy('STOCK_APPS_SCRIPT_URL', [
    'list',
    'logs',
    'upload',
    'stock_sync_from_firestore',
    'stock_sync_health',
])
