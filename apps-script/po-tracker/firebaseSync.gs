var FIREBASE_SYNC_TOKEN_CACHE_ = '';
var FIREBASE_SYNC_TOKEN_EXPIRES_AT_ = 0;

function firebaseSyncProperties_() {
  var properties = PropertiesService.getScriptProperties();
  var apiKey = properties.getProperty('FIREBASE_API_KEY');
  var projectId = properties.getProperty('FIREBASE_PROJECT_ID');
  if (!apiKey || !projectId) {
    throw new Error('ตั้งค่า FIREBASE_API_KEY และ FIREBASE_PROJECT_ID ใน Script Properties ก่อน');
  }
  return { properties: properties, apiKey: apiKey, projectId: projectId };
}

function firebaseSyncToken_() {
  if (FIREBASE_SYNC_TOKEN_CACHE_ && Date.now() < FIREBASE_SYNC_TOKEN_EXPIRES_AT_ - 60000) {
    return FIREBASE_SYNC_TOKEN_CACHE_;
  }
  var config = firebaseSyncProperties_();
  var refreshToken = config.properties.getProperty('FIREBASE_REFRESH_TOKEN');
  var url;
  var payload;

  if (refreshToken) {
    url = 'https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(config.apiKey);
    payload = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    };
  } else {
    url = 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + encodeURIComponent(config.apiKey);
    payload = { returnSecureToken: true };
  }

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: refreshToken ? 'application/x-www-form-urlencoded' : 'application/json',
    payload: refreshToken ? payload : JSON.stringify(payload),
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
  FIREBASE_SYNC_TOKEN_CACHE_ = idToken;
  FIREBASE_SYNC_TOKEN_EXPIRES_AT_ = Date.now() + (Number(result.expires_in || result.expiresIn) || 3600) * 1000;
  return idToken;
}

function firebaseEncodeValue_(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(firebaseEncodeValue_) } };
  }
  if (typeof value === 'object') {
    var fields = {};
    Object.keys(value).forEach(function (key) {
      fields[key] = firebaseEncodeValue_(value[key]);
    });
    return { mapValue: { fields: fields } };
  }
  return { stringValue: String(value) };
}

function firebaseDecodeValue_(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(firebaseDecodeValue_);
  if ('mapValue' in value) return firebaseDecodeFields_(value.mapValue.fields || {});
  if ('timestampValue' in value) return value.timestampValue;
  return null;
}

function firebaseDecodeFields_(fields) {
  var result = {};
  Object.keys(fields).forEach(function (key) {
    result[key] = firebaseDecodeValue_(fields[key]);
  });
  return result;
}

function firebaseSyncRequest_(collectionName, documentId, method, data) {
  var config = firebaseSyncProperties_();
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
    headers: { Authorization: 'Bearer ' + firebaseSyncToken_() },
    muteHttpExceptions: true
  };
  if (data) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify({ fields: firebaseEncodeFields_(data) });
  }

  var response = UrlFetchApp.fetch(url, options);
  var body = response.getContentText();
  if (response.getResponseCode() === 404 && method === 'get') return null;
  var result = body ? JSON.parse(body) : {};
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error('Firestore sync error: ' + JSON.stringify(result.error || result));
  }
  return method === 'get' ? firebaseDecodeFields_(result.fields || {}) : result;
}

function firebaseEncodeFields_(data) {
  var fields = {};
  Object.keys(data).forEach(function (key) {
    if (data[key] !== undefined) fields[key] = firebaseEncodeValue_(data[key]);
  });
  return fields;
}

function firebaseGetDocument_(collectionName, documentId) {
  return firebaseSyncRequest_(collectionName, documentId, 'get');
}

function firebasePatchDocument_(collectionName, documentId, data) {
  return firebaseSyncRequest_(collectionName, documentId, 'patch', data);
}

function firebaseListDocuments_(collectionName) {
  var config = firebaseSyncProperties_();
  var baseUrl = 'https://firestore.googleapis.com/v1/projects/' +
    encodeURIComponent(config.projectId) +
    '/databases/(default)/documents/' + encodeURIComponent(collectionName);
  var pageToken = '';
  var documents = [];
  do {
    var url = baseUrl + '?pageSize=500' +
      (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    var response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + firebaseSyncToken_() },
      muteHttpExceptions: true
    });
    var body = response.getContentText();
    var result = body ? JSON.parse(body) : {};
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
      throw new Error('Firestore list error: ' + JSON.stringify(result.error || result));
    }
    (result.documents || []).forEach(function (document) {
      documents.push({
        id: document.name.split('/').pop(),
        data: firebaseDecodeFields_(document.fields || {})
      });
    });
    pageToken = result.nextPageToken || '';
  } while (pageToken);
  return documents;
}

function firebaseCommitPatches_(documents) {
  if (!documents || !documents.length) return;
  var config = firebaseSyncProperties_();
  var url = 'https://firestore.googleapis.com/v1/projects/' +
    encodeURIComponent(config.projectId) +
    '/databases/(default)/documents:commit';
  var writes = documents.map(function (item) {
    return {
      update: {
        name: 'projects/' + config.projectId + '/databases/(default)/documents/' +
          item.collection + '/' + item.id,
        fields: firebaseEncodeFields_(item.data)
      },
      updateMask: {
        fieldPaths: Object.keys(item.data).filter(function (key) { return item.data[key] !== undefined; })
      }
    };
  });
  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + firebaseSyncToken_() },
    payload: JSON.stringify({ writes: writes }),
    muteHttpExceptions: true
  });
  var body = response.getContentText();
  var result = body ? JSON.parse(body) : {};
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error('Firestore batch sync error: ' + JSON.stringify(result.error || result));
  }
}
