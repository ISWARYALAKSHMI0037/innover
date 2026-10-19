import multer from 'multer';
import { config } from '../config.js';
import { HttpError } from './security.js';

const ALLOWED = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

export const uploadSingle = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.upload.maxBytes, files: 1, fields: 8, fieldSize: 100 * 1024 },
  fileFilter(_req, file, cb) {
    if (!ALLOWED.has(file.mimetype)) return cb(new HttpError(415, 'unsupported_type', 'Only PDF, PNG, JPG or WebP files are accepted.'));
    cb(null, true);
  },
}).single('file');

/** Never trust the client's MIME type: check the file's magic bytes. */
export function sniffFileType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
