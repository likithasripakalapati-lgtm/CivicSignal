import { api } from './api.js';

export async function getAreas() {
  const { data } = await api.get('/areas');
  return data;
}

export async function getAreaImpact(areaId) {
  const { data } = await api.get(`/areas/${encodeURIComponent(areaId)}/impact`);
  return data;
}
