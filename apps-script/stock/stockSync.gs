var STOCK_SYNC_BATCH_SIZE_ = 200;

function stockSpreadsheet_() {
  return ss_();
}

function stockSyncProperties_() {
  var properties = PropertiesService.getScriptProperties();
  var sheetId = properties.getProperty('STOCK_SPREADSHEET_ID') || CFG.SHEET_ID;
  var setupId = properties.getProperty('STOCK_SETUP_SPREADSHEET_ID');
  var syncId = properties.getProperty('STOCK_SYNC_SPREADSHEET_ID');
  if (!sheetId) throw new Error('ตั้งค่า STOCK_SPREADSHEET_ID ใน Script Properties ก่อน');
  return {
    properties: properties,
    sheetId: sheetId,
    setupApproved: properties.getProperty('STOCK_ALLOW_METADATA_SETUP') === 'YES' && setupId === sheetId,
    syncApproved: properties.getProperty('STOCK_ALLOW_SYNC') === 'YES' && syncId === sheetId,
    migrationApproved: properties.getProperty('STOCK_ALLOW_MIGRATION') === 'YES' &&
      properties.getProperty('STOCK_MIGRATION_SPREADSHEET_ID') === sheetId
  };
}

function stockSyncColumns_() {
  var properties = stockSyncProperties_().properties;
  var start = Number(properties.getProperty('STOCK_SYNC_META_START_COL')) || 0;
  return start ? { id: start, deletedAt: start + 1, revision: start + 2, hash: start + 3, logId: start + 4 } : null;
}

function stockRequireSyncColumns_() {
  var columns = stockSyncColumns_();
  if (!columns) throw new Error('เรียก stockSetupSyncMetadata บนสำเนาทดสอบก่อน');
  return columns;
}

function stockRequireSyncApproval_() {
  var config = stockSyncProperties_();
  if (!config.syncApproved || ss_().getId() !== config.sheetId) {
    throw new Error('หยุด Stock sync: ตั้ง STOCK_ALLOW_SYNC=YES และ STOCK_SYNC_SPREADSHEET_ID ให้ตรงกับ Sheet ที่อนุมัติ');
  }
}

function stockSyncHealth_() {
  stockRequireSyncApproval_();
  stockRequireSyncColumns_();
  return { success: true, module: 'stock', ready: true };
}

function stockRequireMigrationApproval_() {
  var config = stockSyncProperties_();
  if (!config.migrationApproved || ss_().getId() !== config.sheetId) {
    throw new Error('หยุด Stock migration: ตั้ง STOCK_ALLOW_MIGRATION=YES และ STOCK_MIGRATION_SPREADSHEET_ID ให้ตรงกับสำเนาทดสอบที่อนุมัติ');
  }
}

function stockSyncHash_(row) {
  var canonical = JSON.stringify(row.slice(0, H_PRODUCT.length).map(function (value) {
    return value instanceof Date ? value.toISOString() : value;
  }));
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical)
  );
}

function stockValidateSyncId_(value) {
  var id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(id)) throw new Error('Firestore Stock ID ไม่ถูกต้อง');
  return id;
}

function stockDateFromValue_(value, fallback) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (value && typeof value === 'object') {
    var seconds = Number(value.seconds !== undefined ? value.seconds : value._seconds);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000);
  }
  if (value) {
    var parsed = new Date(value);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return fallback || new Date();
}

function stockRowToRecord_(row, id, revision, rowNumber) {
  return {
    id: id,
    legacyId: String(row[0] || ''),
    sku: String(row[1] || '').trim().toUpperCase(),
    normalizedSku: String(row[1] || '').trim().toLowerCase(),
    name: String(row[2] || '').trim(),
    material: String(row[3] || '').trim(),
    customer: String(row[4] || '').trim(),
    qty: Number(row[5]) || 0,
    minQty: Number(row[6]) || 0,
    unit: String(row[7] || 'ชิ้น').trim(),
    imageId: String(row[8] || ''),
    createdAt: row[9] instanceof Date ? row[9].toISOString() : String(row[9] || ''),
    updatedAt: row[10] instanceof Date ? row[10].toISOString() : String(row[10] || ''),
    sheetRow: rowNumber,
    revision: revision,
    sheetSync: { status: 'synced', updatedAt: new Date().toISOString(), error: '' }
  };
}

function stockFindSheetRowByFirestoreId_(sheet, firestoreId) {
  var columns = stockRequireSyncColumns_();
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var ids = sheet.getRange(2, columns.id, last - 1, 1).getValues();
  for (var index = 0; index < ids.length; index++) {
    if (String(ids[index][0] || '') === firestoreId) return index + 2;
  }
  return 0;
}

function stockRecordConflict_(source, id, firestoreRecord, sheetRow) {
  stockFirestorePatch_('syncConflicts', Utilities.getUuid().replace(/-/g, ''), {
    module: 'stock',
    entityId: id,
    source: source,
    firestoreRecord: firestoreRecord,
    sheetRow: sheetRow.map(function (value) {
      return value instanceof Date ? value.toISOString() : value;
    }),
    createdAt: new Date().toISOString(),
    status: 'open'
  });
}

function stockSyncFromFirestore_(data) {
  stockRequireSyncApproval_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return stockSyncFromFirestoreUnlocked_(data);
  } finally {
    lock.releaseLock();
  }
}

function stockSyncAction_(data) {
  return stockSyncFromFirestore_(data);
}

function stockSyncFromFirestoreUnlocked_(data) {
  var columns = stockRequireSyncColumns_();
  var id = stockValidateSyncId_(data && data.id);
  var record = stockFirestoreGet_('inventory', id);
  var revision = Number(record && record.revision);
  if (!record || !Number.isInteger(revision) || revision < 1) {
    throw new Error('ไม่พบข้อมูล Stock ที่บันทึกใน Firebase หรือ revision ไม่ถูกต้อง');
  }
  var sheet = shProduct_();
  var rowNumber = stockFindSheetRowByFirestoreId_(sheet, id);
  var width = columns.logId;

  if (record.deletedAt) {
    if (!rowNumber) return { success: true, id: id, deleted: true };
    var current = sheet.getRange(rowNumber, 1, 1, width).getValues()[0];
    var currentRevision = Number(current[columns.revision - 1]) || 0;
    if (currentRevision > revision) {
      stockRecordConflict_('web', id, record, current);
      throw new Error('ข้อมูล Stock ใน Google Sheets ใหม่กว่า Firebase; บันทึก conflict ไว้แล้ว');
    }
    sheet.getRange(rowNumber, columns.deletedAt).setValue(String(record.deletedAt));
    sheet.getRange(rowNumber, columns.revision).setValue(revision);
    return { success: true, id: id, deleted: true };
  }

  var sku = String(record.sku || '').trim().toUpperCase();
  var name = String(record.name || '').trim();
  var qty = Number(record.qty);
  var minQty = Number(record.minQty) || 0;
  if (!sku || !name || !Number.isFinite(qty) || qty < 0 || !Number.isFinite(minQty) || minQty < 0) {
    throw new Error('ข้อมูล Stock ต้องมี SKU/ชื่อสินค้าและจำนวนไม่ติดลบ');
  }
  var last = sheet.getLastRow();
  var rows = last >= 2 ? sheet.getRange(2, 1, last - 1, width).getValues() : [];
  var duplicate = rows.some(function (existing, index) {
    return index + 2 !== rowNumber &&
      !existing[columns.deletedAt - 1] &&
      String(existing[1] || '').trim().toUpperCase() === sku;
  });
  if (duplicate) throw new Error('รหัสสินค้า "' + sku + '" ซ้ำใน Google Sheets');
  if (!rowNumber) rowNumber = Math.max(2, last + 1);

  var existingRow = sheet.getRange(rowNumber, 1, 1, width).getValues()[0];
  var sheetRevision = Number(existingRow[columns.revision - 1]) || 0;
  var storedHash = String(existingRow[columns.hash - 1] || '');
  if (existingRow[columns.id - 1] && storedHash && stockSyncHash_(existingRow) !== storedHash) {
    stockRecordConflict_('web', id, record, existingRow);
    throw new Error('พบการแก้ไข Stock ใน Google Sheets ที่ยังไม่ซิงก์; บันทึก conflict ไว้ตรวจสอบแล้ว');
  }
  if (sheetRevision > revision) {
    stockRecordConflict_('web', id, record, existingRow);
    throw new Error('ข้อมูล Stock ใน Google Sheets ใหม่กว่า Firebase; บันทึก conflict ไว้แล้ว');
  }
  var values = [
    String(record.legacyId || existingRow[0] || Utilities.getUuid()),
    sku,
    name,
    String(record.material || ''),
    String(record.customer || ''),
    qty,
    minQty,
    String(record.unit || 'ชิ้น'),
    String(record.imageId || ''),
    existingRow[9] || stockDateFromValue_(record.createdAt, new Date()),
    new Date()
  ];
  var beforeQty = Number(existingRow[5]) || 0;
  var hash = stockSyncHash_(values);
  var logId = String(record.lastStockLogId || existingRow[columns.logId - 1] || '').trim();
  var logWrite = null;
  if (record.lastStockChange || !existingRow[0] || beforeQty !== qty) {
    if (!logId) {
      logId = 'web-' + Utilities.base64EncodeWebSafe(
        Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, id + ':' + revision)
      ).slice(0, 40);
    }
    var change = record.lastStockChange || {};
    logWrite = {
      collection: 'stockLogs',
      id: logId,
      data: {
        id: logId,
        productId: id,
        legacyProductId: values[0],
        sku: sku,
        name: name,
        type: change.type || (existingRow[0] ? 'EDIT' : 'NEW'),
        change: change.change !== undefined ? Number(change.change) : qty - beforeQty,
        before: change.before !== undefined ? Number(change.before) : beforeQty,
        after: change.after !== undefined ? Number(change.after) : qty,
        reason: change.reason || (existingRow[0] ? 'แก้ไขข้อมูลผ่านเว็บ' : 'เพิ่มสินค้าใหม่เข้าระบบ'),
        createdAt: new Date().toISOString()
      }
    };
  }
  var productData = stockRowToRecord_(values, id, revision, rowNumber);
  if (record.lastStockLogId) productData.lastStockLogId = logId;
  productData.sheetRow = rowNumber;
  productData.sheetSync = { status: 'synced', updatedAt: new Date().toISOString(), error: '' };
  var writes = [{
    collection: 'inventory',
    id: id,
    data: productData
  }];
  if (logWrite && !stockFirestoreGet_('stockLogs', logId)) writes.push(logWrite);
  stockFirestoreCommit_(writes);
  sheet.getRange(rowNumber, 1, 1, H_PRODUCT.length).setValues([values]);
  sheet.getRange(rowNumber, columns.id, 1, 5).setValues([[id, '', revision, hash, logId]]);
  return { success: true, id: id, row: rowNumber, revision: revision };
}

function stockSyncSheetRowToFirestore_(sheet, rowNumber) {
  var columns = stockRequireSyncColumns_();
  if (rowNumber < 2) return;
  var row = sheet.getRange(rowNumber, 1, 1, columns.logId).getValues()[0];
  var id = String(row[columns.id - 1] || '').trim();
  if (row[columns.deletedAt - 1]) return;
  if (!String(row[0] || '').trim() && !String(row[1] || '').trim()) {
    if (id) stockDeleteSheetRow_(sheet, rowNumber, id, row, columns);
    return;
  }
  if (!id) {
    id = Utilities.getUuid().replace(/-/g, '');
    sheet.getRange(rowNumber, columns.id).setValue(id);
  }
  var hash = stockSyncHash_(row);
  if (hash === String(row[columns.hash - 1] || '')) return;
  var current = stockFirestoreGet_('inventory', id);
  var sheetRevision = Number(row[columns.revision - 1]) || 0;
  var currentRevision = current ? Number(current.revision) || 0 : 0;
  if (current && currentRevision > sheetRevision) {
    var sameAsCurrent = String(row[1] || '').trim().toUpperCase() === String(current.sku || '').trim().toUpperCase() &&
      String(row[2] || '').trim() === String(current.name || '').trim() &&
      String(row[3] || '').trim() === String(current.material || '').trim() &&
      String(row[4] || '').trim() === String(current.customer || '').trim() &&
      Number(row[5]) === Number(current.qty) &&
      Number(row[6]) === Number(current.minQty) &&
      String(row[7] || 'ชิ้น').trim() === String(current.unit || 'ชิ้น').trim() &&
      String(row[8] || '') === String(current.imageId || '');
    if (!sameAsCurrent) {
      stockRecordConflict_('sheet', id, current, row);
      return;
    }
  }
  var revision = currentRevision > sheetRevision ? currentRevision : currentRevision + 1;
  var record = stockRowToRecord_(row, id, revision, rowNumber);
  if (!record.sku || !record.name || record.qty < 0 || record.minQty < 0) {
    throw new Error('แถว Stock ต้องมี SKU/ชื่อสินค้าและจำนวนไม่ติดลบ');
  }
  var before = current ? Number(current.qty) || 0 : 0;
  var logId = '';
  var logWrite = null;
  if (!current || before !== record.qty) {
    if (!logId) {
      logId = (current ? 'sheet-' : 'sheet-new-') + Utilities.base64EncodeWebSafe(
        Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, id + ':' + hash)
      ).slice(0, 40);
      sheet.getRange(rowNumber, columns.logId).setValue(logId);
    }
    logWrite = {
      collection: 'stockLogs',
      id: logId,
      data: {
        id: logId, productId: id, sku: record.sku, name: record.name,
        type: current ? 'SHEET_EDIT' : 'NEW',
        change: record.qty - before, before: before,
        after: record.qty, reason: current ? 'แก้ไขจาก Google Sheets' : 'เพิ่มสินค้าจาก Google Sheets',
        createdAt: new Date().toISOString()
      }
    };
  }
  var writes = [{ collection: 'inventory', id: id, data: record }];
  if (logWrite && !stockFirestoreGet_('stockLogs', logId)) writes.push(logWrite);
  stockFirestoreCommit_(writes);
  sheet.getRange(rowNumber, columns.revision).setValue(revision);
  sheet.getRange(rowNumber, columns.hash).setValue(hash);
}

function stockDeleteSheetRow_(sheet, rowNumber, id, row, columns) {
  var current = stockFirestoreGet_('inventory', id);
  if (!current || current.deletedAt) {
    sheet.getRange(rowNumber, columns.deletedAt).setValue(new Date());
    return;
  }
  var sheetRevision = Number(row[columns.revision - 1]) || 0;
  var currentRevision = Number(current.revision) || 0;
  if (currentRevision > sheetRevision) {
    stockRecordConflict_('sheet', id, current, row);
    return;
  }
  var revision = currentRevision + 1;
  var deletedAt = new Date().toISOString();
  stockFirestorePatch_('inventory', id, {
    deletedAt: deletedAt,
    revision: revision,
    updatedAt: deletedAt,
    sheetSync: { status: 'synced', updatedAt: deletedAt, error: '' }
  });
  sheet.getRange(rowNumber, columns.deletedAt, 1, 3).setValues([[deletedAt, revision, stockSyncHash_(row)]]);
}

function stockHandleSheetEdit_(event) {
  stockRequireSyncApproval_();
  if (!event || !event.range || event.range.getSheet().getName() !== CFG.SH_PRODUCT) return;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var firstRow = Math.max(2, event.range.getRow());
    var lastRow = event.range.getRow() + event.range.getNumRows() - 1;
    var sheet = event.range.getSheet();
    for (var row = firstRow; row <= lastRow; row++) stockSyncSheetRowToFirestore_(sheet, row);
  } finally {
    lock.releaseLock();
  }
}

function stockReconcileBatchToFirestore_() {
  stockRequireSyncApproval_();
  var columns = stockRequireSyncColumns_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = shProduct_();
    var last = sheet.getLastRow();
    if (last < 2) return { success: true, scanned: 0 };
    var properties = stockSyncProperties_().properties;
    var cursor = Number(properties.getProperty('STOCK_RECONCILE_CURSOR')) || 2;
    if (cursor > last) cursor = 2;
    var count = Math.min(50, last - cursor + 1);
    for (var row = cursor; row < cursor + count; row++) stockSyncSheetRowToFirestore_(sheet, row);
    var next = cursor + count > last ? 2 : cursor + count;
    properties.setProperty('STOCK_RECONCILE_CURSOR', String(next));
    return { success: true, scanned: count, nextRow: next, totalRows: last, metadataColumn: columns.id };
  } finally {
    lock.releaseLock();
  }
}

function stockSetupSyncMetadata() {
  var config = stockSyncProperties_();
  if (!config.setupApproved || ss_().getId() !== config.sheetId) {
    throw new Error('หยุดการแก้ Sheet: ตั้ง STOCK_ALLOW_METADATA_SETUP=YES และ STOCK_SETUP_SPREADSHEET_ID ให้ตรงกับสำเนาทดสอบ');
  }
  var sheet = shProduct_();
  var properties = config.properties;
  var start = Number(properties.getProperty('STOCK_SYNC_META_START_COL')) || Math.max(H_PRODUCT.length + 1, sheet.getLastColumn() + 1);
  if (sheet.getMaxColumns() < start + 4) sheet.insertColumnsAfter(sheet.getMaxColumns(), start + 4 - sheet.getMaxColumns());
  properties.setProperty('STOCK_SYNC_META_START_COL', String(start));
  sheet.getRange(1, start, 1, 5).setValues([[
    '_firestore_id', '_deleted_at', '_revision', '_sync_hash', '_last_log_id'
  ]]);
  sheet.hideColumns(start, 5);
  return { success: true, spreadsheetId: config.sheetId, metadataStartColumn: start };
}

function stockInstallEditTrigger() {
  stockRequireSyncApproval_();
  stockRequireSyncColumns_();
  var spreadsheet = stockSpreadsheet_();
  var existing = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === 'stockHandleSheetEdit_';
  });
  if (!existing) ScriptApp.newTrigger('stockHandleSheetEdit_').forSpreadsheet(spreadsheet).onEdit().create();
  return { success: true, alreadyInstalled: existing };
}

function stockInstallReconciliationTrigger() {
  stockRequireSyncApproval_();
  stockRequireSyncColumns_();
  var existing = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === 'stockReconcileBatchToFirestore_';
  });
  if (!existing) ScriptApp.newTrigger('stockReconcileBatchToFirestore_').timeBased().everyMinutes(15).create();
  return { success: true, alreadyInstalled: existing };
}

function stockInstallChangeTrigger() {
  stockRequireSyncApproval_();
  stockRequireSyncColumns_();
  var spreadsheet = stockSpreadsheet_();
  var existing = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === 'stockHandleSheetChange_';
  });
  if (!existing) ScriptApp.newTrigger('stockHandleSheetChange_').forSpreadsheet(spreadsheet).onChange().create();
  return { success: true, alreadyInstalled: existing };
}

function stockHandleSheetChange_(event) {
  stockRequireSyncApproval_();
  if (!event || event.changeType !== 'REMOVE_ROW') return;
  var properties = stockSyncProperties_().properties;
  if (properties.getProperty('STOCK_MIGRATION_COMPLETE') !== 'YES') return;
  stockReconcileDeletedSheetRows_();
}

function stockReconcileDeletedSheetRows_() {
  var columns = stockRequireSyncColumns_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = shProduct_();
    var last = sheet.getLastRow();
    var sheetIds = {};
    if (last >= 2) {
      sheet.getRange(2, columns.id, last - 1, 1).getValues().forEach(function (row) {
        var id = String(row[0] || '').trim();
        if (id) sheetIds[id] = true;
      });
    }
    var documents = stockFirestoreList_('inventory');
    var missing = documents.filter(function (item) {
      return !item.data.deletedAt && !sheetIds[item.id];
    });
    for (var offset = 0; offset < missing.length; offset += 400) {
      var batch = missing.slice(offset, offset + 400).map(function (item) {
        var deletedAt = new Date().toISOString();
        return {
          collection: 'inventory',
          id: item.id,
          data: {
            deletedAt: deletedAt,
            updatedAt: deletedAt,
            revision: (Number(item.data.revision) || 0) + 1,
            sheetSync: { status: 'synced', updatedAt: deletedAt, error: '' }
          }
        };
      });
      if (batch.length) stockFirestoreCommit_(batch);
    }
    return { success: true, scannedRows: Math.max(0, last - 1), tombstones: missing.length };
  } finally {
    lock.releaseLock();
  }
}

function stockValidateMigrationRows_(sheet, lastRow, columns) {
  if (lastRow < 2) return;
  var rows = sheet.getRange(2, 1, lastRow - 1, columns.logId).getValues();
  var ids = {};
  var skus = {};
  rows.forEach(function (row) {
    if (row[columns.deletedAt - 1] || (!String(row[0] || '').trim() && !String(row[1] || '').trim())) return;
    var id = String(row[columns.id - 1] || '').trim();
    var sku = String(row[1] || '').trim().toUpperCase();
    if (id && ids[id]) throw new Error('Stable ID ซ้ำใน Stock Sheet: ' + id);
    if (sku && skus[sku]) throw new Error('SKU ซ้ำใน Stock Sheet: ' + sku);
    if (id) ids[id] = true;
    if (sku) skus[sku] = true;
    var qty = Number(row[5]);
    var minQty = Number(row[6]);
    if (!sku || !String(row[2] || '').trim() ||
        !Number.isFinite(qty) || qty < 0 || !Number.isFinite(minQty) || minQty < 0) {
      throw new Error('พบแถว Stock ที่ข้อมูลไม่ครบหรือจำนวนติดลบ');
    }
  });
}

function stockMigrateBatchToFirestore() {
  stockRequireMigrationApproval_();
  var columns = stockRequireSyncColumns_();
  var properties = stockSyncProperties_().properties;
  var sheet = shProduct_();
  var last = sheet.getLastRow();
  stockValidateMigrationRows_(sheet, last, columns);
  var cursor = Number(properties.getProperty('STOCK_MIGRATION_CURSOR')) || 2;
  if (cursor > last) {
    properties.setProperty('STOCK_MIGRATION_COMPLETE', 'YES');
    return { success: true, done: true, nextRow: cursor, totalRows: last };
  }
  var count = Math.min(STOCK_SYNC_BATCH_SIZE_, last - cursor + 1);
  var rows = sheet.getRange(cursor, 1, count, columns.logId).getValues();
  var writes = [];
  var metadata = [];
  rows.forEach(function (row, index) {
    if ((!String(row[0] || '').trim() && !String(row[1] || '').trim()) || row[columns.deletedAt - 1]) {
      metadata.push([row[columns.id - 1] || '', row[columns.deletedAt - 1] || '', row[columns.revision - 1] || '', row[columns.hash - 1] || '', row[columns.logId - 1] || '']);
      return;
    }
    var id = String(row[columns.id - 1] || '').trim() || Utilities.getUuid().replace(/-/g, '');
    var revision = Math.max(1, Number(row[columns.revision - 1]) || 0);
    var record = stockRowToRecord_(row, id, revision, cursor + index);
    var hash = stockSyncHash_(row);
    writes.push({ collection: 'inventory', id: id, data: record });
    metadata.push([id, '', revision, hash, row[columns.logId - 1] || '']);
  });
  sheet.getRange(cursor, columns.id, count, 5).setValues(metadata);
  if (writes.length) stockFirestoreCommit_(writes);
  var nextRow = cursor + count;
  properties.setProperty('STOCK_MIGRATION_CURSOR', String(nextRow));
  properties.setProperty('STOCK_MIGRATION_IMPORTED', String((Number(properties.getProperty('STOCK_MIGRATION_IMPORTED')) || 0) + writes.length));
  if (nextRow > last) properties.setProperty('STOCK_MIGRATION_COMPLETE', 'YES');
  return {
    success: true, done: nextRow > last, importedThisBatch: writes.length,
    importedTotal: Number(properties.getProperty('STOCK_MIGRATION_IMPORTED')),
    nextRow: nextRow, totalRows: last
  };
}

function stockMigrateLogsBatchToFirestore() {
  stockRequireMigrationApproval_();
  var properties = stockSyncProperties_().properties;
  var sheet = shLog_();
  var last = sheet.getLastRow();
  var cursor = Number(properties.getProperty('STOCK_LOG_MIGRATION_CURSOR')) || 2;
  if (cursor > last) return { success: true, done: true, nextRow: cursor, totalRows: last };
  var count = Math.min(STOCK_SYNC_BATCH_SIZE_, last - cursor + 1);
  var rows = sheet.getRange(cursor, 1, count, H_LOG.length).getValues();
  var syncColumns = stockRequireSyncColumns_();
  var productSheet = shProduct_();
  var productLast = productSheet.getLastRow();
  var productIds = {};
  if (productLast >= 2) {
    productSheet.getRange(2, 1, productLast - 1, syncColumns.id).getValues().forEach(function (row) {
      if (row[0] && row[syncColumns.id - 1]) productIds[String(row[0])] = String(row[syncColumns.id - 1]);
    });
  }
  var writes = [];
  rows.forEach(function (row, index) {
    if (!row[1] && !row[2]) return;
    var id = stockLegacyLogId_(row, cursor + index);
    var timestamp = row[0] instanceof Date ? row[0].toISOString() : String(row[0] || '');
    writes.push({
      collection: 'stockLogs',
      id: id,
      data: {
        id: id,
        productId: productIds[String(row[1])] || String(row[1] || ''),
        legacyProductId: String(row[1] || ''),
        sku: String(row[2] || ''),
        name: String(row[3] || ''),
        type: String(row[4] || ''),
        change: Number(row[5]) || 0,
        before: Number(row[6]) || 0,
        after: Number(row[7]) || 0,
        reason: String(row[8] || ''),
        createdAt: timestamp
      }
    });
  });
  if (writes.length) stockFirestoreCommit_(writes);
  properties.setProperty('STOCK_LOG_MIGRATION_CURSOR', String(cursor + count));
  properties.setProperty('STOCK_LOG_MIGRATION_IMPORTED', String((Number(properties.getProperty('STOCK_LOG_MIGRATION_IMPORTED')) || 0) + writes.length));
  return {
    success: true, done: cursor + count > last, importedThisBatch: writes.length,
    importedTotal: Number(properties.getProperty('STOCK_LOG_MIGRATION_IMPORTED')),
    nextRow: cursor + count, totalRows: last
  };
}

function stockLegacyLogId_(row, rowNumber) {
  return 'legacy-' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      JSON.stringify([rowNumber, row[0], row[1], row[4], row[5]])
    )
  ).slice(0, 40);
}

function stockMigrationAudit() {
  stockRequireMigrationApproval_();
  var columns = stockRequireSyncColumns_();
  var sheet = shProduct_();
  var last = sheet.getLastRow();
  var rows = last >= 2 ? sheet.getRange(2, 1, last - 1, columns.logId).getValues() : [];
  var sheetItems = {};
  rows.forEach(function (row) {
    if (!row[0] && !row[1] || row[columns.deletedAt - 1]) return;
    var id = String(row[columns.id - 1] || '');
    if (id) sheetItems[id] = row;
  });
  var firestoreItems = {};
  stockFirestoreList_('inventory').forEach(function (item) {
    if (!item.data.deletedAt) firestoreItems[item.id] = item.data;
  });
  var missingInFirestore = Object.keys(sheetItems).filter(function (id) { return !firestoreItems[id]; });
  var extraInFirestore = Object.keys(firestoreItems).filter(function (id) { return !sheetItems[id]; });
  var mismatched = Object.keys(sheetItems).filter(function (id) {
    var data = firestoreItems[id];
    if (!data) return false;
    var row = sheetItems[id];
    return String(row[1] || '').trim().toUpperCase() !== String(data.sku || '').trim().toUpperCase() ||
      String(row[2] || '').trim() !== String(data.name || '').trim() ||
      String(row[3] || '').trim() !== String(data.material || '').trim() ||
      String(row[4] || '').trim() !== String(data.customer || '').trim() ||
      Number(row[5]) !== Number(data.qty) ||
      Number(row[6]) !== Number(data.minQty) ||
      String(row[7] || 'ชิ้น').trim() !== String(data.unit || 'ชิ้น').trim() ||
      String(row[8] || '') !== String(data.imageId || '');
  });
  var logSheet = shLog_();
  var lastLogRow = logSheet.getLastRow();
  var logRows = lastLogRow >= 2
    ? logSheet.getRange(2, 1, lastLogRow - 1, H_LOG.length).getValues()
    : [];
  var expectedLogIds = {};
  logRows.forEach(function (row, index) {
    if (row[1] || row[2]) expectedLogIds[stockLegacyLogId_(row, index + 2)] = true;
  });
  var firestoreLogIds = {};
  stockFirestoreList_('stockLogs').forEach(function (item) { firestoreLogIds[item.id] = true; });
  var missingLogs = Object.keys(expectedLogIds).filter(function (id) { return !firestoreLogIds[id]; });
  return {
    success: true,
    sheetCount: Object.keys(sheetItems).length,
    firestoreCount: Object.keys(firestoreItems).length,
    missingInFirestore: missingInFirestore,
    extraInFirestore: extraInFirestore,
    mismatched: mismatched,
    sheetLogCount: Object.keys(expectedLogIds).length,
    firestoreLegacyLogCount: Object.keys(expectedLogIds).filter(function (id) { return firestoreLogIds[id]; }).length,
    missingLegacyLogs: missingLogs
  };
}

function stockResetMigrationCursor() {
  stockRequireMigrationApproval_();
  var properties = stockSyncProperties_().properties;
  [
    'STOCK_MIGRATION_CURSOR', 'STOCK_MIGRATION_IMPORTED',
    'STOCK_LOG_MIGRATION_CURSOR', 'STOCK_LOG_MIGRATION_IMPORTED',
    'STOCK_MIGRATION_COMPLETE'
  ].forEach(function (key) { properties.deleteProperty(key); });
  return { success: true };
}
