import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttendanceRecord } from '../../common/entities/attendance-record.entity';
import { CheckInSession } from '../../common/entities/check-in-session.entity';
import { LiveClass } from '../../common/entities/live-class.entity';
import { CourseEnrollment } from '../../common/entities/course-enrollment.entity';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [TypeOrmModule.forFeature([AttendanceRecord, CheckInSession, LiveClass, CourseEnrollment])],
  controllers: [AttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
