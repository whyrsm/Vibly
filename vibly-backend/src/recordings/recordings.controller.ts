import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RecordingsService } from './recordings.service';
import { InitRecordingDto, CompleteRecordingDto } from './dto/recordings.dto';

@Controller('api')
export class RecordingsController {
  constructor(private recordingsService: RecordingsService) {}

  @Post('recordings/init')
  @UseGuards(AuthGuard('jwt'))
  async initRecording(
    @Req() req: { user: { id: string } },
    @Body() dto: InitRecordingDto,
  ) {
    return this.recordingsService.initRecording(req.user.id, dto);
  }

  @Post('recordings/:id/complete')
  @UseGuards(AuthGuard('jwt'))
  async completeRecording(
    @Req() req: { user: { id: string } },
    @Param('id') recordingId: string,
    @Body() dto: CompleteRecordingDto,
  ) {
    return this.recordingsService.completeRecording(
      req.user.id,
      recordingId,
      dto,
    );
  }

  @Get('recordings')
  @UseGuards(AuthGuard('jwt'))
  async getUserRecordings(@Req() req: { user: { id: string } }) {
    return this.recordingsService.getUserRecordings(req.user.id);
  }

  @Delete('recordings/:id')
  @UseGuards(AuthGuard('jwt'))
  async deleteRecording(
    @Req() req: { user: { id: string } },
    @Param('id') recordingId: string,
  ) {
    return this.recordingsService.deleteRecording(req.user.id, recordingId);
  }

  // Public endpoint - no auth required
  @Get('watch/:shareToken')
  async watchRecording(@Param('shareToken') shareToken: string) {
    return this.recordingsService.getRecordingByShareToken(shareToken);
  }
}
