export function errorHandler(error, _req, res, _next) {
  if (error?.name === 'MulterError') {
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    return res.status(tooLarge ? 413 : 400).json({ error: {
      code: tooLarge ? 'FILE_TOO_LARGE' : 'INVALID_UPLOAD',
      message: tooLarge ? 'The selected file exceeds the upload size limit.' : 'Upload one document file using the document field.',
    } });
  }
  if (error?.name === 'UploadValidationError') {
    const status = error.code === 'FILE_TOO_LARGE' ? 413 : 400;
    return res.status(status).json({ error: { code: error.code, message: error.message } });
  }
  const isDuplicateEmail = error?.code === 11000 && error?.keyPattern?.email;
  if (isDuplicateEmail) {
    return res.status(409).json({ error: { code: 'EMAIL_IN_USE', message: 'An account with this email already exists.' } });
  }

  // Log only safe metadata. Driver error messages can contain connection details.
  console.error('Request failed', { name: error?.name ?? 'Error', code: error?.code ?? 'UNKNOWN' });
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' } });
}
