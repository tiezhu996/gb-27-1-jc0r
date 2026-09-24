import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { LiveClass } from './live-class.entity';

export enum CheckInSessionStatus {
  ACTIVE = 'active',
  CLOSED = 'closed',
}

@Entity('check_in_sessions')
export class CheckInSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  liveClassId: string;

  @Column({ type: 'int' })
  durationMinutes: number;

  @Column({ type: 'int', default: 0 })
  lateGraceMinutes: number;

  @Column({ type: 'timestamp' })
  startedAt: Date;

  @Column({ type: 'simple-enum', enum: CheckInSessionStatus, default: CheckInSessionStatus.ACTIVE })
  status: CheckInSessionStatus;

  @Column({ type: 'timestamp', nullable: true })
  closedAt: Date;

  @ManyToOne(() => LiveClass)
  @JoinColumn({ name: 'liveClassId' })
  liveClass: LiveClass;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
