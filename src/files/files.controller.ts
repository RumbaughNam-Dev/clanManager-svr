// src/files/files.controller.ts
import {
  BadRequestException,
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('v1/files')
@UseGuards(JwtAuthGuard) // 업로드는 로그인 필요
export class FilesController {
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('파일이 업로드되지 않았습니다.');
    }
    // 프론트가 기대하는 형태로 응답
    return { ok: true, fileName: file.filename };
  }
}