function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    var data = JSON.parse(raw);
    var action = String(data.action || '').toLowerCase();
    var result;

    switch (action) {
      case 'po_sync_health':
        result = poSyncHealth_();
        break;
      case 'po_sync_from_firestore':
        result = poSyncFromFirestore_(data);
        break;
      case 'po_sync_customer_from_firestore':
        result = poSyncCustomerFromFirestore_(data);
        break;
      default:
        throw new Error('ไม่รู้จัก PO sync action: ' + action);
    }
    return poSyncJsonResponse_({ success: true, ...result });
  } catch (error) {
    return poSyncJsonResponse_({
      success: false,
      message: error && error.message ? error.message : String(error)
    });
  }
}

function poSyncJsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
