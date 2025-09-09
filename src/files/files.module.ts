// src/files/files.module.ts
import { Module, OnModuleInit } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, basename } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { FilesController } from './files.controller';

function filenameFactory(_req: any, file: Express.Multer.File, cb: (e: any, name: string) => void) {
  const ext = extname(file.originalname);
  const base = basename(file.originalname, ext).replace(/\s+/g, '_');
  const uniq = Date.now() + '_' + Math.round(Math.random() * 1e9);
  cb(null, `${base}_${uniq}${ext}`);
}

@Module({
  imports: [
    MulterModule.register({
      storage: diskStorage({
        destination: './uploads',
        filename: filenameFactory, 
      }),
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
      },
    }),
  ],
  controllers: [FilesController],
})
export class FilesModule implements OnModuleInit {
  onModuleInit() {
    // 업로드 폴더 보장
    if (!existsSync('./uploads')) {
      mkdirSync('./uploads', { recursive: true });
    }
  }
}