import path from 'node:path';
import fs from 'node:fs';
import { google } from 'googleapis';
import { authenticate } from '@google-cloud/local-auth';
import { openDb, getDataDir } from '../db.js';
import { exportSnapshot, importSnapshotLww, appendSyncLog } from '../repo.js';

const DEFAULT_FILENAME = 'inventory-sync.json';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
}

function tokenPath() {
  return path.join(getDataDir(), 'google-drive-token.json');
}

function fileIdPath() {
  return path.join(getDataDir(), 'google-drive-file.json');
}

export async function getAuthorizedClient() {
  const credsPath =
    process.env.GOOGLE_OAUTH_CREDENTIALS_PATH ||
    path.join(process.cwd(), 'src', 'drive', 'credentials.json');

  if (!fs.existsSync(credsPath)) {
    throw new Error(
      `Missing OAuth credentials JSON. Set GOOGLE_OAUTH_CREDENTIALS_PATH or place credentials at ${credsPath}`
    );
  }

  const scopes = ['https://www.googleapis.com/auth/drive.file'];
  const tkPath = tokenPath();

  // Try cached token first
  if (fs.existsSync(tkPath)) {
    const token = readJson(tkPath);
    const { installed, web } = readJson(credsPath);
    const cfg = installed || web;
    const oAuth2Client = new google.auth.OAuth2(cfg.client_id, cfg.client_secret, cfg.redirect_uris?.[0]);
    oAuth2Client.setCredentials(token);
    return oAuth2Client;
  }

  // Interactive installed-app auth
  const client = await authenticate({
    keyfilePath: credsPath,
    scopes
  });

  writeJson(tkPath, client.credentials);
  return client;
}

async function getDrive(auth) {
  return google.drive({ version: 'v3', auth });
}

async function ensureDriveFileId(drive, filename = DEFAULT_FILENAME) {
  const existing = fs.existsSync(fileIdPath()) ? readJson(fileIdPath()) : null;
  if (existing?.fileId && existing?.filename === filename) return existing.fileId;

  const q = `name='${filename.replace(/'/g, "\\'")}' and trashed=false`;
  const list = await drive.files.list({
    q,
    fields: 'files(id,name,modifiedTime)'
  });

  const found = list.data.files?.[0];
  if (found?.id) {
    writeJson(fileIdPath(), { filename, fileId: found.id });
    return found.id;
  }

  const created = await drive.files.create({
    requestBody: {
      name: filename,
      mimeType: 'application/json'
    },
    fields: 'id'
  });

  writeJson(fileIdPath(), { filename, fileId: created.data.id });
  return created.data.id;
}

async function getDriveFileMeta(drive, fileId) {
  const resp = await drive.files.get({
    fileId,
    fields: 'id,name,version,modifiedTime'
  });
  return resp?.data || {};
}

export async function pushSnapshotToDrive({ filename = DEFAULT_FILENAME } = {}) {
  return pushSnapshotToDriveWithDeps({ filename });
}

export async function pullSnapshotFromDrive({ filename = DEFAULT_FILENAME } = {}) {
  return pullSnapshotFromDriveWithDeps({ filename });
}

// Testable entry points (allow injecting a Drive client and/or an existing DB connection)
export async function pushSnapshotToDriveWithDeps(opts = {}) {
  return pushSnapshotToDriveWithDepsV2(opts);
}

export async function pullSnapshotFromDriveWithDeps(opts = {}) {
  return pullSnapshotFromDriveWithDepsV2(opts);
}

// V2 adds optional optimistic concurrency via expectedVersion.
export async function pushSnapshotToDriveWithDepsV2({
  filename = DEFAULT_FILENAME,
  drive,
  db,
  expectedVersion
} = {}) {
  const effectiveDrive =
    drive || (await getDrive(await getAuthorizedClient()));
  const fileId = await ensureDriveFileId(effectiveDrive, filename);

  const meta = await getDriveFileMeta(effectiveDrive, fileId);
  const remoteVersion = meta?.version != null ? Number(meta.version) : undefined;
  if (expectedVersion != null && remoteVersion != null && Number(expectedVersion) !== remoteVersion) {
    return {
      ok: false,
      error: 'conflict',
      fileId,
      filename,
      expectedVersion: Number(expectedVersion),
      remoteVersion
    };
  }

  const ownsDb = !db;
  const effectiveDb = db || openDb().db;

  try {
    const snapshot = exportSnapshot(effectiveDb);

    await effectiveDrive.files.update({
      fileId,
      media: {
        mimeType: 'application/json',
        body: JSON.stringify(snapshot)
      }
    });

    appendSyncLog(effectiveDb, {
      source: 'drive_push',
      details: { filename, items: snapshot.items?.length ?? 0 }
    });

    const metaAfter = await getDriveFileMeta(effectiveDrive, fileId);
    const remoteVersionAfter = metaAfter?.version != null ? Number(metaAfter.version) : undefined;
    return { ok: true, fileId, filename, remoteVersion: remoteVersionAfter };
  } finally {
    if (ownsDb) effectiveDb.close();
  }
}

export async function pullSnapshotFromDriveWithDepsV2({
  filename = DEFAULT_FILENAME,
  drive,
  db
} = {}) {
  const effectiveDrive =
    drive || (await getDrive(await getAuthorizedClient()));
  const fileId = await ensureDriveFileId(effectiveDrive, filename);

  const meta = await getDriveFileMeta(effectiveDrive, fileId);
  const remoteVersion = meta?.version != null ? Number(meta.version) : undefined;

  const resp = await effectiveDrive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );

  const text = Buffer.from(resp.data).toString('utf8');
  const snapshot = JSON.parse(text);

  const ownsDb = !db;
  const effectiveDb = db || openDb().db;

  try {
    importSnapshotLww(effectiveDb, snapshot);
    appendSyncLog(effectiveDb, { source: 'drive_pull', details: { filename } });
    return { ok: true, fileId, filename, remoteVersion };
  } finally {
    if (ownsDb) effectiveDb.close();
  }
}
