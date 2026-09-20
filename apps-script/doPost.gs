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
        result = saveProduct(data);
        break;
      case 'adjust':
        result = adjustStock(data);
        break;
      case 'delete':
        result = deleteProduct(data.row);
        break;
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

function getLogsForApi_(productId) {
  var sh = shLog_();
  var last = sh.getLastRow();
  if (last < 2) return { success: true, items: [] };

  var rows = sh.getRange(2, 1, last - 1, H_LOG.length).getValues();
  var items = rows.filter(function (row) {
    return !productId || String(row[1] || '') === String(productId);
  }).map(function (row) {
    return {
      timestamp: fmt_(row[0]),
      productId: String(row[1] || ''),
      sku: String(row[2] || ''),
      name: String(row[3] || ''),
      type: String(row[4] || ''),
      change: Number(row[5]) || 0,
      before: Number(row[6]) || 0,
      after: Number(row[7]) || 0,
      reason: String(row[8] || '')
    };
  }).reverse();

  return { success: true, items: items };
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
