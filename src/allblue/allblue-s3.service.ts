import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

@Injectable()
export class AllblueS3Service {
  private s3: S3Client | null = null;
  private bucket: string;
  private region: string;

  constructor(private config: ConfigService) {
    this.region = this.config.get<string>('AWS_REGION', '');
    this.bucket = this.config.get<string>('AWS_S3_BUCKET', '');
    const accessKeyId = this.config.get<string>('AWS_ACCESS_KEY_ID', '');
    const secretAccessKey = this.config.get<string>('AWS_SECRET_ACCESS_KEY', '');

    if (this.region && this.bucket && accessKeyId && secretAccessKey) {
      this.s3 = new S3Client({
        region: this.region,
        credentials: { accessKeyId, secretAccessKey },
      });
    }
  }

  get isEnabled(): boolean {
    return this.s3 !== null;
  }

  async uploadSignature(base64Data: string, uuid: string, type: 'diver' | 'doctor'): Promise<string> {
    if (!this.s3) {
      return base64Data;
    }

    const base64Body = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Body, 'base64');
    const key = `signatures/${uuid}_${type}_${Date.now()}.png`;

    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: 'image/png',
    }));

    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  async processSignatureData(data: string | undefined, uuid: string, type: 'diver' | 'doctor'): Promise<string | undefined> {
    if (!data) return data;
    if (data.startsWith('http')) return data;
    if (data.startsWith('data:')) return this.uploadSignature(data, uuid, type);
    return data;
  }
}
