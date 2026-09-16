import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { configureHttpBodyParsers } from '../diagrams/diagrams.http';

describe('Auth HTTP contract', () => {
  let app: INestApplication;
  const login = jest.fn(async (body) => ({
    deviceFingerprint: body.deviceFingerprint,
  }));

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            register: jest.fn(),
            login,
            refresh: jest.fn(),
            forgotPassword: jest.fn(),
            session: jest.fn(),
            logout: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication({ bodyParser: false });
    configureHttpBodyParsers(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => login.mockClear());

  it('parses the JSON login body on non-diagram routes', async () => {
    const body = {
      email: 'test@example.invalid',
      password: 'test-password',
      deviceFingerprint: 'hardware-id',
      deviceName: 'Windows PC',
      platform: 'windows',
      clientVersion: '0.1.0',
    };
    await request(app.getHttpServer())
      .post('/auth/login')
      .send(body)
      .expect(201)
      .expect({ deviceFingerprint: 'hardware-id' });
    expect(login).toHaveBeenCalledWith(body);
  });
});
