import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { APP_CONFIG } from '../config/tokens';
import { loadConfig } from '../config/config';
import { PartitionGateway } from './partition-gateway.service';
import { SenderProfileRuRepository } from './ru/sender-profile.repository';
import { RecipientProfileNgRepository } from './ng/recipient-profile.repository';
import { SenderProfileNgRepository } from './ng/sender-profile.repository';
import { RecipientProfileGhRepository } from './gh/recipient-profile.repository';
import { SenderProfileGhRepository } from './gh/sender-profile.repository';
import { RecipientProfileZaRepository } from './za/recipient-profile.repository';
import { RecipientProfileCmRepository } from './cm/recipient-profile.repository';
import { SenderProfileCmRepository } from './cm/sender-profile.repository';
import { RecipientProfileBjRepository } from './bj/recipient-profile.repository';
import { SenderProfileBjRepository } from './bj/sender-profile.repository';

/**
 * The partition boundary, as a module.
 *
 * The repositories are provided here and **not exported**: only
 * `PartitionGateway` leaves this module. That is what keeps guardrail G8
 * mechanical rather than aspirational — the CI check
 * (infra/scripts/check-partition-boundaries.sh) fails any build where code
 * outside `src/partitions/` imports a repository directly, and with this module
 * in place there is no reason for anyone to.
 *
 * Six residencies, ten stores, and one deliberate gap: South Africa has a
 * recipient store and no sender store.
 */
@Module({
  providers: [
    PrismaService,
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    SenderProfileRuRepository,
    RecipientProfileNgRepository,
    SenderProfileNgRepository,
    RecipientProfileGhRepository,
    SenderProfileGhRepository,
    RecipientProfileZaRepository,
    RecipientProfileCmRepository,
    SenderProfileCmRepository,
    RecipientProfileBjRepository,
    SenderProfileBjRepository,
    PartitionGateway,
  ],
  exports: [PartitionGateway],
})
export class PartitionsModule {}
