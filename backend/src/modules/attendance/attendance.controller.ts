import { Controller, Get, Post, Param, Body, UseGuards, Request, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateCheckInDto } from './dto/create-check-in.dto';

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  /** 老师在直播中发起限时签到 */
  @UseGuards(JwtAuthGuard)
  @Post('live-class/:liveClassId/session')
  createSession(
    @Param('liveClassId') liveClassId: string,
    @Body() dto: CreateCheckInDto,
    @Request() req,
  ) {
    return this.attendanceService.createSession(
      req.user.id,
      liveClassId,
      dto.durationMinutes,
      dto.graceMinutes ?? 0,
    );
  }

  /** 老师关闭签到 */
  @UseGuards(JwtAuthGuard)
  @Post('live-class/:liveClassId/session/close')
  closeSession(@Param('liveClassId') liveClassId: string, @Request() req) {
    return this.attendanceService.closeSession(req.user.id, liveClassId);
  }

  /** 查询当前签到状态（学生端用于显示倒计时与可签状态） */
  @UseGuards(JwtAuthGuard)
  @Get('live-class/:liveClassId/session')
  getActiveSession(@Param('liveClassId') liveClassId: string) {
    return this.attendanceService.getActiveSession(liveClassId);
  }

  /** 学生签到 */
  @UseGuards(JwtAuthGuard)
  @Post('check-in')
  checkIn(@Body() body: { liveClassId: string }, @Request() req) {
    return this.attendanceService.checkIn(req.user.id, body.liveClassId);
  }

  /** 老师查看应到/实到/迟到/缺勤与名单 */
  @UseGuards(JwtAuthGuard)
  @Get('live-class/:liveClassId/overview')
  getOverview(@Param('liveClassId') liveClassId: string, @Request() req) {
    return this.attendanceService.getOverview(req.user.id, liveClassId);
  }

  /** 直播结束后老师导出 Excel 考勤表 */
  @UseGuards(JwtAuthGuard)
  @Get('live-class/:liveClassId/export')
  exportAttendance(
    @Param('liveClassId') liveClassId: string,
    @Request() req,
    @Res() res: Response,
  ) {
    return this.attendanceService.exportAttendance(req.user.id, liveClassId, res);
  }

  @UseGuards(JwtAuthGuard)
  @Get('my')
  getMyRecords(@Query('courseId') courseId: string, @Request() req) {
    return this.attendanceService.getMyRecords(req.user.id, courseId);
  }
}
