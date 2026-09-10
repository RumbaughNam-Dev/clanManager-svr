import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';

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
    const key = `allblue/signatures/${uuid}_${type}_${Date.now()}.png`;

    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: 'image/png',
    }));

    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  async uploadFile(buffer: Buffer, key: string, contentType: string, contentDisposition?: string): Promise<string | null> {
    if (!this.s3) {
      console.error('[S3 Upload Error] S3 client not initialized — check AWS env vars');
      return null;
    }

    try {
      await this.s3.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ...(contentDisposition && { ContentDisposition: contentDisposition }),
      }));

      return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
    } catch (err) {
      console.error('[S3 Upload Error]', err);
      return null;
    }
  }

  async deleteFiles(keys: string[]): Promise<void> {
    if (!this.s3 || keys.length === 0) return;

    await this.s3.send(new DeleteObjectsCommand({
      Bucket: this.bucket,
      Delete: {
        Objects: keys.map(Key => ({ Key })),
      },
    }));
  }

  extractKeyFromUrl(url: string): string | null {
    const prefix = `https://${this.bucket}.s3.${this.region}.amazonaws.com/`;
    if (url.startsWith(prefix)) {
      return url.slice(prefix.length);
    }
    return null;
  }

  async processSignatureData(data: string | undefined, uuid: string, type: 'diver' | 'doctor'): Promise<string | undefined> {
    if (!data) return data;
    if (data.startsWith('http')) return data;
    if (data.startsWith('data:')) return this.uploadSignature(data, uuid, type);
    return data;
  }
}
