import { api } from './index';
import { LiveClass, ActiveCheckInSession, AttendanceSummary } from '@/types/live';

export const liveClassApi = {
  list: () => api.get<LiveClass[]>('/live-classes').then(res => res.data),
  get: (id: string) => api.get<LiveClass>(`/live-classes/${id}`).then(res => res.data),
  create: (data: Partial<LiveClass>) => api.post<LiveClass>('/live-classes', data).then(res => res.data),
  start: (id: string) => api.post<LiveClass>(`/live-classes/${id}/start`).then(res => res.data),
  end: (id: string) => api.post<LiveClass>(`/live-classes/${id}/end`).then(res => res.data),
};

export const attendanceApi = {
  checkIn: (liveClassId: string) => api.post('/attendance/check-in', { liveClassId }).then(res => res.data),
  getByLiveClass: (liveClassId: string) => api.get(`/attendance/live-class/${liveClassId}`).then(res => res.data),
  getMyRecords: (courseId?: string) => api.get('/attendance/my', { params: { courseId } }).then(res => res.data),
  startSession: (data: { liveClassId: string; durationMinutes: number; lateGraceMinutes: number }) =>
    api.post('/attendance/sessions', data).then(res => res.data),
  closeSession: (sessionId: string) => api.post(`/attendance/sessions/${sessionId}/close`).then(res => res.data),
  getActiveSession: (liveClassId: string) =>
    api.get<ActiveCheckInSession | null>('/attendance/sessions/active', { params: { liveClassId } }).then(res => res.data),
  getSummary: (liveClassId: string) =>
    api.get<AttendanceSummary>(`/attendance/live-class/${liveClassId}/summary`).then(res => res.data),
  exportExcel: (liveClassId: string) =>
    api.get(`/attendance/live-class/${liveClassId}/export`, { responseType: 'blob' }).then(res => res.data),
};
