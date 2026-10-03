import { request } from './api'

export const poApiService = {
    list: () => request('po_list', {}, 'po'),
    save: (record) => request('po_save', record, 'po'),
    addCustomer: (name) => request('po_customer_add', { name }, 'po'),
    togglePaid: (row, status) => request('po_toggle_paid', { row, status }, 'po'),
}