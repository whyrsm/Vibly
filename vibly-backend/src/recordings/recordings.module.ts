import { Module } from '@nestjs/common';
import { RecordingsController } from './recordings.controller';
import { RecordingsService } from './recordings.service';
import { R2Module } from '../r2/r2.module';

@Module({
  imports: [R2Module],
  controllers: [RecordingsController],
  providers: [RecordingsService],
})
export class RecordingsModule {}
