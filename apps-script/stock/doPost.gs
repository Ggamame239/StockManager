function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    var data = JSON.parse(raw);
    var action = String(data.action || '').toLowerCase();
    var result;

    switch (action) {
      case 'list':
        result = getProducts();
        break;
      case 'create':
      case 'update':
      case 'adjust':
      case 'delete':
        throw new Error('Stock records must be changed through Firebase, not directly through this endpoint');
      case 'logs':
        result = getLogsForApi_(data.productId || data.id || '');
        break;
      case 'upload':
        if (!data.image || !data.image.data) throw new Error('ไม่พบข้อมูลรูปภาพ');
        result = {
          success: true,
          imageId: saveImage_(data.image, data.sku || 'ITEM')
        };
        break;
      case 'stock_sync_from_firestore':
        result = stockSyncAction_(data);
        break;
      case 'stock_sync_health':
        result = stockSyncHealth_();
        break;
      default:
        throw new Error('ไม่รู้จัก action: ' + action);
    }

    return jsonResponse_(result);
  } catch (err) {
    return jsonResponse_({
      success: false,
      message: err && err.message ? err.message : String(err)
    });
  }
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
