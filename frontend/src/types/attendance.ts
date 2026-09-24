export enum AttendanceStatus {
  PRESENT = 'present',
  LATE = 'late',
  ABSENT = 'absent',
}

export enum CheckInPhase {
  PRESENT = 'present',
  LATE = 'late',
  CLOSED = 'closed',
}

export interface CheckInSession {
  id: string;
  liveClassId: string;
  teacherId: string;
  durationMinutes: number;
  graceMinutes: number;
  startedAt: string;
  presentEndAt: string;
  lateEndAt: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** 服务端根据当前时间计算的阶段 */
  phase?: CheckInPhase;
}

export interface AttendanceRosterItem {
  studentId: string;
  studentName: string;
  email: string;
  phone: string | null;
  status: AttendanceStatus;
  checkInTime: string | null;
}

export interface AttendanceOverview {
  liveClass: {
    id: string;
    title: string;
    status: string;
    courseName: string;
    teacherName: string;
    actualStartTime: string | null;
    endTime: string | null;
  };
  summary: {
    expected: number;
    actual: number;
    present: number;
    late: number;
    absent: number;
  };
  session: CheckInSession | null;
  roster: AttendanceRosterItem[];
}
