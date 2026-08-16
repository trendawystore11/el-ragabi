/**
 * BMS — النسخ الاحتياطي اليومي التلقائي إلى Google Drive
 * يعمل على سيرفرات Google؛ جهاز المحل لا يحتاج أن يكون مفتوحاً.
 * كل ليلة 2:00 (توقيت القاهرة): يقرأ كل مجموعات Firestore
 * ويحفظها في ملف JSON مؤرخ داخل مجلد Drive مخصص.
 */

var CONFIG = {
  // ضع نص ملف bms-backup.json كاملاً بين رمزي ` ` (من { حتى })
  SERVICE_ACCOUNT_JSON: `__SERVICE_ACCOUNT_JSON__`,
  PROJECT_ID: '__PROJECT_ID__',
  OWNER_EMAIL: '__OWNER_EMAIL__',
  COLLECTIONS: [
    'customers', 'suppliers', 'products', 'orders', 'payments',
    'users', 'supplierReturns', 'supplierTransactions', 'expenses'
  ],
  FOLDER_NAME: 'BMS Backups',
  RETENTION_DAYS: 60
};

var SCOPES = [
  'https://www.googleapis.com/auth/datastore',
  'https://www.googleapis.com/auth/drive'
];

function dailyBackup() {
  var token = getServiceAccountToken();
  var backup = { backupType: 'full', exportedAt: new Date().toISOString(), app: 'BMS', data: {} };
  CONFIG.COLLECTIONS.forEach(function (col) { backup.data[col] = fetchCollection(token, col); });
  var json = JSON.stringify(backup, null, 2);
  var fileName = 'bms_backup_' + new Date().toISOString().slice(0, 10) + '.json';
  var folderId = getOrCreateFolder();
  uploadToFolder(folderId, fileName, json);
  cleanupOldFiles(folderId);
  Logger.log('Backup OK: ' + fileName + ' (' + json.length + ' bytes)');
}

function createBackupNow() { dailyBackup(); }

function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyBackup').timeBased().atHour(2).everyDays(1).inTimezone('Africa/Cairo').create();
  Logger.log('Scheduled: daily 02:00 Africa/Cairo');
}

function getServiceAccountToken() {
  var sa = JSON.parse(CONFIG.SERVICE_ACCOUNT_JSON);
  var now = Math.floor(Date.now() / 1000);
  var header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var claims = { iss: sa.client_email, scope: SCOPES.join(' '), aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  var toSign = header + '.' + b64url(JSON.stringify(claims));
  var sig = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(toSign, sa.private_key)).replace(/=+$/, '');
  var assertion = toSign + '.' + sig;
  var resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: assertion },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) throw new Error('Token error: ' + resp.getContentText());
  return JSON.parse(resp.getContentText()).access_token;
}

function b64url(s) { return Utilities.base64EncodeWebSafe(Utilities.newBlob(s).getBytes()).replace(/=+$/, ''); }

function fetchCollection(token, name) {
  var out = [], pageToken = '';
  do {
    var url = 'https://firestore.googleapis.com/v1/projects/' + CONFIG.PROJECT_ID +
              '/databases/(default)/documents/' + encodeURIComponent(name) + '?pageSize=300';
    if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
    var resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    var code = resp.getResponseCode();
    if (code === 404) break;
    if (code !== 200) throw new Error(name + ' HTTP ' + code + ': ' + resp.getContentText().slice(0, 300));
    var body = JSON.parse(resp.getContentText());
    (body.documents || []).forEach(function (doc) { out.push(firestoreValueToJs(doc.fields)); });
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return out;
}

function firestoreValueToJs(v) {
  if (v == null || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('referenceValue' in v) return v.referenceValue;
  if ('bytesValue' in v) return v.bytesValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(firestoreValueToJs);
  if ('mapValue' in v) {
    var fields = v.mapValue.fields || {}, o = {};
    Object.keys(fields).forEach(function (k) { o[k] = firestoreValueToJs(fields[k]); });
    return o;
  }
  return v;
}

function getOrCreateFolder() {
  var token = getServiceAccountToken();
  var q = "name='" + CONFIG.FOLDER_NAME + "' and mimeType='application/vnd.google-apps.folder' and 'root' in parents";
  var resp = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q), {
    headers: { Authorization: 'Bearer ' + token }
  });
  var files = JSON.parse(resp.getContentText()).files || [];
  if (files.length) return files[0].id;
  var create = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    payload: JSON.stringify({ name: CONFIG.FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
  });
  var folderId = JSON.parse(create.getContentText()).id;
  try {
    UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + folderId + '/permissions', {
      method: 'post',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ role: 'writer', type: 'user', emailAddress: CONFIG.OWNER_EMAIL })
    });
  } catch (e) { /* تجاهل */ }
  return folderId;
}

function uploadToFolder(folderId, fileName, content) {
  var token = getServiceAccountToken();
  var boundary = 'bms_boundary_7x9';
  var parts = [];
  parts.push('--' + boundary, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify({ name: fileName, mimeType: 'application/json', parents: [folderId] }));
  parts.push('--' + boundary, 'Content-Type: application/json; charset=UTF-8', '', content);
  parts.push('--' + boundary + '--', '');
  var payload = Utilities.newBlob(parts.join('\r\n'), 'multipart/related; boundary=' + boundary);
  var resp = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + token },
    payload: payload,
    contentType: 'multipart/related; boundary=' + boundary,
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) throw new Error('Upload error: ' + resp.getContentText());
}

function cleanupOldFiles(folderId) {
  var token = getServiceAccountToken();
  var cutoff = new Date(Date.now() - CONFIG.RETENTION_DAYS * 86400000).toISOString();
  var q = "'" + folderId + "' in parents and name contains 'bms_backup_'";
  var resp = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q), {
    headers: { Authorization: 'Bearer ' + token }
  });
  (JSON.parse(resp.getContentText()).files || []).forEach(function (f) {
    if ((f.createdTime || '') < cutoff) {
      try { UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + f.id, { method: 'delete', headers: { Authorization: 'Bearer ' + token } }); } catch (e) { /* تجاهل */ }
    }
  });
}
