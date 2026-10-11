var PO_TRACKER_CFG = {
  SHEET_ID: '1KGghrQJ7po1w_FElfRxznyvMc2qkW3Wv0nkO6O6a0ik',
  PO_SHEET: 'PO tracker',
  CUSTOMER_SHEET: 'Sheet1',
  START_ROW: 3,
  START_COL: 1,
  NUM_COLS: 11,
  SYNC_BATCH_SIZE: 200,
  TIMEZONE: 'Asia/Bangkok'
};

var PO_TRACKER_COL = {
  PO: 1, CUSTOMER: 2, QUOTATION: 3, PO_DATE: 4, AMOUNT: 5,
  INVOICE: 6, INVOICE_DATE: 7, CREDIT: 8, DUE_DATE: 9,
  PAYMENT_STATUS: 10, DELIVERY: 11
};

function poSyncColumns_() {
  var properties = PropertiesService.getScriptProperties();
  var poStart = Number(properties.getProperty('PO_SYNC_PO_META_COL')) || 0;
  var customerId = Number(properties.getProperty('PO_SYNC_CUSTOMER_ID_COL')) || 0;
  return poStart ? {
    id: poStart,
    deletedAt: poStart + 1,
    revision: poStart + 2,
    hash: poStart + 3,
    customerId: customerId
  } : null;
}

function poTombstoneSheetRow_(sheet, row, id, values, columns) {
  var current = firebaseGetDocument_('purchaseOrders', id);
  if (!current || current.deletedAt) return;
  var sheetRevision = poNumber_(values[columns.revision - 1]);
  var currentRevision = poNumber_(current.revision);
  if (currentRevision > sheetRevision) {
    poRecordSyncConflict_('sheet', id, current, values);
    return;
  }
  var deletedAt = new Date().toISOString();
  var revision = currentRevision + 1;
  firebasePatchDocument_('purchaseOrders', id, {
    deletedAt: deletedAt,
    revision: revision,
    updatedAt: deletedAt,
    sheetSync: { status: 'synced', updatedAt: deletedAt, error: '' }
  });
  sheet.getRange(row, columns.deletedAt).setValue(deletedAt);
  sheet.getRange(row, columns.revision).setValue(revision);
}

function poHandleSheetChange_(event) {
  poRequireSyncApproval_();
  if (!event || event.changeType !== 'REMOVE_ROW') return;
  if (PropertiesService.getScriptProperties().getProperty('PO_MIGRATION_COMPLETE') !== 'YES') return;
  poReconcileDeletedRows_();
}

function poReconcileDeletedRows_() {
  var columns = poRequireSyncColumns_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = poSheet_(PO_TRACKER_CFG.PO_SHEET);
    var last = poLastDataRow_(sheet);
    var sheetIds = {};
    if (last >= PO_TRACKER_CFG.START_ROW) {
      sheet.getRange(
        PO_TRACKER_CFG.START_ROW, columns.id, last - PO_TRACKER_CFG.START_ROW + 1, 1
      ).getValues().forEach(function (row) {
        var id = String(row[0] || '').trim();
        if (id) sheetIds[id] = true;
      });
    }
    var documents = firebaseListDocuments_('purchaseOrders');
    var missing = documents.filter(function (item) {
      return !item.data.deletedAt && !sheetIds[item.id];
    });
    for (var offset = 0; offset < missing.length; offset += 400) {
      var now = new Date().toISOString();
      firebaseCommitPatches_(missing.slice(offset, offset + 400).map(function (item) {
        return {
          collection: 'purchaseOrders',
          id: item.id,
          data: {
            deletedAt: now,
            updatedAt: now,
            revision: poNumber_(item.data.revision) + 1,
            sheetSync: { status: 'synced', updatedAt: now, error: '' }
          }
        };
      }));
    }
    return { success: true, scannedRows: Math.max(0, last - PO_TRACKER_CFG.START_ROW + 1), tombstones: missing.length };
  } finally {
    lock.releaseLock();
  }
}

function poReadWidth_() {
  var columns = poSyncColumns_();
  return columns ? columns.hash : PO_TRACKER_CFG.NUM_COLS;
}

function poRequireSyncColumns_() {
  var columns = poSyncColumns_();
  if (!columns || !columns.customerId) {
    throw new Error('เรียก poSetupSyncMetadata บนสำเนาทดสอบก่อนตั้งค่า Sync');
  }
  return columns;
}

function poSpreadsheet_() {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty('PO_SPREADSHEET_ID') ||
    PO_TRACKER_CFG.SHEET_ID;
  if (!spreadsheetId) throw new Error('ตั้งค่า PO_SPREADSHEET_ID ใน Script Properties ก่อน');
  return SpreadsheetApp.openById(spreadsheetId);
}

function poSheet_(name) {
  var sheet = poSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('ไม่พบแผ่นงานชื่อ "' + name + '"');
  return sheet;
}

function poDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  if (!value) return null;
  var date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function poDateText_(value, pattern) {
  var date = poDate_(value);
  return date ? Utilities.formatDate(date, PO_TRACKER_CFG.TIMEZONE, pattern) : '';
}

function poNumber_(value) {
  if (typeof value === 'number') return value;
  var number = parseFloat(String(value || '').replace(/[^0-9.\-]/g, ''));
  return isNaN(number) ? 0 : number;
}

function poIsPaid_(status) {
  var value = String(status || '').toLowerCase().trim();
  return /(paid|รับแล้ว|ได้รับ|ชำระแล้ว|จ่ายแล้ว|เรียบร้อย)/.test(value) && !/unpaid|ยังไม่/.test(value);
}

function poIsDelivered_(status) {
  return /(ส่งแล้ว|ส่งของแล้ว|จัดส่งแล้ว|delivered|shipped)/.test(String(status || '').toLowerCase().trim());
}

function poDaysLeft_(dueDate) {
  var due = poDate_(dueDate);
  if (!due) return null;
  var today = new Date();
  var todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  var dueUtc = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate());
  return Math.round((dueUtc - todayUtc) / 86400000);
}

function poLastDataRow_(sheet) {
  var last = sheet.getLastRow();
  if (last < PO_TRACKER_CFG.START_ROW) return PO_TRACKER_CFG.START_ROW - 1;
  var rows = sheet.getRange(PO_TRACKER_CFG.START_ROW, 1, last - PO_TRACKER_CFG.START_ROW + 1, 3).getValues();
  for (var index = rows.length - 1; index >= 0; index--) {
    if (String(rows[index][0]).trim() || String(rows[index][1]).trim() || String(rows[index][2]).trim()) {
      return PO_TRACKER_CFG.START_ROW + index;
    }
  }
  return PO_TRACKER_CFG.START_ROW - 1;
}

function poCustomers_() {
  var spreadsheet = poSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(PO_TRACKER_CFG.CUSTOMER_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(PO_TRACKER_CFG.CUSTOMER_SHEET);
    sheet.getRange(1, 1).setValue('Customer Name').setFontWeight('bold');
    return [];
  }
  if (sheet.getLastRow() < 1) return [];
  return sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues().map(function (row) {
    return String(row[0] || '').trim();
  }).filter(function (name) {
    return name && !/(customer|ชื่อลูกค้า)/i.test(name);
  }).sort();
}

function poEnsureCustomer_(sheet, customerName) {
  var name = String(customerName || '').trim();
  if (!name) return;
  var last = sheet.getLastRow();
  var names = last ? sheet.getRange(1, 1, last, 1).getValues() : [];
  var exists = names.some(function (row) {
    return String(row[0] || '').trim().toLowerCase() === name.toLowerCase();
  });
  if (!exists) sheet.appendRow([name]);
}

function poOptions_() {
  var fallback = {
    payStatus: ['Unpaid', 'Paid'],
    delivery: ['รอผลิต', 'ผลิตเสร็จ', 'ส่งของแล้ว', 'วางบิลแล้ว', 'ยกเลิก']
  };
  var sheet = poSheet_(PO_TRACKER_CFG.PO_SHEET);
  function read(column, defaults) {
    var rule = sheet.getRange(PO_TRACKER_CFG.START_ROW, column).getDataValidation();
    if (rule && rule.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
      var values = rule.getCriteriaValues()[0];
      if (values && values.length) return values.map(String);
    }
    return defaults;
  }
  return {
    payStatus: read(PO_TRACKER_COL.PAYMENT_STATUS, fallback.payStatus),
    delivery: read(PO_TRACKER_COL.DELIVERY, fallback.delivery)
  };
}

function poEmptySummary_() {
  return { total: 0, totalAmount: 0, paidAmount: 0, unpaidAmount: 0, paidCount: 0, unpaidCount: 0, overdueCount: 0, dueSoonCount: 0 };
}

function poGetPOData_() {
  var sheet = poSheet_(PO_TRACKER_CFG.PO_SHEET);
  var last = poLastDataRow_(sheet);
  var customers = poCustomers_();
  var options = poOptions_();
  if (last < PO_TRACKER_CFG.START_ROW) {
    return { success: true, records: [], summary: poEmptySummary_(), customers: customers, options: options };
  }

  var syncColumns = poSyncColumns_();
  var rows = sheet.getRange(PO_TRACKER_CFG.START_ROW, PO_TRACKER_CFG.START_COL, last - PO_TRACKER_CFG.START_ROW + 1, poReadWidth_()).getValues();
  var records = [];
  var summary = poEmptySummary_();
  rows.forEach(function (row, index) {
    if (syncColumns && row[syncColumns.deletedAt - 1]) return;
    if (!String(row[0]).trim() && !String(row[1]).trim() && !String(row[2]).trim()) return;
    var amount = poNumber_(row[4]);
    var payStatus = String(row[9] || '').trim();
    var paid = poIsPaid_(payStatus);
    var daysLeft = poDaysLeft_(row[8]);
    var state = 'unpaid';
    summary.totalAmount += amount;
    if (paid) {
      state = 'paid';
      summary.paidAmount += amount;
      summary.paidCount++;
    } else {
      summary.unpaidAmount += amount;
      summary.unpaidCount++;
      if (daysLeft !== null && daysLeft < 0) {
        state = 'overdue';
        summary.overdueCount++;
      } else if (daysLeft !== null && daysLeft <= 7) {
        state = 'duesoon';
        summary.dueSoonCount++;
      }
    }
    records.push({
      id: syncColumns ? String(row[syncColumns.id - 1] || '') : '',
      row: PO_TRACKER_CFG.START_ROW + index,
      revision: syncColumns ? poNumber_(row[syncColumns.revision - 1]) : 0,
      poNumber: String(row[0] || '').trim(),
      customer: String(row[1] || '').trim(),
      quotation: String(row[2] || '').trim(),
      poDate: poDateText_(row[3], 'dd-MMM-yy'),
      poDateISO: poDateText_(row[3], 'yyyy-MM-dd'),
      amount: amount,
      invoice: String(row[5] || '').trim(),
      invDate: poDateText_(row[6], 'dd-MMM-yy'),
      invDateISO: poDateText_(row[6], 'yyyy-MM-dd'),
      credit: poNumber_(row[7]),
      dueDate: poDateText_(row[8], 'dd-MMM-yy'),
      dueDateISO: poDateText_(row[8], 'yyyy-MM-dd'),
      payStatus: payStatus || 'Unpaid',
      delivery: String(row[10] || '').trim(),
      paid: paid,
      delivered: poIsDelivered_(row[10]),
      daysLeft: daysLeft,
      state: state
    });
  });
  summary.total = records.length;
  return { success: true, records: records, customers: customers, options: options, summary: summary };
}

function poAddCustomer_(customerName) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    var name = String(customerName || '').trim();
    if (!name) throw new Error('กรุณากรอกชื่อลูกค้า');
    var spreadsheet = poSpreadsheet_();
    var sheet = spreadsheet.getSheetByName(PO_TRACKER_CFG.CUSTOMER_SHEET);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(PO_TRACKER_CFG.CUSTOMER_SHEET);
      sheet.getRange(1, 1).setValue('Customer Name').setFontWeight('bold');
    }
    poEnsureCustomer_(sheet, name);
    return { success: true, message: 'เพิ่มลูกค้า "' + name + '" เรียบร้อย', customers: poCustomers_() };
  } finally {
    try { lock.releaseLock(); } catch (error) {}
  }
}

function poSavePO_(form, isUpdate) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    if (!form) throw new Error('ไม่พบข้อมูล');
    var customer = String(form.customer || '').trim();
    var quotation = String(form.quotation || '').trim();
    if (!customer) throw new Error('กรุณาเลือกลูกค้าจากรายการ');
    if (!quotation) throw new Error('กรุณากรอกเลขใบเสนอราคา');
    var spreadsheet = poSpreadsheet_();
    var customerSheet = spreadsheet.getSheetByName(PO_TRACKER_CFG.CUSTOMER_SHEET);
    if (!customerSheet) {
      customerSheet = spreadsheet.insertSheet(PO_TRACKER_CFG.CUSTOMER_SHEET);
      customerSheet.getRange(1, 1).setValue('Customer Name').setFontWeight('bold');
    }
    poEnsureCustomer_(customerSheet, customer);

    var credit = poNumber_(form.credit);
    var invoiceDate = poDate_(form.invDate);
    var dueDate = poDate_(form.dueDate);
    if (!dueDate && invoiceDate && credit > 0) {
      dueDate = new Date(invoiceDate.getTime());
      dueDate.setDate(dueDate.getDate() + credit);
    }
    var sheet = poSheet_(PO_TRACKER_CFG.PO_SHEET);
    var row = isUpdate ? Number(form.row) : poLastDataRow_(sheet) + 1;
    if (!row || row < PO_TRACKER_CFG.START_ROW || (isUpdate && row > sheet.getLastRow())) throw new Error('ไม่พบแถวข้อมูล');
    sheet.getRange(row, PO_TRACKER_CFG.START_COL, 1, 11).setValues([[
      String(form.poNumber || '').trim(), customer, quotation, poDate_(form.poDate) || '',
      poNumber_(form.amount), String(form.invoice || '').trim(), invoiceDate || '', credit || '',
      dueDate || '', String(form.payStatus || 'Unpaid').trim(), String(form.delivery || '').trim()
    ]]);
    sheet.getRange(row, PO_TRACKER_COL.PO_DATE).setNumberFormat('dd-mmm-yy');
    sheet.getRange(row, PO_TRACKER_COL.INVOICE_DATE).setNumberFormat('dd-mmm-yy');
    sheet.getRange(row, PO_TRACKER_COL.DUE_DATE).setNumberFormat('dd-mmm-yy');
    sheet.getRange(row, PO_TRACKER_COL.AMOUNT).setNumberFormat('#,##0.00');
    return { success: true, message: isUpdate ? 'อัปเดตข้อมูลเรียบร้อย' : 'บันทึก PO เรียบร้อย' };
  } finally {
    try { lock.releaseLock(); } catch (error) {}
  }
}

function poAddPO_(form) {
  return poSavePO_(form, false);
}

function poUpdatePO_(form) {
  return poSavePO_(form, true);
}

function poTogglePaid_(row, status) {
  var index = Number(row);
  if (!index || index < PO_TRACKER_CFG.START_ROW) throw new Error('ไม่พบแถวข้อมูล');
  poSheet_(PO_TRACKER_CFG.PO_SHEET).getRange(index, PO_TRACKER_COL.PAYMENT_STATUS).setValue(String(status || 'Paid'));
  return { success: true, message: 'อัปเดตสถานะเป็น ' + String(status || 'Paid') + ' แล้ว' };
}

function poSyncHash_(row) {
  var canonical = JSON.stringify(row.slice(0, 11).map(function (value, index) {
    if (index === 3 || index === 6 || index === 8) return poDateText_(value, 'yyyy-MM-dd');
    if (index === 4 || index === 7) return poNumber_(value);
    return String(value || '').trim();
  }));
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonical)
  );
}

function poFindFirestoreRow_(sheet, id) {
  var columns = poRequireSyncColumns_();
  var last = poLastDataRow_(sheet);
  if (last < PO_TRACKER_CFG.START_ROW) return 0;
  var ids = sheet.getRange(
    PO_TRACKER_CFG.START_ROW,
    columns.id,
    last - PO_TRACKER_CFG.START_ROW + 1,
    1
  ).getValues();
  for (var index = 0; index < ids.length; index++) {
    if (String(ids[index][0] || '') === id) return PO_TRACKER_CFG.START_ROW + index;
  }
  return 0;
}

function poValidateSyncId_(value) {
  var id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(id)) throw new Error('Firestore PO ID ไม่ถูกต้อง');
  return id;
}

function poSheetValuesFromRecord_(record) {
  var invoiceDate = poDate_(record.invDateISO || record.invDate);
  var dueDate = poDate_(record.dueDateISO || record.dueDate);
  var credit = poNumber_(record.credit);
  if (!dueDate && invoiceDate && credit > 0) {
    dueDate = new Date(invoiceDate.getTime());
    dueDate.setDate(dueDate.getDate() + credit);
  }
  return [
    String(record.poNumber || '').trim(),
    String(record.customer || '').trim(),
    String(record.quotation || '').trim(),
    poDate_(record.poDateISO || record.poDate) || '',
    poNumber_(record.amount),
    String(record.invoice || '').trim(),
    invoiceDate || '',
    credit || '',
    dueDate || '',
    String(record.payStatus || 'Unpaid').trim(),
    String(record.delivery || '').trim()
  ];
}

function poSyncFromFirestore_(data) {
  poRequireSyncApproval_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return poSyncFromFirestoreUnlocked_(data);
  } finally {
    lock.releaseLock();
  }
}

function poSyncFromFirestoreUnlocked_(data) {
  var columns = poRequireSyncColumns_();
  var id = poValidateSyncId_(data && data.id);
  var record = firebaseGetDocument_('purchaseOrders', id);
  var revision = Number(record && record.revision);
  if (!record || !Number.isInteger(revision) || revision < 1) {
    throw new Error('ไม่พบข้อมูล PO ที่บันทึกใน Firebase หรือ revision ไม่ถูกต้อง');
  }
  var sheet = poSheet_(PO_TRACKER_CFG.PO_SHEET);
  var row = poFindFirestoreRow_(sheet, id);
  if (!row) row = Math.max(PO_TRACKER_CFG.START_ROW, poLastDataRow_(sheet) + 1);
  var width = poReadWidth_();
  var existing = sheet.getRange(row, 1, 1, width).getValues()[0];
  var sheetRevision = poNumber_(existing[columns.revision - 1]);
  var storedHash = String(existing[columns.hash - 1] || '');
  if (existing[columns.id - 1] && storedHash && poSyncHash_(existing) !== storedHash) {
    poRecordSyncConflict_('web', id, record, existing);
    throw new Error('พบการแก้ไข PO ใน Google Sheets ที่ยังไม่ซิงก์; บันทึก conflict ไว้ตรวจสอบแล้ว');
  }
  if (sheetRevision > revision) {
    poRecordSyncConflict_('web', id, record, existing);
    throw new Error('ข้อมูล PO ใน Google Sheets ใหม่กว่า Firebase; บันทึก conflict ไว้เพื่อตรวจสอบแล้ว');
  }
  if (record.deletedAt) {
    sheet.getRange(row, columns.id, 1, 2).setValues([[id, String(record.deletedAt)]]);
    sheet.getRange(row, columns.revision).setValue(revision);
    return { success: true, id: id, deleted: true };
  }

  var values = poSheetValuesFromRecord_(record);
  if (!values[1] || !values[2]) throw new Error('PO ต้องมีชื่อลูกค้าและเลขใบเสนอราคา');
  var last = poLastDataRow_(sheet);
  var existingRows = last >= PO_TRACKER_CFG.START_ROW
    ? sheet.getRange(PO_TRACKER_CFG.START_ROW, 1, last - PO_TRACKER_CFG.START_ROW + 1, width).getValues()
    : [];
  var duplicateInvoice = values[5] && existingRows.some(function (valuesAtRow, index) {
    return PO_TRACKER_CFG.START_ROW + index !== row &&
      String(valuesAtRow[5] || '').trim().toLowerCase() === values[5].toLowerCase() &&
      !valuesAtRow[columns.deletedAt - 1];
  });
  if (duplicateInvoice) throw new Error('Invoice ซ้ำใน Google Sheets');
  sheet.getRange(row, 1, 1, 11).setValues([values]);
  sheet.getRange(row, columns.id, 1, 4).setValues([[id, '', revision, poSyncHash_(values)]]);
  sheet.getRange(row, PO_TRACKER_COL.PO_DATE).setNumberFormat('dd-mmm-yy');
  sheet.getRange(row, PO_TRACKER_COL.INVOICE_DATE).setNumberFormat('dd-mmm-yy');
  sheet.getRange(row, PO_TRACKER_COL.DUE_DATE).setNumberFormat('dd-mmm-yy');
  sheet.getRange(row, PO_TRACKER_COL.AMOUNT).setNumberFormat('#,##0.00');
  poEnsureCustomer_(poSheet_(PO_TRACKER_CFG.CUSTOMER_SHEET), values[1]);
  return { success: true, id: id, row: row, revision: revision };
}

function poRecordSyncConflict_(source, id, record, sheetRow) {
  var conflictId = Utilities.getUuid();
  firebasePatchDocument_('syncConflicts', conflictId, {
    module: 'po',
    entityId: id,
    source: source,
    firestoreRecord: record,
    sheetRow: sheetRow.map(function (value) {
      return value instanceof Date ? value.toISOString() : value;
    }),
    createdAt: new Date().toISOString(),
    status: 'open'
  });
}

function poSyncSheetRowToFirestore_(sheet, rowNumber) {
  var columns = poRequireSyncColumns_();
  if (rowNumber < PO_TRACKER_CFG.START_ROW) return;
  var range = sheet.getRange(rowNumber, 1, 1, poReadWidth_());
  var row = range.getValues()[0];
  if (!String(row[0] || '').trim() && !String(row[1] || '').trim() && !String(row[2] || '').trim()) return;
  if (row[columns.deletedAt - 1]) return;

  var id = String(row[columns.id - 1] || '').trim();
  if (!id) {
    id = Utilities.getUuid().replace(/-/g, '');
    sheet.getRange(rowNumber, columns.id).setValue(id);
  }
  var hash = poSyncHash_(row);
  if (hash === String(row[columns.hash - 1] || '')) return;

  var current = firebaseGetDocument_('purchaseOrders', id);
  var sheetRevision = poNumber_(row[columns.revision - 1]);
  var currentRevision = current ? poNumber_(current.revision) : 0;
  if (current && currentRevision > sheetRevision) {
    poRecordSyncConflict_('sheet', id, current, row);
    sheet.getRange(rowNumber, columns.hash).setValue(hash);
    return;
  }

  var revision = currentRevision + 1;
  var record = {
    id: id,
    poNumber: String(row[0] || '').trim(),
    customer: String(row[1] || '').trim(),
    quotation: String(row[2] || '').trim(),
    poDateISO: poDateText_(row[3], 'yyyy-MM-dd'),
    amount: poNumber_(row[4]),
    invoice: String(row[5] || '').trim(),
    invDateISO: poDateText_(row[6], 'yyyy-MM-dd'),
    credit: poNumber_(row[7]),
    dueDateISO: poDateText_(row[8], 'yyyy-MM-dd'),
    payStatus: String(row[9] || 'Unpaid').trim(),
    delivery: String(row[10] || '').trim(),
    normalizedPONumber: String(row[0] || '').trim().toLowerCase(),
    normalizedInvoice: String(row[5] || '').trim().toLowerCase(),
    sheetRow: rowNumber,
    revision: revision,
    createdAt: current && current.createdAt ? current.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sheetSync: { status: 'synced', updatedAt: new Date().toISOString(), error: '' }
  };
  if (!record.customer || !record.quotation) {
    throw new Error('PO ใน Google Sheets ต้องมีชื่อลูกค้าและเลขใบเสนอราคาก่อนซิงก์');
  }
  var invoice = String(row[5] || '').trim().toLowerCase();
  if (invoice) {
    var last = poLastDataRow_(sheet);
    var otherRows = last >= PO_TRACKER_CFG.START_ROW
      ? sheet.getRange(PO_TRACKER_CFG.START_ROW, 1, last - PO_TRACKER_CFG.START_ROW + 1, poReadWidth_()).getValues()
      : [];
    var duplicateInvoice = otherRows.some(function (values, index) {
      return PO_TRACKER_CFG.START_ROW + index !== rowNumber &&
        String(values[5] || '').trim().toLowerCase() === invoice &&
        !values[columns.deletedAt - 1];
    });
    if (duplicateInvoice) throw new Error('Invoice ซ้ำใน Google Sheets: ' + row[5]);
  }
  poSyncCustomerNameToFirestore_(record.customer);
  firebasePatchDocument_('purchaseOrders', id, record);
  sheet.getRange(rowNumber, columns.revision).setValue(revision);
  sheet.getRange(rowNumber, columns.hash).setValue(hash);
}

function poSyncCustomerFromFirestore_(data) {
  poRequireSyncApproval_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return poSyncCustomerFromFirestoreUnlocked_(data);
  } finally {
    lock.releaseLock();
  }
}

function poSyncCustomerFromFirestoreUnlocked_(data) {
  var columns = poRequireSyncColumns_();
  var id = poValidateSyncId_(data && data.id);
  var customer = firebaseGetDocument_('poCustomers', id);
  var name = String(customer && customer.name || '').trim();
  if (!name) throw new Error('ไม่พบชื่อลูกค้า');
  var sheet = poSheet_(PO_TRACKER_CFG.CUSTOMER_SHEET);
  var last = sheet.getLastRow();
  var rows = last ? sheet.getRange(1, 1, last, columns.customerId).getValues() : [];
  var rowNumber = 0;
  for (var index = 0; index < rows.length; index++) {
    if (String(rows[index][columns.customerId - 1] || '') === id) {
      rowNumber = index + 1;
      break;
    }
  }
  if (!rowNumber) rowNumber = Math.max(1, last + 1);
  sheet.getRange(rowNumber, 1).setValue(name);
  sheet.getRange(rowNumber, columns.customerId).setValue(id);
  return { success: true, id: id };
}

function poSyncCustomerNameToFirestore_(name) {
  var columns = poRequireSyncColumns_();
  var value = String(name || '').trim();
  if (!value) return;
  var sheet = poSheet_(PO_TRACKER_CFG.CUSTOMER_SHEET);
  var last = sheet.getLastRow();
  var rows = last ? sheet.getRange(1, 1, last, columns.customerId).getValues() : [];
  var normalizedName = value.toLowerCase();
  var rowNumber = 0;
  var id = '';
  for (var index = 0; index < rows.length; index++) {
    if (String(rows[index][0] || '').trim().toLowerCase() === normalizedName) {
      rowNumber = index + 1;
      id = String(rows[index][columns.customerId - 1] || '').trim();
      break;
    }
  }
  if (!rowNumber) rowNumber = Math.max(1, last + 1);
  if (!id) id = Utilities.getUuid().replace(/-/g, '');
  sheet.getRange(rowNumber, 1).setValue(value);
  sheet.getRange(rowNumber, columns.customerId).setValue(id);
  firebasePatchDocument_('poCustomers', id, {
    name: value,
    normalizedName: normalizedName,
    updatedAt: new Date().toISOString()
  });
}

function poSyncCustomerSheetRow_(sheet, rowNumber) {
  var columns = poRequireSyncColumns_();
  if (rowNumber < 1) return;
  var name = String(sheet.getRange(rowNumber, 1).getValue() || '').trim();
  if (!name || /(customer|ชื่อลูกค้า)/i.test(name)) return;
  var idCell = sheet.getRange(rowNumber, columns.customerId);
  var id = String(idCell.getValue() || '').trim();
  if (!id) {
    id = Utilities.getUuid().replace(/-/g, '');
    idCell.setValue(id);
  }
  var normalizedName = name.toLowerCase();
  var matches = poCustomers_();
  if (!matches.some(function (item) { return item.toLowerCase() === normalizedName; })) {
    throw new Error('ตรวจสอบรายชื่อลูกค้าใน Google Sheets ไม่สำเร็จ');
  }
  firebasePatchDocument_('poCustomers', id, {
    name: name,
    normalizedName: normalizedName,
    updatedAt: new Date().toISOString()
  });
}

function poHandleSheetEdit_(event) {
  poRequireSyncApproval_();
  if (!event || !event.range) throw new Error('ไม่พบข้อมูล onEdit event');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = event.range.getSheet();
    var firstRow = event.range.getRow();
    var lastRow = firstRow + event.range.getNumRows() - 1;
    if (sheet.getName() === PO_TRACKER_CFG.PO_SHEET) {
      for (var row = firstRow; row <= lastRow; row++) {
        var values = sheet.getRange(row, 1, 1, poReadWidth_()).getValues()[0];
        if (!String(values[0] || '').trim() && !String(values[1] || '').trim() && !String(values[2] || '').trim()) {
          var columns = poRequireSyncColumns_();
          var id = String(values[columns.id - 1] || '').trim();
          if (id) poTombstoneSheetRow_(sheet, row, id, values, columns);
        } else {
          poSyncSheetRowToFirestore_(sheet, row);
        }
      }
      return;
    }
    if (sheet.getName() === PO_TRACKER_CFG.CUSTOMER_SHEET) {
      for (var customerRow = firstRow; customerRow <= lastRow; customerRow++) {
        poSyncCustomerSheetRow_(sheet, customerRow);
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function poSetupSyncMetadata() {
  poRequireMetadataSetupApproval_();
  var spreadsheet = poSpreadsheet_();
  var poSheet = poSheet_(PO_TRACKER_CFG.PO_SHEET);
  var customerSheet = poSheet_(PO_TRACKER_CFG.CUSTOMER_SHEET);
  var properties = PropertiesService.getScriptProperties();
  var poStart = Number(properties.getProperty('PO_SYNC_PO_META_COL')) || Math.max(12, poSheet.getLastColumn() + 1);
  var customerId = Number(properties.getProperty('PO_SYNC_CUSTOMER_ID_COL')) || Math.max(2, customerSheet.getLastColumn() + 1);
  if (poSheet.getMaxColumns() < poStart + 3) poSheet.insertColumnsAfter(poSheet.getMaxColumns(), poStart + 3 - poSheet.getMaxColumns());
  if (customerSheet.getMaxColumns() < customerId) customerSheet.insertColumnsAfter(customerSheet.getMaxColumns(), customerId - customerSheet.getMaxColumns());
  properties.setProperty('PO_SYNC_PO_META_COL', String(poStart));
  properties.setProperty('PO_SYNC_CUSTOMER_ID_COL', String(customerId));
  poSheet.getRange(2, poStart, 1, 4).setValues([[
    '_firestore_id', '_deleted_at', '_revision', '_sync_hash'
  ]]);
  poSheet.hideColumns(poStart, 4);
  customerSheet.getRange(1, customerId).setValue('_firestore_id');
  customerSheet.hideColumns(customerId);
  return { success: true, spreadsheetId: spreadsheet.getId() };
}

function poInstallEditTrigger() {
  poRequireSyncApproval_();
  poRequireSyncColumns_();
  var spreadsheet = poSpreadsheet_();
  var existing = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === 'poHandleSheetEdit_';
  });
  if (!existing) {
    ScriptApp.newTrigger('poHandleSheetEdit_').forSpreadsheet(spreadsheet).onEdit().create();
  }
  return { success: true, alreadyInstalled: existing };
}

function poInstallChangeTrigger() {
  poRequireSyncApproval_();
  poRequireSyncColumns_();
  var spreadsheet = poSpreadsheet_();
  var existing = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === 'poHandleSheetChange_';
  });
  if (!existing) ScriptApp.newTrigger('poHandleSheetChange_').forSpreadsheet(spreadsheet).onChange().create();
  return { success: true, alreadyInstalled: existing };
}

function poInstallReconciliationTrigger() {
  poRequireSyncApproval_();
  poRequireSyncColumns_();
  var existing = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === 'poReconcileSheetBatchToFirestore_';
  });
  if (!existing) {
    ScriptApp.newTrigger('poReconcileSheetBatchToFirestore_').timeBased().everyMinutes(15).create();
  }
  return { success: true, alreadyInstalled: existing };
}

function poReconcileSheetBatchToFirestore_() {
  poRequireSyncApproval_();
  var columns = poRequireSyncColumns_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = poSheet_(PO_TRACKER_CFG.PO_SHEET);
    var last = poLastDataRow_(sheet);
    if (last < PO_TRACKER_CFG.START_ROW) return { success: true, scanned: 0 };
    var properties = PropertiesService.getScriptProperties();
    var cursor = Number(properties.getProperty('PO_RECONCILE_CURSOR')) || PO_TRACKER_CFG.START_ROW;
    if (cursor > last) cursor = PO_TRACKER_CFG.START_ROW;
    var count = Math.min(50, last - cursor + 1);
    for (var row = cursor; row < cursor + count; row++) {
      poSyncSheetRowToFirestore_(sheet, row);
    }
    var next = cursor + count > last ? PO_TRACKER_CFG.START_ROW : cursor + count;
    properties.setProperty('PO_RECONCILE_CURSOR', String(next));
    return { success: true, scanned: count, nextRow: next, totalRows: last };
  } finally {
    lock.releaseLock();
  }
}

function poValidateMigrationRows_(sheet, lastRow) {
  if (lastRow < PO_TRACKER_CFG.START_ROW) return;
  var rows = sheet.getRange(
    PO_TRACKER_CFG.START_ROW, 1, lastRow - PO_TRACKER_CFG.START_ROW + 1, PO_TRACKER_CFG.NUM_COLS
  ).getValues();
  var invoiceNumbers = {};
  var ids = {};
  var columns = poRequireSyncColumns_();
  var stableIds = sheet.getRange(
    PO_TRACKER_CFG.START_ROW,
    columns.id,
    lastRow - PO_TRACKER_CFG.START_ROW + 1,
    1
  ).getValues();
  rows.forEach(function (row, index) {
    if (!String(row[0] || '').trim() && !String(row[1] || '').trim() && !String(row[2] || '').trim()) return;
    var invoice = String(row[5] || '').trim().toLowerCase();
    if (invoice && invoiceNumbers[invoice]) {
      throw new Error('Invoice ซ้ำใน Sheet: ' + row[5]);
    }
    if (invoice) invoiceNumbers[invoice] = true;
    var amountText = String(row[4] === null || row[4] === undefined ? '' : row[4]).trim();
    if (!String(row[1] || '').trim() || !String(row[2] || '').trim() ||
        !amountText || !/\d/.test(amountText) ||
        !Number.isFinite(poNumber_(row[4])) || poNumber_(row[4]) < 0) {
      throw new Error('พบ PO ที่ไม่มีลูกค้า/เลขใบเสนอราคา หรือยอดเงินไม่ถูกต้องที่แถว ' +
        (PO_TRACKER_CFG.START_ROW + index));
    }
    var id = String(stableIds[index][0] || '').trim();
    if (id && ids[id]) throw new Error('Stable ID ซ้ำใน Sheet: ' + id);
    if (id) ids[id] = true;
  });
}

function poRequireMigrationApproval_() {
  var properties = PropertiesService.getScriptProperties();
  var approvedSpreadsheetId = properties.getProperty('PO_MIGRATION_SPREADSHEET_ID');
  var currentSpreadsheetId = poSpreadsheet_().getId();
  if (properties.getProperty('PO_ALLOW_MIGRATION') !== 'YES' ||
      !approvedSpreadsheetId || approvedSpreadsheetId !== currentSpreadsheetId) {
    throw new Error('หยุดการย้ายข้อมูล: ตั้ง PO_ALLOW_MIGRATION=YES และ PO_MIGRATION_SPREADSHEET_ID ให้ตรงกับสำเนาทดสอบที่อนุมัติ');
  }
}

function poRequireMetadataSetupApproval_() {
  var properties = PropertiesService.getScriptProperties();
  var approvedId = properties.getProperty('PO_SETUP_SPREADSHEET_ID');
  if (properties.getProperty('PO_ALLOW_METADATA_SETUP') !== 'YES' ||
      !approvedId || approvedId !== poSpreadsheet_().getId()) {
    throw new Error('หยุดการแก้ Sheet: ตั้ง PO_ALLOW_METADATA_SETUP=YES และ PO_SETUP_SPREADSHEET_ID ให้ตรงกับสำเนาทดสอบที่อนุมัติ');
  }
}

function poRequireSyncApproval_() {
  var properties = PropertiesService.getScriptProperties();
  var approvedId = properties.getProperty('PO_SYNC_SPREADSHEET_ID');
  if (properties.getProperty('PO_ALLOW_SYNC') !== 'YES' ||
      !approvedId || approvedId !== poSpreadsheet_().getId()) {
    throw new Error('หยุดการซิงก์: ตั้ง PO_ALLOW_SYNC=YES และ PO_SYNC_SPREADSHEET_ID ให้ตรงกับ Sheet ที่อนุมัติ');
  }
}

function poSyncHealth_() {
  poRequireSyncApproval_();
  poRequireSyncColumns_();
  return { success: true, module: 'po', ready: true };
}

function poMigrateSheetBatchToFirestore() {
  var columns = poRequireSyncColumns_();
  var properties = PropertiesService.getScriptProperties();
  poRequireMigrationApproval_();
  var sheet = poSheet_(PO_TRACKER_CFG.PO_SHEET);
  var last = poLastDataRow_(sheet);
  poValidateMigrationRows_(sheet, last);
  var cursor = Number(properties.getProperty('PO_MIGRATION_CURSOR')) || PO_TRACKER_CFG.START_ROW;
  if (cursor > last) {
    properties.setProperty('PO_MIGRATION_COMPLETE', 'YES');
    return { success: true, done: true, nextRow: cursor, totalRows: last };
  }
  var count = Math.min(PO_TRACKER_CFG.SYNC_BATCH_SIZE, last - cursor + 1);
  var range = sheet.getRange(cursor, 1, count, poReadWidth_());
  var rows = range.getValues();
  var writes = [];
  var metadata = [];
  rows.forEach(function (row, index) {
    if ((!String(row[0] || '').trim() && !String(row[1] || '').trim() && !String(row[2] || '').trim()) ||
        row[columns.deletedAt - 1]) {
      metadata.push([
        row[columns.id - 1] || '',
        row[columns.deletedAt - 1] || '',
        row[columns.revision - 1] || '',
        row[columns.hash - 1] || ''
      ]);
      return;
    }
    var id = String(row[columns.id - 1] || '').trim();
    if (!id) {
      id = Utilities.getUuid().replace(/-/g, '');
      row[columns.id - 1] = id;
    }
    var rowNumber = cursor + index;
    var values = poSheetValuesFromRecord_({
      poNumber: row[0], customer: row[1], quotation: row[2], poDate: row[3],
      amount: row[4], invoice: row[5], invDate: row[6], credit: row[7],
      dueDate: row[8], payStatus: row[9], delivery: row[10]
    });
    var hash = poSyncHash_(values);
    var revision = Math.max(1, poNumber_(row[columns.revision - 1]));
    row[columns.revision - 1] = revision;
    row[columns.hash - 1] = hash;
    writes.push({
      collection: 'purchaseOrders',
      id: id,
      data: {
        id: id,
        poNumber: String(row[0] || '').trim(),
        customer: String(row[1] || '').trim(),
        quotation: String(row[2] || '').trim(),
        poDateISO: poDateText_(row[3], 'yyyy-MM-dd'),
        amount: poNumber_(row[4]),
        invoice: String(row[5] || '').trim(),
        invDateISO: poDateText_(row[6], 'yyyy-MM-dd'),
        credit: poNumber_(row[7]),
        dueDateISO: poDateText_(row[8], 'yyyy-MM-dd'),
        payStatus: String(row[9] || 'Unpaid').trim(),
        delivery: String(row[10] || '').trim(),
        normalizedPONumber: String(row[0] || '').trim().toLowerCase(),
        normalizedInvoice: String(row[5] || '').trim().toLowerCase(),
        sheetRow: rowNumber,
        revision: revision,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    });
    metadata.push([id, '', revision, hash]);
  });
  sheet.getRange(cursor, columns.id, count, 4).setValues(metadata);
  if (writes.length) firebaseCommitPatches_(writes);
  properties.setProperty('PO_MIGRATION_CURSOR', String(cursor + count));
  if (cursor + count > last) properties.setProperty('PO_MIGRATION_COMPLETE', 'YES');
  properties.setProperty(
    'PO_MIGRATION_IMPORTED',
    String((Number(properties.getProperty('PO_MIGRATION_IMPORTED')) || 0) + writes.length)
  );
  return {
    success: true,
    done: cursor + count > last,
    importedThisBatch: writes.length,
    importedTotal: Number(properties.getProperty('PO_MIGRATION_IMPORTED')),
    nextRow: cursor + count,
    totalRows: last
  };
}

function poMigrateCustomerBatchToFirestore() {
  var columns = poRequireSyncColumns_();
  var properties = PropertiesService.getScriptProperties();
  poRequireMigrationApproval_();
  var sheet = poSheet_(PO_TRACKER_CFG.CUSTOMER_SHEET);
  var last = sheet.getLastRow();
  var customerNames = last ? sheet.getRange(1, 1, last, 1).getValues() : [];
  var seenCustomers = {};
  var seenIds = {};
  var existingIds = last ? sheet.getRange(1, columns.customerId, last, 1).getValues() : [];
  customerNames.forEach(function (row, index) {
    var name = String(row[0] || '').trim();
    if (!name || /(customer|ชื่อลูกค้า)/i.test(name)) return;
    var normalized = name.toLowerCase();
    if (seenCustomers[normalized]) throw new Error('Customer ซ้ำใน Sheet: ' + name);
    seenCustomers[normalized] = true;
    var id = String(existingIds[index][0] || '').trim();
    if (id && seenIds[id]) throw new Error('Stable Customer ID ซ้ำใน Sheet: ' + id);
    if (id) seenIds[id] = true;
  });
  var cursor = Number(properties.getProperty('PO_CUSTOMER_MIGRATION_CURSOR')) || 1;
  if (cursor > last) return { success: true, done: true, nextRow: cursor, totalRows: last };
  var count = Math.min(PO_TRACKER_CFG.SYNC_BATCH_SIZE, last - cursor + 1);
  var names = sheet.getRange(cursor, 1, count, 1).getValues();
  var ids = sheet.getRange(cursor, columns.customerId, count, 1).getValues();
  var writes = [];
  var metadata = [];
  names.forEach(function (row, index) {
    var name = String(row[0] || '').trim();
    var id = String(ids[index][0] || '').trim();
    if (!name || /(customer|ชื่อลูกค้า)/i.test(name)) {
      metadata.push([id]);
      return;
    }
    if (!id) id = Utilities.getUuid().replace(/-/g, '');
    writes.push({
      collection: 'poCustomers',
      id: id,
      data: {
        name: name,
        normalizedName: name.toLowerCase(),
        createdAt: new Date().toISOString()
      }
    });
    metadata.push([id]);
  });
  sheet.getRange(cursor, columns.customerId, count, 1).setValues(metadata);
  if (writes.length) firebaseCommitPatches_(writes);
  properties.setProperty('PO_CUSTOMER_MIGRATION_CURSOR', String(cursor + count));
  properties.setProperty(
    'PO_CUSTOMER_MIGRATION_IMPORTED',
    String((Number(properties.getProperty('PO_CUSTOMER_MIGRATION_IMPORTED')) || 0) + writes.length)
  );
  return {
    success: true,
    done: cursor + count > last,
    importedThisBatch: writes.length,
    importedTotal: Number(properties.getProperty('PO_CUSTOMER_MIGRATION_IMPORTED')),
    nextRow: cursor + count,
    totalRows: last
  };
}

function poMigrateOptionsToFirestore() {
  poRequireMigrationApproval_();
  var options = poOptions_();
  firebasePatchDocument_('poSettings', 'options', {
    payStatus: options.payStatus,
    delivery: options.delivery,
    updatedAt: new Date().toISOString()
  });
  return { success: true, options: options };
}

function poResetMigrationCursorForTest() {
  poRequireMigrationApproval_();
  var properties = PropertiesService.getScriptProperties();
  properties.deleteProperty('PO_MIGRATION_CURSOR');
  properties.deleteProperty('PO_MIGRATION_IMPORTED');
  properties.deleteProperty('PO_CUSTOMER_MIGRATION_CURSOR');
  properties.deleteProperty('PO_CUSTOMER_MIGRATION_IMPORTED');
  properties.deleteProperty('PO_MIGRATION_COMPLETE');
  return { success: true };
}

function poMigrationAudit() {
  poRequireMigrationApproval_();
  var columns = poRequireSyncColumns_();
  var sheet = poSheet_(PO_TRACKER_CFG.PO_SHEET);
  var last = poLastDataRow_(sheet);
  var width = poReadWidth_();
  var rows = last >= PO_TRACKER_CFG.START_ROW
    ? sheet.getRange(PO_TRACKER_CFG.START_ROW, 1, last - PO_TRACKER_CFG.START_ROW + 1, width).getValues()
    : [];
  var sheetRecords = {};
  var duplicateInvoices = [];
  var invoiceNumbers = {};
  rows.forEach(function (row, index) {
    if ((!String(row[0] || '').trim() && !String(row[1] || '').trim() && !String(row[2] || '').trim()) ||
        row[columns.deletedAt - 1]) return;
    var id = String(row[columns.id - 1] || '').trim();
    if (!id) return;
    var invoice = String(row[5] || '').trim().toLowerCase();
    if (invoice && invoiceNumbers[invoice]) duplicateInvoices.push(String(row[5] || '').trim());
    if (invoice) invoiceNumbers[invoice] = true;
    sheetRecords[id] = {
      row: row,
      rowNumber: PO_TRACKER_CFG.START_ROW + index
    };
  });

  var firestoreDocuments = firebaseListDocuments_('purchaseOrders');
  var firestoreRecords = {};
  firestoreDocuments.forEach(function (item) {
    if (!item.data.deletedAt) firestoreRecords[item.id] = item.data;
  });
  var missingInFirestore = [];
  var mismatched = [];
  Object.keys(sheetRecords).forEach(function (id) {
    var firestoreRecord = firestoreRecords[id];
    if (!firestoreRecord) {
      missingInFirestore.push(id);
      return;
    }
    var sheetHash = poSyncHash_(sheetRecords[id].row);
    var firestoreHash = poSyncHash_(poSheetValuesFromRecord_(firestoreRecord));
    if (sheetHash !== firestoreHash) mismatched.push(id);
  });
  var extraInFirestore = Object.keys(firestoreRecords).filter(function (id) {
    return !sheetRecords[id];
  });

  var customerSheet = poSheet_(PO_TRACKER_CFG.CUSTOMER_SHEET);
  var customerLast = customerSheet.getLastRow();
  var customerRows = customerLast
    ? customerSheet.getRange(1, 1, customerLast, columns.customerId).getValues()
    : [];
  var sheetCustomers = {};
  customerRows.forEach(function (row) {
    var name = String(row[0] || '').trim();
    var id = String(row[columns.customerId - 1] || '').trim();
    if (name && id && !/(customer|ชื่อลูกค้า)/i.test(name)) sheetCustomers[id] = name;
  });
  var firestoreCustomerById = {};
  firebaseListDocuments_('poCustomers').forEach(function (item) {
    if (!item.data.deletedAt) firestoreCustomerById[item.id] = item.data.name;
  });
  var missingCustomers = Object.keys(sheetCustomers).filter(function (id) {
    return firestoreCustomerById[id] !== sheetCustomers[id];
  });
  var extraCustomers = Object.keys(firestoreCustomerById).filter(function (id) {
    return sheetCustomers[id] !== firestoreCustomerById[id];
  });

  return {
    success: true,
    sheetPOCount: Object.keys(sheetRecords).length,
    firestorePOCount: Object.keys(firestoreRecords).length,
    missingInFirestore: missingInFirestore,
    extraInFirestore: extraInFirestore,
    mismatchedRecords: mismatched,
    duplicateInvoices: duplicateInvoices,
    sheetCustomerCount: Object.keys(sheetCustomers).length,
    firestoreCustomerCount: Object.keys(firestoreCustomerById).length,
    missingCustomers: missingCustomers,
    extraOrMismatchedCustomers: extraCustomers
  };
}