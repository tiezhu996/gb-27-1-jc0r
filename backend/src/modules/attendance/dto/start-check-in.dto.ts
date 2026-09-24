import { IsUUID, IsInt, Min, Max } from 'class-validator';

export class StartCheckInDto {
  @IsUUID()
  liveClassId: string;

  @IsInt()
  @Min(1)
  @Max(120)
  durationMinutes: number;

  @IsInt()
  @Min(0)
  @Max(60)
  lateGraceMinutes: number;
}
