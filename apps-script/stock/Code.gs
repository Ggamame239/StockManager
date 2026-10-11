var CFG = {
  SHEET_ID: '',
  SH_PRODUCT: 'Products',
  SH_LOG: 'Logs',
  FOLDER_NAME: 'Stock_Images',
  FOLDER_ID: '',
  TZ: 'Asia/Bangkok',
  TITLE: 'ระบบจัดการสต็อคสินค้า',
  MAX_IMG_MB: 10
};

var H_PRODUCT = ['ID', 'SKU', 'Name', 'Material', 'Customer', 'Qty', 'MinQty', 'Unit', 'ImageID', 'CreatedAt', 'UpdatedAt'];
var H_LOG = ['Timestamp', 'ProductID', 'SKU', 'Name', 'Type', 'Change', 'Before', 'After', 'Reason'];

function ss_() {
  var properties = PropertiesService.getScriptProperties();
  var sheetId = properties.getProperty('STOCK_SPREADSHEET_ID') || CFG.SHEET_ID;
  if (!sheetId) throw new Error('ตั้งค่า STOCK_SPREADSHEET_ID ใน Script Properties ก่อน');
  return SpreadsheetApp.openById(sheetId);
}

function sheet_(name, headers) {
  var spreadsheet = ss_();
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function shProduct_() { return sheet_(CFG.SH_PRODUCT, H_PRODUCT); }
function shLog_() { return sheet_(CFG.SH_LOG, H_LOG); }

function folder_() {
  if (CFG.FOLDER_ID) return DriveApp.getFolderById(CFG.FOLDER_ID);
  var folders = DriveApp.getFoldersByName(CFG.FOLDER_NAME);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(CFG.FOLDER_NAME);
}

function fmt_(value) {
  return value instanceof Date ? Utilities.formatDate(value, CFG.TZ, 'dd/MM/yyyy HH:mm') : String(value || '');
}

function saveImage_(image, sku) {
  if (!image || !image.data) return '';
  var bytes = Utilities.base64Decode(image.data);
  var sizeMb = bytes.length / 1048576;
  if (sizeMb > CFG.MAX_IMG_MB) throw new Error('รูปภาพใหญ่เกิน ' + CFG.MAX_IMG_MB + ' MB');
  var safeSku = String(sku || 'ITEM').replace(/[\\\/\[\]\*\?:]/g, '-');
  var timestamp = Utilities.formatDate(new Date(), CFG.TZ, 'yyyyMMdd_HHmmss');
  var blob = Utilities.newBlob(bytes, image.mimeType || 'image/jpeg', safeSku + '_' + timestamp + '.jpg');
  var file = folder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getId();
}

function emptySum_() {
  return { totalSku: 0, totalQty: 0, lowCount: 0, zeroCount: 0, customerCount: 0 };
}

function getProducts() {
  var sheet = shProduct_();
  var columns = stockSyncColumns_();
  var last = sheet.getLastRow();
  if (last < 2) return { success: true, items: [], summary: emptySum_(), customers: [] };
  var width = columns ? columns.logId : H_PRODUCT.length;
  var rows = sheet.getRange(2, 1, last - 1, width).getValues();
  var items = [];
  var customerSet = {};
  var totalQty = 0;
  var lowCount = 0;
  var zeroCount = 0;
  rows.forEach(function (row, index) {
    if (!row[0] && !row[1] || columns && row[columns.deletedAt - 1]) return;
    var qty = Number(row[5]) || 0;
    var minQty = Number(row[6]) || 0;
    var customer = String(row[4] || '-');
    customerSet[customer] = true;
    totalQty += qty;
    if (qty <= 0) zeroCount++;
    else if (minQty > 0 && qty <= minQty) lowCount++;
    var id = columns ? String(row[columns.id - 1] || row[0] || '') : String(row[0] || '');
    items.push({
      row: index + 2,
      id: id,
      sku: String(row[1] || ''),
      name: String(row[2] || ''),
      material: String(row[3] || '-'),
      customer: customer,
      qty: qty,
      minQty: minQty,
      unit: String(row[7] || 'ชิ้น'),
      imageId: String(row[8] || ''),
      createdAt: fmt_(row[9]),
      updatedAt: fmt_(row[10]),
      status: qty <= 0 ? 'out' : minQty > 0 && qty <= minQty ? 'low' : 'ok'
    });
  });
  items.sort(function (left, right) { return left.sku.localeCompare(right.sku); });
  return {
    success: true,
    items: items,
    customers: Object.keys(customerSet).sort(),
    summary: {
      totalSku: items.length,
      totalQty: totalQty,
      lowCount: lowCount,
      zeroCount: zeroCount,
      customerCount: Object.keys(customerSet).length
    }
  };
}

function saveProduct(form) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!form) throw new Error('ไม่พบข้อมูล');
    var sku = String(form.sku || '').trim().toUpperCase();
    var name = String(form.name || '').trim();
    var material = String(form.material || '').trim();
    var customer = String(form.customer || '').trim();
    var unit = String(form.unit || 'ชิ้น').trim();
    var qty = Number(form.qty) || 0;
    var minQty = Number(form.minQty) || 0;
    if (!sku || !name) throw new Error('กรุณากรอกรหัสสินค้าและชื่อสินค้า');
    if (qty < 0 || minQty < 0) throw new Error('จำนวนสินค้าและจำนวนขั้นต่ำต้องไม่ติดลบ');
    var sheet = shProduct_();
    var last = sheet.getLastRow();
    var existing = last >= 2 ? sheet.getRange(2, 1, last - 1, 2).getValues() : [];
    var isEdit = !!form.row && Number(form.row) >= 2;
    for (var index = 0; index < existing.length; index++) {
      if (String(existing[index][1] || '').trim().toUpperCase() === sku &&
          (!isEdit || index + 2 !== Number(form.row))) throw new Error('รหัสสินค้า "' + sku + '" มีอยู่ในระบบแล้ว');
    }
    var now = new Date();
    var imageId = String(form.imageId || '');
    if (form.image && form.image.data) imageId = saveImage_(form.image, sku);
    if (isEdit) {
      var rowNumber = Number(form.row);
      var oldRow = sheet.getRange(rowNumber, 1, 1, H_PRODUCT.length).getValues()[0];
      var before = Number(oldRow[5]) || 0;
      sheet.getRange(rowNumber, 1, 1, H_PRODUCT.length).setValues([[
        String(oldRow[0] || Utilities.getUuid()), sku, name, material, customer, qty, minQty, unit, imageId,
        oldRow[9] || now, now
      ]]);
      if (before !== qty) writeLog_(String(oldRow[0]), sku, name, 'EDIT', qty - before, before, qty, 'แก้ไขข้อมูลสินค้า');
      return { success: true, message: 'อัปเดตข้อมูล "' + name + '" เรียบร้อย' };
    }
    var id = 'P' + Utilities.getUuid().replace(/-/g, '').slice(0, 20);
    sheet.appendRow([id, sku, name, material, customer, qty, minQty, unit, imageId, now, now]);
    var newRow = sheet.getLastRow();
    sheet.getRange(newRow, 10, 1, 2).setNumberFormat('dd/mm/yyyy hh:mm');
    writeLog_(id, sku, name, 'NEW', qty, 0, qty, 'เพิ่มสินค้าใหม่เข้าระบบ');
    return { success: true, message: 'เพิ่มสินค้า "' + name + '" เรียบร้อย' };
  } finally {
    lock.releaseLock();
  }
}

function adjustStock(data) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var rowNumber = Number(data.row);
    var type = String(data.type || 'IN').toUpperCase();
    var amount = Number(data.amount) || 0;
    if (!rowNumber || rowNumber < 2) throw new Error('ไม่พบสินค้า');
    if (amount < 0 || !['IN', 'OUT', 'SET'].includes(type)) throw new Error('ข้อมูลปรับจำนวนไม่ถูกต้อง');
    if (type !== 'SET' && amount <= 0) throw new Error('กรุณาระบุจำนวนมากกว่า 0');
    var sheet = shProduct_();
    var row = sheet.getRange(rowNumber, 1, 1, H_PRODUCT.length).getValues()[0];
    var before = Number(row[5]) || 0;
    var after = type === 'IN' ? before + amount : type === 'OUT' ? before - amount : amount;
    if (after < 0) throw new Error('สต็อคไม่พอ (คงเหลือ ' + before + ' ' + (row[7] || 'ชิ้น') + ')');
    sheet.getRange(rowNumber, 6).setValue(after);
    sheet.getRange(rowNumber, 11).setValue(new Date());
    writeLog_(String(row[0]), String(row[1]), String(row[2]), type, after - before, before, after, String(data.reason || '-'));
    return { success: true, message: 'ปรับจำนวนสำเร็จ — คงเหลือ ' + after + ' ' + (row[7] || 'ชิ้น'), after: after };
  } finally {
    lock.releaseLock();
  }
}

function deleteProduct(row) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var rowNumber = Number(row);
    if (!rowNumber || rowNumber < 2) throw new Error('ไม่พบสินค้า');
    var sheet = shProduct_();
    var product = sheet.getRange(rowNumber, 1, 1, H_PRODUCT.length).getValues()[0];
    writeLog_(String(product[0]), String(product[1]), String(product[2]), 'DELETE', -(Number(product[5]) || 0), Number(product[5]) || 0, 0, 'ลบสินค้าออกจากระบบ');
    sheet.deleteRow(rowNumber);
    return { success: true, message: 'ลบสินค้าเรียบร้อย' };
  } finally {
    lock.releaseLock();
  }
}

function writeLog_(id, sku, name, type, change, before, after, reason) {
  var user = '';
  try { user = Session.getActiveUser().getEmail() || ''; } catch (error) {}
  var sheet = shLog_();
  sheet.appendRow([new Date(), id, sku, name, type, change, before, after,
    (reason || '-') + (user ? ' | โดย ' + user : '')]);
  sheet.getRange(sheet.getLastRow(), 1).setNumberFormat('dd/mm/yyyy hh:mm:ss');
}

function getLogsForApi_(productId) {
  var sheet = shLog_();
  var last = sheet.getLastRow();
  if (last < 2) return { success: true, items: [] };
  var rows = sheet.getRange(2, 1, last - 1, H_LOG.length).getValues();
  var items = rows.filter(function (row) {
    return !productId || String(row[1] || '') === String(productId);
  }).map(function (row) {
    return {
      timestamp: fmt_(row[0]), productId: String(row[1] || ''), sku: String(row[2] || ''),
      name: String(row[3] || ''), type: String(row[4] || ''), change: Number(row[5]) || 0,
      before: Number(row[6]) || 0, after: Number(row[7]) || 0, reason: String(row[8] || '')
    };
  }).reverse();
  return { success: true, items: items };
}

function setup() {
  var properties = PropertiesService.getScriptProperties();
  var sheetId = properties.getProperty('STOCK_SPREADSHEET_ID') || CFG.SHEET_ID;
  if (properties.getProperty('STOCK_ALLOW_SETUP') !== 'YES' ||
      !sheetId || properties.getProperty('STOCK_SETUP_SPREADSHEET_ID') !== sheetId) {
    throw new Error('หยุดการตั้งค่า: อนุมัติ STOCK_ALLOW_SETUP และสำเนา Sheet ที่ตรงกันก่อน');
  }
  shProduct_();
  shLog_();
  return { success: true };
}
