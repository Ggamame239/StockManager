var PO_TRACKER_CFG = {
  SHEET_ID: '1KGghrQJ7po1w_FElfRxznyvMc2qkW3Wv0nkO6O6a0ik',
  PO_SHEET: 'PO tracker',
  CUSTOMER_SHEET: 'Sheet1',
  START_ROW: 3,
  START_COL: 1,
  NUM_COLS: 11,
  TIMEZONE: 'Asia/Bangkok'
};

var PO_TRACKER_COL = {
  PO: 1, CUSTOMER: 2, QUOTATION: 3, PO_DATE: 4, AMOUNT: 5,
  INVOICE: 6, INVOICE_DATE: 7, CREDIT: 8, DUE_DATE: 9,
  PAYMENT_STATUS: 10, DELIVERY: 11
};

function poSpreadsheet_() {
  var spreadsheet = PO_TRACKER_CFG.SHEET_ID
    ? SpreadsheetApp.openById(PO_TRACKER_CFG.SHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('ไม่พบ Google Sheets');
  return spreadsheet;
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
  try {
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
  } catch (error) {
    return fallback;
  }
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

  var rows = sheet.getRange(PO_TRACKER_CFG.START_ROW, PO_TRACKER_CFG.START_COL, last - PO_TRACKER_CFG.START_ROW + 1, PO_TRACKER_CFG.NUM_COLS).getValues();
  var records = [];
  var summary = poEmptySummary_();
  rows.forEach(function (row, index) {
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
      row: PO_TRACKER_CFG.START_ROW + index,
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
    sheet.getRange(row, PO_TRACKER_CFG.START_COL, 1, PO_TRACKER_CFG.NUM_COLS).setValues([[
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