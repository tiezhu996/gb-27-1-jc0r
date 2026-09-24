import { api } from './index';
import { LiveClass, LiveClassStatus } from '@/types/live';
import {
  AttendanceOverview,
  CheckInSession,
} from '@/types/attendance';

export const liveClassApi = {
  list: () => api.get<LiveClass[]>('/live-classes').then(res => res.data),
  get: (id: string) => api.get<LiveClass>(`/live-classes/${id}`).then(res => res.data),
  create: (data: Partial<LiveClass>) => api.post<LiveClass>('/live-classes', data).then(res => res.data),
  start: (id: string) => api.post<LiveClass>(`/live-classes/${id}/start`).then(res => res.data),
  end: (id: string) => api.post<LiveClass>(`/live-classes/${id}/end`).then(res => res.data),
};

export const attendanceApi = {
  checkIn: (liveClassId: string) =>
    api.post('/attendance/check-in', { liveClassId }).then(res => res.data),
  getByLiveClass: (liveClassId: string) =>
    api.get(`/attendance/live-class/${liveClassId}`).then(res => res.data),
  getMyRecords: (courseId?: string) =>
    api.get('/attendance/my', { params: { courseId } }).then(res => res.data),
  /** 老师发起限时签到 */
  createSession: (liveClassId: string, durationMinutes: number, graceMinutes: number) =>
    api
      .post<CheckInSession>(`/attendance/live-class/${liveClassId}/session`, {
        durationMinutes,
        graceMinutes,
      })
      .then(res => res.data),
  /** 老师关闭签到 */
  closeSession: (liveClassId: string) =>
    api
      .post<CheckInSession>(`/attendance/live-class/${liveClassId}/session/close`)
      .then(res => res.data),
  /** 查询当前签到状态 */
  getSession: (liveClassId: string) =>
    api
      .get<CheckInSession | null>(`/attendance/live-class/${liveClassId}/session`)
      .then(res => res.data),
  /** 老师查看考勤总览 */
  getOverview: (liveClassId: string) =>
    api
      .get<AttendanceOverview>(`/attendance/live-class/${liveClassId}/overview`)
      .then(res => res.data),
  /** 直播结束后导出 Excel 考勤表（带鉴权下载） */
  exportAttendance: async (liveClassId: string) => {
    const res = await api.get(`/attendance/live-class/${liveClassId}/export`, {
      responseType: 'blob',
    });
    const disposition = res.headers['content-disposition'] as string | undefined;
    let fileName = '考勤表.xlsx';
    const matched = disposition?.match(/filename\*=UTF-8''([^;]+)/i);
    if (matched) fileName = decodeURIComponent(matched[1]);

    const url = URL.createObjectURL(res.data as Blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  },
};
