import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { LiveClass } from './live-class.entity';
import { CheckInSession } from './check-in-session.entity';
import { User } from './user.entity';

export enum AttendanceStatus {
  PRESENT = 'present',
  ABSENT = 'absent',
  LATE = 'late',
}

@Entity('attendance_records')
export class AttendanceRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  liveClassId: string;

  @Column()
  studentId: string;

  @Column({ nullable: true })
  sessionId: string;

  @Column({ type: 'simple-enum', enum: AttendanceStatus, default: AttendanceStatus.ABSENT })
  status: AttendanceStatus;

  @Column({ type: 'timestamp', nullable: true })
  checkInTime: Date;

  @Column({ type: 'int', default: 0 })
  signInDuration: number;

  @ManyToOne(() => LiveClass)
  @JoinColumn({ name: 'liveClassId' })
  liveClass: LiveClass;

  @ManyToOne(() => CheckInSession)
  @JoinColumn({ name: 'sessionId' })
  session: CheckInSession;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'studentId' })
  student: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
