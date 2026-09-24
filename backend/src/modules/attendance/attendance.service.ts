import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Response } from 'express';
import * as ExcelJS from 'exceljs';
import { AttendanceRecord, AttendanceStatus } from '../../common/entities/attendance-record.entity';
import { CheckInSession, CheckInSessionStatus } from '../../common/entities/check-in-session.entity';
import { LiveClass, LiveClassStatus } from '../../common/entities/live-class.entity';
import { CourseEnrollment } from '../../common/entities/course-enrollment.entity';
import { StartCheckInDto } from './dto/start-check-in.dto';

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

  private getNormalEndTime(session: CheckInSession): Date {
    return new Date(session.startedAt.getTime() + session.durationMinutes * 60 * 1000);
  }

  private getLateEndTime(session: CheckInSession): Date {
    return new Date(this.getNormalEndTime(session).getTime() + session.lateGraceMinutes * 60 * 1000);
  }

  /** 迟到宽限时间也已过，则惰性关闭会话 */
  private async closeIfExpired(session: CheckInSession): Promise<CheckInSession> {
    if (session.status === CheckInSessionStatus.ACTIVE && new Date() > this.getLateEndTime(session)) {
      session.status = CheckInSessionStatus.CLOSED;
      session.closedAt = this.getLateEndTime(session);
      return this.sessionRepository.save(session);
    }
    return session;
  }

  /** 老师发起限时签到：直播进行中才可发起，并按课程报名学生生成考勤名单 */
  async startSession(teacherId: string, dto: StartCheckInDto) {
    const liveClass = await this.liveClassRepository.findOne({ where: { id: dto.liveClassId } });
    if (!liveClass) {
      throw new NotFoundException('直播课堂不存在');
    }
    if (liveClass.teacherId !== teacherId) {
      throw new ForbiddenException('只有授课老师才能发起签到');
    }
    if (liveClass.status !== LiveClassStatus.LIVE) {
      throw new BadRequestException('直播未开始，无法发起签到');
    }

    const existingActive = await this.sessionRepository.findOne({
      where: { liveClassId: dto.liveClassId, status: CheckInSessionStatus.ACTIVE },
    });
    if (existingActive) {
      await this.closeIfExpired(existingActive);
      if (existingActive.status === CheckInSessionStatus.ACTIVE) {
        throw new BadRequestException('当前已有进行中的签到，请先关闭');
      }
    }

    const session = await this.sessionRepository.save(
      this.sessionRepository.create({
        liveClassId: dto.liveClassId,
        durationMinutes: dto.durationMinutes,
        lateGraceMinutes: dto.lateGraceMinutes,
        startedAt: new Date(),
        status: CheckInSessionStatus.ACTIVE,
      }),
    );

    // 名单按课程报名学生生成，初始均为缺勤
    const enrollments = await this.enrollmentRepository.find({
      where: { courseId: liveClass.courseId },
    });
    if (enrollments.length > 0) {
      const records = enrollments.map((enrollment) =>
        this.attendanceRepository.create({
          liveClassId: dto.liveClassId,
          sessionId: session.id,
          studentId: enrollment.studentId,
          status: AttendanceStatus.ABSENT,
        }),
      );
      await this.attendanceRepository.save(records);
    }

    return session;
  }

  /** 老师提前关闭签到，关闭后不再接收提交 */
  async closeSession(teacherId: string, sessionId: string) {
    const session = await this.sessionRepository.findOne({ where: { id: sessionId } });
    if (!session) {
      throw new NotFoundException('签到会话不存在');
    }
    const liveClass = await this.liveClassRepository.findOne({ where: { id: session.liveClassId } });
    if (!liveClass || liveClass.teacherId !== teacherId) {
      throw new ForbiddenException('无权关闭此签到');
    }
    if (session.status === CheckInSessionStatus.CLOSED) {
      throw new BadRequestException('签到已关闭');
    }
    session.status = CheckInSessionStatus.CLOSED;
    session.closedAt = new Date();
    return this.sessionRepository.save(session);
  }

  /** 学生端查询当前进行中的签到会话及所处阶段（正常/迟到宽限），并带上本人的签到状态 */
  async getActiveSession(liveClassId: string, studentId?: string) {
    let session = await this.sessionRepository.findOne({
      where: { liveClassId, status: CheckInSessionStatus.ACTIVE },
      order: { startedAt: 'DESC' },
    });
    if (!session) {
      return null;
    }
    session = await this.closeIfExpired(session);
    if (session.status !== CheckInSessionStatus.ACTIVE) {
      return null;
    }

    let myStatus: AttendanceStatus | null = null;
    if (studentId) {
      const myRecord = await this.attendanceRepository.findOne({
        where: { sessionId: session.id, studentId },
      });
      if (myRecord && myRecord.status !== AttendanceStatus.ABSENT) {
        myStatus = myRecord.status;
      }
    }

    const now = new Date();
    const normalEndTime = this.getNormalEndTime(session);
    return {
      id: session.id,
      liveClassId: session.liveClassId,
      durationMinutes: session.durationMinutes,
      lateGraceMinutes: session.lateGraceMinutes,
      startedAt: session.startedAt,
      normalEndTime,
      lateEndTime: this.getLateEndTime(session),
      phase: now <= normalEndTime ? 'normal' : 'late',
      myStatus,
    };
  }

  /**
   * 学生签到。以下情况一律拒绝且不产生记录：
   * - 课堂未开始或已结束
   * - 非本课程报名账号
   * - 老师还未发起签到（提前提交）
   * - 签到已关闭或超时
   * - 重复提交
   */
  async checkIn(studentId: string, liveClassId: string) {
    const liveClass = await this.liveClassRepository.findOne({ where: { id: liveClassId } });
    if (!liveClass) {
      throw new NotFoundException('直播课堂不存在');
    }
    if (liveClass.status !== LiveClassStatus.LIVE) {
      throw new BadRequestException('直播未开始或已结束，无法签到');
    }

    const enrollment = await this.enrollmentRepository.findOne({
      where: { studentId, courseId: liveClass.courseId },
    });
    if (!enrollment) {
      throw new ForbiddenException('未报名该课程，无法签到');
    }

    let session = await this.sessionRepository.findOne({
      where: { liveClassId },
      order: { startedAt: 'DESC' },
    });
    if (!session) {
      throw new BadRequestException('老师还未发起签到');
    }
    if (session.status === CheckInSessionStatus.ACTIVE) {
      session = await this.closeIfExpired(session);
    }
    if (session.status !== CheckInSessionStatus.ACTIVE) {
      throw new BadRequestException('签到已结束');
    }

    const existing = await this.attendanceRepository.findOne({
      where: { sessionId: session.id, studentId },
    });
    if (existing && existing.status !== AttendanceStatus.ABSENT) {
      throw new BadRequestException('已完成签到，请勿重复提交');
    }

    const now = new Date();
    const status =
      now <= this.getNormalEndTime(session) ? AttendanceStatus.PRESENT : AttendanceStatus.LATE;

    if (existing) {
      existing.status = status;
      existing.checkInTime = now;
      return this.attendanceRepository.save(existing);
    }

    return this.attendanceRepository.save(
      this.attendanceRepository.create({
        liveClassId,
        sessionId: session.id,
        studentId,
        status,
        checkInTime: now,
      }),
    );
  }

  /** 老师端考勤统计：应到、实到、迟到、缺勤及名单明细 */
  async getSummary(teacherId: string, liveClassId: string) {
    const liveClass = await this.liveClassRepository.findOne({ where: { id: liveClassId } });
    if (!liveClass) {
      throw new NotFoundException('直播课堂不存在');
    }
    if (liveClass.teacherId !== teacherId) {
      throw new ForbiddenException('只有授课老师才能查看考勤统计');
    }

    let session = await this.sessionRepository.findOne({
      where: { liveClassId },
      order: { startedAt: 'DESC' },
    });
    if (session) {
      session = await this.closeIfExpired(session);
    }

    const records = session
      ? await this.attendanceRepository.find({
          where: { sessionId: session.id },
          relations: ['student'],
          order: { checkInTime: 'ASC' },
        })
      : [];

    const present = records.filter((r) => r.status === AttendanceStatus.PRESENT).length;
    const late = records.filter((r) => r.status === AttendanceStatus.LATE).length;

    return {
      session: session
        ? {
            id: session.id,
            status: session.status,
            startedAt: session.startedAt,
            durationMinutes: session.durationMinutes,
            lateGraceMinutes: session.lateGraceMinutes,
            normalEndTime: this.getNormalEndTime(session),
            lateEndTime: this.getLateEndTime(session),
          }
        : null,
      expected: records.length,
      present,
      late,
      absent: records.length - present - late,
      records: records.map((r) => ({
        studentId: r.studentId,
        studentName: r.student?.name || '未知学生',
        status: r.status,
        checkInTime: r.checkInTime,
      })),
    };
  }

  /** 直播结束后导出考勤 Excel */
  async exportExcel(teacherId: string, liveClassId: string, res: Response) {
    const liveClass = await this.liveClassRepository.findOne({ where: { id: liveClassId } });
    if (!liveClass) {
      throw new NotFoundException('直播课堂不存在');
    }
    if (liveClass.teacherId !== teacherId) {
      throw new ForbiddenException('只有授课老师才能导出考勤');
    }
    if (liveClass.status !== LiveClassStatus.ENDED) {
      throw new BadRequestException('直播结束后才能导出考勤报表');
    }

    const session = await this.sessionRepository.findOne({
      where: { liveClassId },
      order: { startedAt: 'DESC' },
    });
    if (!session) {
      throw new BadRequestException('本次直播未发起过签到，无考勤数据');
    }

    const records = await this.attendanceRepository.find({
      where: { sessionId: session.id },
      relations: ['student'],
      order: { checkInTime: 'ASC' },
    });

    const statusText: Record<AttendanceStatus, string> = {
      [AttendanceStatus.PRESENT]: '正常',
      [AttendanceStatus.LATE]: '迟到',
      [AttendanceStatus.ABSENT]: '缺勤',
    };

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('考勤记录');

    worksheet.columns = [
      { header: '学生姓名', key: 'studentName', width: 20 },
      { header: '考勤状态', key: 'statusText', width: 12 },
      { header: '签到时间', key: 'checkInTime', width: 24 },
    ];
    worksheet.getRow(1).font = { bold: true };

    records.forEach((record) => {
      worksheet.addRow({
        studentName: record.student?.name || '未知学生',
        statusText: statusText[record.status],
        checkInTime: record.checkInTime
          ? new Date(record.checkInTime).toLocaleString('zh-CN', { hour12: false })
          : '-',
      });
    });

    const present = records.filter((r) => r.status === AttendanceStatus.PRESENT).length;
    const late = records.filter((r) => r.status === AttendanceStatus.LATE).length;
    worksheet.addRow([]);
    worksheet.addRow(['应到', records.length, '']);
    worksheet.addRow(['实到', present, '']);
    worksheet.addRow(['迟到', late, '']);
    worksheet.addRow(['缺勤', records.length - present - late, '']);

    const filename = encodeURIComponent(`考勤记录-${liveClass.title}.xlsx`);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    await workbook.xlsx.write(res);
    res.end();
  }

  async getRecordsByLiveClass(liveClassId: string) {
    return this.attendanceRepository.find({
      where: { liveClassId },
      relations: ['student'],
    });
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
