var STOCK_FIREBASE_TOKEN_CACHE_ = '';
var STOCK_FIREBASE_TOKEN_EXPIRES_AT_ = 0;

function stockFirebaseProperties_() {
  var properties = PropertiesService.getScriptProperties();
  var apiKey = properties.getProperty('FIREBASE_API_KEY');
  var projectId = properties.getProperty('FIREBASE_PROJECT_ID');
  if (!apiKey || !projectId) throw new Error('ตั้งค่า FIREBASE_API_KEY และ FIREBASE_PROJECT_ID ใน Script Properties ก่อน');
  return { properties: properties, apiKey: apiKey, projectId: projectId };
}

function stockFirebaseToken_() {
  if (STOCK_FIREBASE_TOKEN_CACHE_ && Date.now() < STOCK_FIREBASE_TOKEN_EXPIRES_AT_ - 60000) {
    return STOCK_FIREBASE_TOKEN_CACHE_;
  }
  var config = stockFirebaseProperties_();
  var refreshToken = config.properties.getProperty('FIREBASE_REFRESH_TOKEN');
  var url = refreshToken
    ? 'https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(config.apiKey)
    : 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + encodeURIComponent(config.apiKey);
  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: refreshToken ? 'application/x-www-form-urlencoded' : 'application/json',
    payload: refreshToken
      ? { grant_type: 'refresh_token', refresh_token: refreshToken }
      : JSON.stringify({ returnSecureToken: true }),
    muteHttpExceptions: true
  });
  var result = JSON.parse(response.getContentText() || '{}');
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error('Firebase Authentication error: ' + JSON.stringify(result.error || result));
  }
  var nextRefreshToken = result.refresh_token || result.refreshToken;
  var idToken = result.id_token || result.idToken;
  if (!nextRefreshToken || !idToken) throw new Error('Firebase Authentication ไม่ส่ง token ที่จำเป็นกลับมา');
  config.properties.setProperty('FIREBASE_REFRESH_TOKEN', nextRefreshToken);
  STOCK_FIREBASE_TOKEN_CACHE_ = idToken;
  STOCK_FIREBASE_TOKEN_EXPIRES_AT_ = Date.now() + (Number(result.expires_in || result.expiresIn) || 3600) * 1000;
  return idToken;
}

function stockFirestoreValue_(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value)
    ? { integerValue: String(value) }
    : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(stockFirestoreValue_) } };
  if (typeof value === 'object') {
    var fields = {};
    Object.keys(value).forEach(function (key) { fields[key] = stockFirestoreValue_(value[key]); });
    return { mapValue: { fields: fields } };
  }
  return { stringValue: String(value) };
}

function stockFirestoreDecodeValue_(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(stockFirestoreDecodeValue_);
  if ('mapValue' in value) return stockFirestoreDecodeFields_(value.mapValue.fields || {});
  if ('timestampValue' in value) return value.timestampValue;
  return null;
}

function stockFirestoreDecodeFields_(fields) {
  var result = {};
  Object.keys(fields).forEach(function (key) { result[key] = stockFirestoreDecodeValue_(fields[key]); });
  return result;
}

function stockFirestoreEncodeFields_(data) {
  var fields = {};
  Object.keys(data).forEach(function (key) {
    if (data[key] !== undefined) fields[key] = stockFirestoreValue_(data[key]);
  });
  return fields;
}

function stockFirestoreRequest_(collectionName, documentId, method, data) {
  var config = stockFirebaseProperties_();
  var url = 'https://firestore.googleapis.com/v1/projects/' +
    encodeURIComponent(config.projectId) +
    '/databases/(default)/documents/' +
    encodeURIComponent(collectionName) + '/' + encodeURIComponent(documentId);
  if (method === 'patch' && data) {
    var mask = Object.keys(data).filter(function (key) { return data[key] !== undefined; })
      .map(function (key) { return 'updateMask.fieldPaths=' + encodeURIComponent(key); });
    if (mask.length) url += '?' + mask.join('&');
  }
  var options = {
    method: method,
    headers: { Authorization: 'Bearer ' + stockFirebaseToken_() },
    muteHttpExceptions: true
  };
  if (data) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify({ fields: stockFirestoreEncodeFields_(data) });
  }
  var response = UrlFetchApp.fetch(url, options);
  var body = response.getContentText();
  if (response.getResponseCode() === 404 && method === 'get') return null;
  var result = body ? JSON.parse(body) : {};
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error('Firestore sync error: ' + JSON.stringify(result.error || result));
  }
  return method === 'get' ? stockFirestoreDecodeFields_(result.fields || {}) : result;
}

function stockFirestoreGet_(collectionName, documentId) {
  return stockFirestoreRequest_(collectionName, documentId, 'get');
}

function stockFirestorePatch_(collectionName, documentId, data) {
  return stockFirestoreRequest_(collectionName, documentId, 'patch', data);
}

function stockFirestoreCommit_(documents) {
  if (!documents || !documents.length) return;
  var config = stockFirebaseProperties_();
  var url = 'https://firestore.googleapis.com/v1/projects/' +
    encodeURIComponent(config.projectId) +
    '/databases/(default)/documents:commit';
  var writes = documents.map(function (item) {
    return {
      update: {
        name: 'projects/' + config.projectId + '/databases/(default)/documents/' +
          item.collection + '/' + item.id,
        fields: stockFirestoreEncodeFields_(item.data)
      },
      updateMask: {
        fieldPaths: Object.keys(item.data).filter(function (key) { return item.data[key] !== undefined; })
      }
    };
  });
  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + stockFirebaseToken_() },
    payload: JSON.stringify({ writes: writes }),
    muteHttpExceptions: true
  });
  var result = JSON.parse(response.getContentText() || '{}');
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error('Firestore batch sync error: ' + JSON.stringify(result.error || result));
  }
}

function stockFirestoreList_(collectionName) {
  var config = stockFirebaseProperties_();
  var baseUrl = 'https://firestore.googleapis.com/v1/projects/' +
    encodeURIComponent(config.projectId) +
    '/databases/(default)/documents/' + encodeURIComponent(collectionName);
  var pageToken = '';
  var documents = [];
  do {
    var response = UrlFetchApp.fetch(baseUrl + '?pageSize=500' +
      (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''), {
      method: 'get',
      headers: { Authorization: 'Bearer ' + stockFirebaseToken_() },
      muteHttpExceptions: true
    });
    var result = JSON.parse(response.getContentText() || '{}');
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
      throw new Error('Firestore list error: ' + JSON.stringify(result.error || result));
    }
    (result.documents || []).forEach(function (document) {
      documents.push({
        id: document.name.split('/').pop(),
        data: stockFirestoreDecodeFields_(document.fields || {})
      });
    });
    pageToken = result.nextPageToken || '';
  } while (pageToken);
  return documents;
}
