import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LicenseGuard } from '../license/guards/license.guard';
import { DiagramsService } from './diagrams.service';
import { CreateDiagramDto, UpdateDiagramDto, DiagramValidationPipe } from './diagrams.dto';

@Controller('diagrams')
@UseGuards(JwtAuthGuard, LicenseGuard)
@UsePipes(DiagramValidationPipe)
export class DiagramsController {
  constructor(private readonly diagramsService: DiagramsService) {}

  @Get('client/:clientId')
  async getByClient(
    @Param('clientId') clientId: string,
    @Req() req: any,
  ) {
    return this.diagramsService.findByClient(clientId, req.user.sub);
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: any) {
    return this.diagramsService.findOne(id, req.user.sub);
  }

  @Post()
  async create(@Body() body: CreateDiagramDto, @Req() req: any) {
    return this.diagramsService.create(body, req.user.sub);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateDiagramDto,
    @Req() req: any,
  ) {
    return this.diagramsService.update(id, body, req.user.sub);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.diagramsService.delete(id, req.user.sub);
  }
}
