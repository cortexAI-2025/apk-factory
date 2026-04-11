import axios from 'axios';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export const api = axios.create({
  baseURL: `${BASE_URL}/api/v1`,
  withCredentials: true,
});

// Attach JWT token from localStorage
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('apk_factory_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 globally
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('apk_factory_token');
      window.location.href = '/auth/login';
    }
    return Promise.reject(err);
  },
);

// --- Auth ---
export const authApi = {
  register: (data: { email: string; name: string; password: string }) =>
    api.post('/auth/register', data).then((r) => r.data),
  login: (data: { email: string; password: string }) =>
    api.post('/auth/login', data).then((r) => r.data),
  profile: () => api.get('/auth/profile').then((r) => r.data),
};

// --- Projects ---
export const projectsApi = {
  list: (page = 1, limit = 20) =>
    api.get('/projects', { params: { page, limit } }).then((r) => r.data),
  get: (id: string) => api.get(`/projects/${id}`).then((r) => r.data),
  uploadZip: (file: File, name?: string, description?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (name) form.append('name', name);
    if (description) form.append('description', description);
    return api.post('/projects/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },
  importUrl: (data: { name: string; sourceUrl: string; sourceType: string; description?: string }) =>
    api.post('/projects/import', data).then((r) => r.data),
  delete: (id: string) => api.delete(`/projects/${id}`).then((r) => r.data),
};

// --- Builds ---
export const buildsApi = {
  create: (projectId: string, data: { buildType: string; autoFix?: boolean }) =>
    api.post(`/projects/${projectId}/builds`, data).then((r) => r.data),
  list: (projectId: string) =>
    api.get(`/projects/${projectId}/builds`).then((r) => r.data),
  get: (projectId: string, buildId: string) =>
    api.get(`/projects/${projectId}/builds/${buildId}`).then((r) => r.data),
  getLogs: (projectId: string, buildId: string, offset = 0, limit = 500) =>
    api
      .get(`/projects/${projectId}/builds/${buildId}/logs`, { params: { offset, limit } })
      .then((r) => r.data),
  generatePublicLink: (projectId: string, buildId: string) =>
    api.post(`/projects/${projectId}/builds/${buildId}/public-link`).then((r) => r.data),
  cancel: (projectId: string, buildId: string) =>
    api.post(`/projects/${projectId}/builds/${buildId}/cancel`).then((r) => r.data),
};

// --- Metrics ---
export const metricsApi = {
  stats: () => api.get('/metrics/stats').then((r) => r.data),
  feed:  (limit = 20) => api.get('/metrics/feed', { params: { limit } }).then((r) => r.data),
  chart: (days = 30)  => api.get('/metrics/chart', { params: { days } }).then((r) => r.data),
};
