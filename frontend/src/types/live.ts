export enum LiveClassStatus {
  SCHEDULED = 'scheduled',
  LIVE = 'live',
  ENDED = 'ended',
}

export interface LiveClass {
  id: string;
  title: string;
  courseId: string;
  lessonId: string;
  teacherId: string;
  status: LiveClassStatus;
  maxParticipants: number;
  currentParticipants: number;
  scheduledStartTime?: Date;
  actualStartTime?: Date;
  endTime?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export enum CheckInSessionStatus {
  ACTIVE = 'active',
  CLOSED = 'closed',
}

export enum AttendanceStatus {
  PRESENT = 'present',
  ABSENT = 'absent',
  LATE = 'late',
}

export interface ActiveCheckInSession {
  id: string;
  liveClassId: string;
  durationMinutes: number;
  lateGraceMinutes: number;
  startedAt: string;
  normalEndTime: string;
  lateEndTime: string;
  phase: 'normal' | 'late';
  myStatus: AttendanceStatus | null;
}

export interface AttendanceSummaryRecord {
  studentId: string;
  studentName: string;
  status: AttendanceStatus;
  checkInTime?: string;
}

export interface AttendanceSummary {
  session: {
    id: string;
    status: CheckInSessionStatus;
    startedAt: string;
    durationMinutes: number;
    lateGraceMinutes: number;
    normalEndTime: string;
    lateEndTime: string;
  } | null;
  expected: number;
  present: number;
  late: number;
  absent: number;
  records: AttendanceSummaryRecord[];
}
