import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import { Workbook } from 'exceljs';
import { Response } from 'express';
import { AttendanceRecord, AttendanceStatus } from '../../common/entities/attendance-record.entity';
import { CheckInSession, CheckInPhase } from '../../common/entities/check-in-session.entity';
import { LiveClass, LiveClassStatus } from '../../common/entities/live-class.entity';
import { CourseEnrollment } from '../../common/entities/course-enrollment.entity';

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  [AttendanceStatus.PRESENT]: '正常',
  [AttendanceStatus.LATE]: '迟到',
  [AttendanceStatus.ABSENT]: '缺勤',
};

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(AttendanceRecord)
    private readonly attendanceRepository: Repository<AttendanceRecord>,
    @InjectRepository(CheckInSession)
    private readonly sessionRepository: Repository<CheckInSession>,
    @InjectRepository(LiveClass)
    private readonly liveClassRepository: Repository<LiveClass>,
    @InjectRepository(CourseEnrollment)
    private readonly enrollmentRepository: Repository<CourseEnrollment>,
  ) {}

  /** 计算签到当前所处阶段：正常 / 迟到宽限 / 已关闭 */
  private getPhase(session: CheckInSession, now: Date = new Date()): CheckInPhase {
    if (session.closedAt || now.getTime() > new Date(session.lateEndAt).getTime()) {
      return CheckInPhase.CLOSED;
    }
    if (now.getTime() > new Date(session.presentEndAt).getTime()) {
      return CheckInPhase.LATE;
    }
    return CheckInPhase.PRESENT;
  }

  private serializeSession(session: CheckInSession | null, now: Date = new Date()) {
    if (!session) return null;
    return {
      ...session,
      phase: this.getPhase(session, now),
    };
  }

  private async getOwnedLiveClass(liveClassId: string, teacherId: string): Promise<LiveClass> {
    const liveClass = await this.liveClassRepository.findOne({
      where: { id: liveClassId },
      relations: ['course', 'teacher'],
    });
    if (!liveClass) {
      throw new NotFoundException('直播课堂不存在');
    }
    if (liveClass.teacherId !== teacherId) {
      throw new ForbiddenException('仅授课老师可操作签到');
    }
    return liveClass;
  }

  /** 老师发起限时签到：设置签到分钟数与迟到宽限 */
  async createSession(
    teacherId: string,
    liveClassId: string,
    durationMinutes: number,
    graceMinutes: number = 0,
  ) {
    const liveClass = await this.getOwnedLiveClass(liveClassId, teacherId);
    if (liveClass.status !== LiveClassStatus.LIVE) {
      throw new BadRequestException('直播开始后才能发起签到');
    }

    const openSession = await this.sessionRepository.findOne({
      where: { liveClassId, closedAt: null },
      order: { startedAt: 'DESC' },
    });
    if (openSession && this.getPhase(openSession) !== CheckInPhase.CLOSED) {
      throw new BadRequestException('已有进行中的签到，请勿重复发起');
    }

    const now = new Date();
    const session = this.sessionRepository.create({
      liveClassId,
      teacherId,
      durationMinutes,
      graceMinutes,
      startedAt: now,
      presentEndAt: new Date(now.getTime() + durationMinutes * 60 * 1000),
      lateEndAt: new Date(
        now.getTime() + (durationMinutes + graceMinutes) * 60 * 1000,
      ),
      closedAt: null,
    });
    return this.sessionRepository.save(session).then((s) => this.serializeSession(s, now));
  }

  /** 老师提前关闭签到，关闭后不再接收 */
  async closeSession(teacherId: string, liveClassId: string) {
    await this.getOwnedLiveClass(liveClassId, teacherId);

    const session = await this.sessionRepository.findOne({
      where: { liveClassId, closedAt: null },
      order: { startedAt: 'DESC' },
    });
    if (!session) {
      throw new BadRequestException('当前没有进行中的签到');
    }

    session.closedAt = new Date();
    return this.sessionRepository.save(session).then((s) => this.serializeSession(s));
  }

  /** 查询某场直播当前（最近一次）签到 */
  async getActiveSession(liveClassId: string) {
    const liveClass = await this.liveClassRepository.findOne({ where: { id: liveClassId } });
    if (!liveClass) {
      throw new NotFoundException('直播课堂不存在');
    }
    const session = await this.sessionRepository.findOne({
      where: { liveClassId },
      order: { startedAt: 'DESC' },
    });
    return this.serializeSession(session);
  }

  /**
   * 学生签到。以下情况均不产生记录：
   * - 课堂未开始（或已结束）
   * - 老师未发起签到 / 签到已关闭（含迟到宽限超时）
   * - 重复提交
   * - 非本课程报名账号
   */
  async checkIn(studentId: string, liveClassId: string) {
    const liveClass = await this.liveClassRepository.findOne({ where: { id: liveClassId } });
    if (!liveClass) {
      throw new NotFoundException('直播课堂不存在');
    }
    if (liveClass.status !== LiveClassStatus.LIVE) {
      throw new BadRequestException('直播未开始或已结束，暂不能签到');
    }

    const session = await this.sessionRepository.findOne({
      where: { liveClassId },
      order: { startedAt: 'DESC' },
    });
    if (!session) {
      throw new BadRequestException('老师尚未发起签到');
    }

    const now = new Date();
    const phase = this.getPhase(session, now);
    if (phase === CheckInPhase.CLOSED) {
      throw new BadRequestException('签到已关闭，无法再签到');
    }

    const existing = await this.attendanceRepository.findOne({
      where: { studentId, liveClassId },
    });
    if (existing) {
      throw new ConflictException('您已完成签到，请勿重复提交');
    }

    const enrollment = await this.enrollmentRepository.findOne({
      where: { studentId, courseId: liveClass.courseId },
    });
    if (!enrollment) {
      throw new ForbiddenException('您未报名本课程，无法签到');
    }

    const status =
      phase === CheckInPhase.LATE ? AttendanceStatus.LATE : AttendanceStatus.PRESENT;

    const record = this.attendanceRepository.create({
      studentId,
      liveClassId,
      status,
      checkInTime: now,
      signInDuration: Math.max(
        0,
        Math.round((now.getTime() - new Date(session.startedAt).getTime()) / 1000),
      ),
    });

    try {
      return await this.attendanceRepository.save(record);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string })?.code === '23505'
      ) {
        throw new ConflictException('您已完成签到，请勿重复提交');
      }
      throw error;
    }
  }

  /** 按课程报名学生生成名单，并汇总应到/实到/迟到/缺勤 */
  private async buildOverview(liveClass: LiveClass) {
    const enrollments = await this.enrollmentRepository.find({
      where: { courseId: liveClass.courseId },
      relations: ['student'],
    });

    const records = await this.attendanceRepository.find({ where: { liveClassId: liveClass.id } });
    const recordByStudent = new Map(records.map((r) => [r.studentId, r]));

    const roster = enrollments
      .map((enrollment) => {
        const record = recordByStudent.get(enrollment.studentId);
        return {
          studentId: enrollment.studentId,
          studentName: enrollment.student?.name ?? '',
          email: enrollment.student?.email ?? '',
          phone: enrollment.student?.phone ?? null,
          status: record?.status ?? AttendanceStatus.ABSENT,
          checkInTime: record?.checkInTime ?? null,
        };
      })
      .sort((a, b) => {
        const weight = (s: AttendanceStatus) =>
          s === AttendanceStatus.PRESENT ? 0 : s === AttendanceStatus.LATE ? 1 : 2;
        return weight(a.status) - weight(b.status) || a.studentName.localeCompare(b.studentName);
      });

    const presentCount = roster.filter((r) => r.status === AttendanceStatus.PRESENT).length;
    const lateCount = roster.filter((r) => r.status === AttendanceStatus.LATE).length;
    const expectedCount = roster.length;
    const actualCount = presentCount + lateCount;

    return {
      liveClass: {
        id: liveClass.id,
        title: liveClass.title,
        status: liveClass.status,
        courseName: liveClass.course?.name ?? '',
        teacherName: liveClass.teacher?.name ?? '',
        actualStartTime: liveClass.actualStartTime ?? null,
        endTime: liveClass.endTime ?? null,
      },
      summary: {
        expected: expectedCount,
        actual: actualCount,
        present: presentCount,
        late: lateCount,
        absent: expectedCount - actualCount,
      },
      session: this.serializeSession(
        await this.sessionRepository.findOne({
          where: { liveClassId: liveClass.id },
          order: { startedAt: 'DESC' },
        }),
      ),
      roster,
    };
  }

  /** 老师查看考勤总览 */
  async getOverview(teacherId: string, liveClassId: string) {
    const liveClass = await this.getOwnedLiveClass(liveClassId, teacherId);
    return this.buildOverview(liveClass);
  }

  /** 直播结束后导出 Excel 考勤表 */
  async exportAttendance(teacherId: string, liveClassId: string, res: Response) {
    const liveClass = await this.getOwnedLiveClass(liveClassId, teacherId);
    if (liveClass.status !== LiveClassStatus.ENDED) {
      throw new BadRequestException('直播结束后才可导出考勤表');
    }

    const overview = await this.buildOverview(liveClass);

    const workbook = new Workbook();
    const worksheet = workbook.addWorksheet('考勤表');
    worksheet.columns = [
      { header: '序号', key: 'index', width: 8 },
      { header: '学生姓名', key: 'studentName', width: 16 },
      { header: '邮箱', key: 'email', width: 28 },
      { header: '出勤状态', key: 'statusLabel', width: 12 },
      { header: '签到时间', key: 'checkInTimeText', width: 22 },
    ];

    worksheet.addRow([`课堂：${overview.liveClass.title}`]);
    worksheet.addRow([`课程：${overview.liveClass.courseName}`]);
    worksheet.addRow([
      `应到 ${overview.summary.expected} 人　实到 ${overview.summary.actual} 人　` +
        `正常 ${overview.summary.present} 人　迟到 ${overview.summary.late} 人　缺勤 ${overview.summary.absent} 人`,
    ]);
    worksheet.addRow([]);

    const headerRow = worksheet.addRow({
      index: '序号',
      studentName: '学生姓名',
      email: '邮箱',
      statusLabel: '出勤状态',
      checkInTimeText: '签到时间',
    });
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF2F2F2' },
      };
    });

    overview.roster.forEach((item, i) => {
      worksheet.addRow({
        index: i + 1,
        studentName: item.studentName,
        email: item.email,
        statusLabel: STATUS_LABELS[item.status],
        checkInTimeText: item.checkInTime
          ? new Date(item.checkInTime).toLocaleString('zh-CN', { hour12: false })
          : '',
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = `${overview.liveClass.title}-考勤表.xlsx`;
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="attendance.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
    res.send(Buffer.from(buffer));
  }

  async getMyRecords(studentId: string, courseId?: string) {
    const queryBuilder = this.attendanceRepository
      .createQueryBuilder('record')
      .leftJoinAndSelect('record.liveClass', 'liveClass')
      .leftJoinAndSelect('record.student', 'student')
      .where('record.studentId = :studentId', { studentId });

    if (courseId) {
      queryBuilder.andWhere('liveClass.courseId = :courseId', { courseId });
    }

    return queryBuilder.orderBy('record.createdAt', 'DESC').getMany();
  }
}
