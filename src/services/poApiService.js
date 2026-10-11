import { firestoreData } from './firestoreData'

export const poApiService = {
    list: () => firestoreData.listPOs(),
    subscribe: (onData, onError) => firestoreData.subscribePOs(onData, onError),
    save: (record) => firestoreData.savePO(record),
    remove: (id) => firestoreData.deletePO(id),
    retrySync: (id) => firestoreData.retryPOSync(id),
    retryCustomerSync: (id) => firestoreData.retryPOCustomerSync(id),
    addCustomer: (name) => firestoreData.addCustomer(name),
    togglePaid: (id, status) => firestoreData.togglePaid(id, status),
}
