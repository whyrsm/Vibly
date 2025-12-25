import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class InitRecordingDto {
  @IsNumber()
  @Min(1)
  estimatedSize: number; // in bytes

  @IsNumber()
  @Min(1)
  partCount: number;
}

class PartDto {
  @IsNumber()
  partNumber: number;

  @IsString()
  etag: string;
}

export class CompleteRecordingDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PartDto)
  parts: PartDto[];

  @IsNumber()
  @Min(1)
  duration: number; // in seconds

  @IsString()
  @IsOptional()
  title?: string;
}
