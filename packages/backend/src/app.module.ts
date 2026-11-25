import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { RealIpThrottlerGuard } from './common/guards/real-ip-throttler.guard';
import { SharedModule } from './shared/shared.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { MetaCapiModule } from './modules/meta-capi/meta-capi.module';
import { DebugModule } from './modules/debug/debug.module';
import { FinanceModule } from './modules/finance/finance.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { SummaryModule } from './modules/summary/summary.module';
import { RulesModule } from './modules/rules/rules.module';
import { TestsModule } from './modules/tests/tests.module';
import { VslModule } from './modules/vsl/vsl.module';
import { HotjarModule } from './modules/hotjar/hotjar.module';
import { WiapyModule } from './modules/wiapy/wiapy.module';
import { PasskeysModule } from './modules/passkeys/passkeys.module';
import { SalesPushModule } from './modules/sales-push/sales-push.module';

const RATE_LIMIT_TTL_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;

/**
 * Um GTM simplificado: o snippet (client web), os webhooks dos checkouts
 * (clients do servidor), a API de Conversões do Meta (as tags) e o modo
 * preview, que mostra tudo isso acontecendo.
 */
@Module({
  imports: [
    // Local: o .env do backend, ou o .env.local da raiz (o mesmo que o
    // frontend lê). Na Vercel nenhum existe e valem as variáveis do projeto.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env.local'] }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: RATE_LIMIT_TTL_MS, limit: RATE_LIMIT_MAX_REQUESTS }]),
    SharedModule,
    WebhooksModule,
    WorkspacesModule,
    IntegrationsModule,
    HealthModule,
    UsersModule,
    TrackingModule,
    MetaCapiModule,
    DebugModule,
    FinanceModule,
    CampaignsModule,
    SummaryModule,
    RulesModule,
    TestsModule,
    VslModule,
    HotjarModule,
    WiapyModule,
    PasskeysModule,
    SalesPushModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: RealIpThrottlerGuard,
    },
  ],
})
export class AppModule {}
