import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LicenseGuard } from '../license/guards/license.guard';
import { MAX_PHOTO_BYTES, PhotosService, type UploadedPhotoFile } from './photos.service';

@Controller('clients/:clientId/photos')
@UseGuards(JwtAuthGuard, LicenseGuard)
export class PhotosController {
  constructor(private readonly photosService: PhotosService) {}

  @Get()
  list(@Param('clientId') clientId: string, @Req() req: any) {
    return this.photosService.list(clientId, req.user.sub);
  }

  @Post(':kind')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
  }))
  upload(
    @Param('clientId') clientId: string,
    @Param('kind') kind: string,
    @UploadedFile() file: UploadedPhotoFile | undefined,
    @Req() req: any,
  ) {
    return this.photosService.upload(clientId, req.user.sub, kind, file);
  }

  @Delete(':photoId')
  remove(
    @Param('clientId') clientId: string,
    @Param('photoId') photoId: string,
    @Req() req: any,
  ) {
    return this.photosService.remove(clientId, photoId, req.user.sub);
  }
}
