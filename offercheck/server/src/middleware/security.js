import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { config } from '../config.js';

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const CLIENT_ID_RE = /^[a-zA-Z0-9-]{16,64}$/;

/** Every student request carries an anonymous per-browser id (no accounts in the MVP). */
export function requireClientId(req, _res, next) {
  const id = req.get('x-client-id');
  if (!id || !CLIENT_ID_RE.test(id)) return next(new HttpError(400, 'bad_client_id', 'Missing or invalid X-Client-Id header.'));
  req.clientId = id;
  next();
}

export function requireDb(_req, _res, next) {
  if (mongoose.connection.readyState !== 1) {
    return next(new HttpError(503, 'db_unavailable', 'The database is not reachable right now. Make sure MongoDB is running and MONGODB_URI is correct, then try again.'));
  }
  next();
}

const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};

/** Placement-cell routes: passcode from env (if set). */
export function placementAuth(req, _res, next) {
  if (!config.placementPasscode) return next();
  const given = req.get('x-placement-passcode') || '';
  if (!given || !safeEqual(given, config.placementPasscode)) {
    return next(new HttpError(401, 'bad_passcode', 'Placement-cell passcode is missing or incorrect.'));
  }
  next();
}

export function notFound(_req, _res, next) {
  next(new HttpError(404, 'not_found', 'Route not found.'));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  let status = err.status || 500;
  let code = err.code || 'server_error';
  let message = err.message || 'Something went wrong.';
  if (err.name === 'MulterError') {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    code = err.code === 'LIMIT_FILE_SIZE' ? 'file_too_large' : 'upload_error';
    message = err.code === 'LIMIT_FILE_SIZE' ? `File is too large. The limit is ${Math.round(config.upload.maxBytes / 1048576)} MB.` : `Upload problem: ${err.message}`;
  } else if (err.type === 'entity.parse.failed') {
    status = 400; code = 'bad_json'; message = 'Request body is not valid JSON.';
  } else if (err.type === 'entity.too.large') {
    status = 413; code = 'body_too_large'; message = 'Request body is too large.';
  } else if (err.name === 'CastError') {
    status = 404; code = 'not_found'; message = 'No such analysis.';
  } else if (status >= 500) {
    console.error('[error]', err);
    message = 'Unexpected server error. Please try again.';
  }
  res.status(status).json({ error: { code, message } });
}
