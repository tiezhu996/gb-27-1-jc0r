import { Controller, Get, Post, Param, Body, UseGuards, Request, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { AttendanceService } from './attendance.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StartCheckInDto } from './dto/start-check-in.dto';

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @UseGuards(JwtAuthGuard)
  @Post('sessions')
  startSession(@Body() dto: StartCheckInDto, @Request() req) {
    return this.attendanceService.startSession(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('sessions/:id/close')
  closeSession(@Param('id') id: string, @Request() req) {
    return this.attendanceService.closeSession(req.user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions/active')
  getActiveSession(@Query('liveClassId') liveClassId: string, @Request() req) {
    return this.attendanceService.getActiveSession(liveClassId, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('check-in')
  checkIn(@Body() body: { liveClassId: string }, @Request() req) {
    return this.attendanceService.checkIn(req.user.id, body.liveClassId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('live-class/:liveClassId/summary')
  getSummary(@Param('liveClassId') liveClassId: string, @Request() req) {
    return this.attendanceService.getSummary(req.user.id, liveClassId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('live-class/:liveClassId/export')
  exportExcel(@Param('liveClassId') liveClassId: string, @Request() req, @Res() res: Response) {
    return this.attendanceService.exportExcel(req.user.id, liveClassId, res);
  }

  @UseGuards(JwtAuthGuard)
  @Get('live-class/:liveClassId')
  getRecordsByLiveClass(@Param('liveClassId') liveClassId: string) {
    return this.attendanceService.getRecordsByLiveClass(liveClassId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('my')
  getMyRecords(@Query('courseId') courseId: string, @Request() req) {
    return this.attendanceService.getMyRecords(req.user.id, courseId);
  }
}
