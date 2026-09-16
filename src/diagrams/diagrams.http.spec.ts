import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DiagramsController } from './diagrams.controller';
import { DiagramsService } from './diagrams.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LicenseGuard } from '../license/guards/license.guard';
import { configureHttpBodyParsers } from './diagrams.http';
import { sampleProject } from './diagrams.fixture';

describe('Diagrams HTTP contract', () => {
  let app: INestApplication;
  const create = jest.fn().mockImplementation(async body => body);
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DiagramsController], providers: [{ provide: DiagramsService, useValue: { create } }],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: (context: any) => {
      context.switchToHttp().getRequest().user = { sub: 'owner' }; return true;
    } }).overrideGuard(LicenseGuard).useValue({ canActivate: () => true }).compile();
    app = module.createNestApplication({ bodyParser: false });
    configureHttpBodyParsers(app);
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => create.mockClear());
  it('accepts a project larger than the old 100 KB limit', async () => {
    const project = sampleProject();
    project.settings.large_fixture = 'x'.repeat(150000);
    const body = { type: '3d', name: 'HTTP test', project_data: project };
    const res = await request(app.getHttpServer()).post('/diagrams').send(body).expect(201);
    expect(res.body).toEqual(body);
    expect(create).toHaveBeenCalledWith(body, 'owner');
  });
  it('rejects legacy API fields before invoking the service', async () => {
    await request(app.getHttpServer()).post('/diagrams').send({ clientId: 'c1', title: 'old', data: {} }).expect(400);
    expect(create).not.toHaveBeenCalled();
  });
  it('rejects ownership injection before invoking the service', async () => {
    await request(app.getHttpServer()).post('/diagrams').send({ type: '3d', name: 'x', project_data: sampleProject(), user_id: 'foreign' }).expect(400);
    expect(create).not.toHaveBeenCalled();
  });
  it('rejects excessive request bodies at the HTTP boundary', async () => {
    await request(app.getHttpServer()).post('/diagrams').send({ padding: 'x'.repeat(6 * 1024 * 1024) }).expect(413);
    expect(create).not.toHaveBeenCalled();
  });
});
