import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class CreateCheckInDto {
  /** 正常签到时长（分钟） */
  @IsInt()
  @Min(1)
  @Max(300)
  durationMinutes: number;

  /** 迟到宽限时长（分钟），可为 0 表示不设宽限 */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(300)
  graceMinutes?: number;
}
