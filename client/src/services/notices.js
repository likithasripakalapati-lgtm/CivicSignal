
import { api } from './api.js';
import { refreshCsrfToken } from './auth.js';

export async function uploadNotice(file, onProgress) {
  const csrfToken = await refreshCsrfToken();
  const form = new FormData();
  form.append('document', file);
  const { data } = await api.post('/notices/upload', form, {
    headers: { 'X-CSRF-Token': csrfToken },
    onUploadProgress: (event) => {
      if (event.total) onProgress?.(Math.round((event.loaded / event.total) * 100));
    },
  });
  return data;
}

export async function getNotice(noticeId) {
  const { data } = await api.get(`/notices/${encodeURIComponent(noticeId)}`);
  return data;
}

export async function getNotices() {
  const { data } = await api.get('/notices');
  return data;
}

export async function getNoticeText(noticeId) {
  const { data } = await api.get(`/notices/${encodeURIComponent(noticeId)}/text`);
  return data;
}

export async function retryNoticeProcessing(noticeId) {
  const csrfToken = await refreshCsrfToken();
  const { data } = await api.post(`/notices/${encodeURIComponent(noticeId)}/process`, {}, {
    headers: { 'X-CSRF-Token': csrfToken },
  });
  return data;
}

export async function analyzeNotice(noticeId) {
  const csrfToken = await refreshCsrfToken();
  const { data } = await api.post(
    `/notices/${encodeURIComponent(noticeId)}/analyze`,
    {},
    { headers: { 'X-CSRF-Token': csrfToken } },
  );
  return data;
}

export async function verifyNoticeSource(noticeId, candidate) {
  const csrfToken = await refreshCsrfToken();
  const { data } = await api.post(
    `/notices/${encodeURIComponent(noticeId)}/verify-source`,
    candidate,
    { headers: { 'X-CSRF-Token': csrfToken } },
  );
  return data;
}

export async function getNoticeAnalysis(noticeId) {
  const { data } = await api.get(
    `/notices/${encodeURIComponent(noticeId)}/analysis`,
  );
  return data;
}
