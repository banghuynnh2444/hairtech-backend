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
import { ClientsService } from './clients.service';
import {
  ClientValidationPipe,
  CreateClientDto,
  UpdateClientDto,
} from './clients.dto';

@Controller('clients')
@UseGuards(JwtAuthGuard, LicenseGuard)
@UsePipes(ClientValidationPipe)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  async getAll(@Req() req: any) {
    return this.clientsService.findAll(req.user.sub);
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @Req() req: any) {
    return this.clientsService.findOne(id, req.user.sub);
  }

  @Post()
  async create(@Body() body: CreateClientDto, @Req() req: any) {
    return this.clientsService.create(body, req.user.sub);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateClientDto,
    @Req() req: any,
  ) {
    return this.clientsService.update(id, body, req.user.sub);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.clientsService.delete(id, req.user.sub);
  }
}
