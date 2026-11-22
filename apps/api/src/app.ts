import 'reflect-metadata';
import path from 'node:path';
import { Module, type INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { ApiKeysController } from './apikeys.controller';
import { Auth2Controller } from './auth2.controller';
import { AuthController } from './auth.controller';
import { BudgetController } from './budget.controller';
import { MembersController } from './members.controller';
import { BackupMailer, PlatformController } from './backup';
import { DocsController } from './openapi';
import { Db } from './db';
import { AuthGuard, ErrorFilter } from './http';
import { PlansController } from './plans.controller';
import { RateLimitGuard } from './ratelimit';
import { AuditController, TenantController } from './tenant.controller';

@Module({
  controllers: [PlatformController, AuthController, PlansController, TenantController, AuditController, ApiKeysController, DocsController, Auth2Controller, MembersController, BudgetController],
  providers: [Db, BackupMailer, { provide: APP_GUARD, useClass: RateLimitGuard }, { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_FILTER, useClass: ErrorFilter }]
})
class AppModule {}

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: process.env.CF13_QUIET ? ['error'] : undefined, bodyParser: false });
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.CF13_TRUST_PROXY ? Number(process.env.CF13_TRUST_PROXY) : 'loopback');   // behind the HTTPS proxy: trust exactly one hop, so the client IP is real
  app.use(helmet({ contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:', 'blob:'], 'script-src': ["'self'"] } } }));
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });
  const web = process.env.CF13_WEB_DIR;
  if (web) {
    const root = path.resolve(web), indexFile = path.join(root, 'index.html');
    app.useStaticAssets(root, { index: 'index.html', fallthrough: true });
    // the web app routes in the browser: any page address (/budget, /account, ...) gets index.html, so a reload or a
    // shared link opens the page instead of an API 404. /api and real files (with an extension) are left alone.
    app.use((req: { method: string; path: string }, res: { setHeader: (k: string, v: string) => void; sendFile: (f: string) => void }, next: () => void) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path === '/api' || req.path.startsWith('/api/') || path.extname(req.path)) return next();
      res.setHeader('cache-control', 'no-cache');
      res.sendFile(indexFile);
    });
  }
  return app;
}
