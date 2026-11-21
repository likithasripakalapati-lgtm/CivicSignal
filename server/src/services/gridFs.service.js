import mongoose from 'mongoose';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { config } from '../config/env.js';

export function createDocumentBucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: config.gridFsBucketName });
}

export async function storeDocument(file, fileId, metadata) {
  const bucket = createDocumentBucket();
  const uploadStream = bucket.openUploadStreamWithId(fileId, file.originalname, {
    contentType: metadata.contentType,
    metadata: { ownerId: metadata.ownerId, contentType: metadata.contentType },
  });
  await pipeline(createReadStream(file.path), uploadStream);
}

export async function removeStoredDocument(fileId) {
  const db = mongoose.connection.db;
  try {
    await createDocumentBucket().delete(fileId);
  } catch {
    // GridFS deletion can fail for an incomplete upload with no fs.files record.
    await db.collection(`${config.gridFsBucketName}.chunks`).deleteMany({ files_id: fileId }).catch(() => {});
    await db.collection(`${config.gridFsBucketName}.files`).deleteOne({ _id: fileId }).catch(() => {});
  }
}
