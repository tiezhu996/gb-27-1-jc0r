import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { LiveClass } from './live-class.entity';
import { User } from './user.entity';

export enum CheckInPhase {
  PRESENT = 'present',
  LATE = 'late',
  CLOSED = 'closed',
}

/**
 * 老师发起的限时签到。
 * - presentEndAt 之前为正常签到时段
 * - presentEndAt ~ lateEndAt 为迟到宽限时段
 * - 老师手动关闭（closedAt）或超过 lateEndAt 后不再接收签到
 */
@Entity('check_in_sessions')
export class CheckInSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  liveClassId: string;

  @Column()
  teacherId: string;

  @Column({ type: 'int' })
  durationMinutes: number;

  @Column({ type: 'int' })
  graceMinutes: number;

  @Column({ type: 'timestamp' })
  startedAt: Date;

  @Column({ type: 'timestamp' })
  presentEndAt: Date;

  @Column({ type: 'timestamp' })
  lateEndAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  closedAt: Date | null;

  @ManyToOne(() => LiveClass)
  @JoinColumn({ name: 'liveClassId' })
  liveClass: LiveClass;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'teacherId' })
  teacher: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
