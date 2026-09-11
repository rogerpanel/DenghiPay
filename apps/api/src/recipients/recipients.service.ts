import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CountryCode,
  asCorridorId,
  maskRecipientAccount,
  networkServesCountry,
  RecipientDetails,
} from '@morapay/domain';
import {
  PAYOUT_MARKETS,
  PayoutMarket,
  ProviderRegistry,
  institutionsForDestination,
} from '@morapay/adapters';
import { NameEnquiryResponse, RecipientDetailsDto, RecipientResponse } from '@morapay/contracts';
import { PrismaService } from '../common/prisma.service';
import { PartitionGateway } from '../partitions/partition-gateway.service';
import { AuditService } from '../audit/audit.service';

/**
 * Recipients and name enquiry (BUILD_PLAN 7.2).
 *
 * The name enquiry is the most valuable feature in this whole flow. Showing
 * "ADEBAYO O." back to the sender before they commit prevents the single most
 * common support case in this corridor — money sent to a mistyped account
 * number, which is unrecoverable once settled.
 *
 * The neutral tier stores a token, a mask and the resolved name. The account
 * number itself lives in the destination partition.
 */
@Injectable()
export class RecipientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partitions: PartitionGateway,
    private readonly registry: ProviderRegistry,
    private readonly audit: AuditService,
  ) {}

  /**
   * Resolve the name the institution holds.
   *
   * Called before the sender commits, and again — from the stored resolved
   * name — at confirmation, so a recipient edited between the two is caught.
   */
  async nameEnquiry(details: RecipientDetailsDto): Promise<NameEnquiryResponse> {
    // A name enquiry happens before a corridor is chosen — the sender is still
    // deciding who to pay — so the provider is found by where the money is
    // going. This used to fabricate a corridor id from the country ('RU-NG' for
    // Nigeria, 'RU-GH' for everyone else), which was right only while those
    // were the only two destinations and would have sent a Cameroonian wallet
    // to the Ghanaian rail.
    const provider = this.registry.selectPayoutForDestination(details.country);
    if (provider === null) {
      return { status: 'UNSUPPORTED', reason: 'No payout provider is available for that country' };
    }

    // The same brand is a different licensee in each country. Catching a
    // mismatch here keeps the error about the wallet rather than about a rail
    // the sender has never heard of.
    if (
      details.method === 'MOBILE_MONEY' &&
      !networkServesCountry(details.country as CountryCode, details.network)
    ) {
      return {
        status: 'UNSUPPORTED',
        reason: `${details.network} does not operate in ${details.country}`,
      };
    }

    // The corridor id is only a label on the outbound call here; the provider
    // has already been chosen, and `resolveRecipient` routes on its own market.
    const corridorId = asCorridorId(`ENQUIRY-${details.country}`);
    const resolution = await provider.resolveRecipient({
      corridorId,
      recipient: details as RecipientDetails,
    });

    if (resolution._tag === 'NOT_FOUND') {
      return { status: 'NOT_FOUND', reason: resolution.reason };
    }
    if (resolution._tag === 'UNSUPPORTED') {
      return { status: 'UNSUPPORTED', reason: resolution.reason };
    }

    return {
      status: 'RESOLVED',
      resolvedName: resolution.resolvedName,
      institution: resolution.institution,
      matchesDeclaredName: namesLookAlike(details.declaredName, resolution.resolvedName),
    };
  }

  async create(
    userId: string,
    details: RecipientDetailsDto,
    nickname?: string,
  ): Promise<RecipientResponse> {
    const enquiry = await this.nameEnquiry(details);
    if (enquiry.status !== 'RESOLVED') {
      // BUILD_PLAN 7.2 DoD: a failed enquiry blocks and prompts the sender.
      throw new BadRequestException({
        code: `NAME_ENQUIRY_${enquiry.status}`,
        message: enquiry.reason,
      });
    }

    const piiToken = this.partitions.token('rcp', `${userId}:${identifierOf(details)}`);
    const partition = details.country;

    await this.partitions.storeRecipient({ piiToken, country: details.country, details });

    const existing = await this.prisma.recipient.findUnique({ where: { piiToken } });
    const row =
      existing === null
        ? await this.prisma.recipient.create({
            data: {
              userId,
              method: details.method,
              country: details.country,
              piiToken,
              piiPartition: partition,
              maskedAccount: maskRecipientAccount(details as RecipientDetails),
              resolvedName: enquiry.resolvedName,
              nickname: nickname ?? null,
            },
          })
        : await this.prisma.recipient.update({
            where: { id: existing.id },
            data: {
              resolvedName: enquiry.resolvedName,
              archivedAt: null,
              nickname: nickname ?? existing.nickname,
            },
          });

    await this.audit.record({
      actorType: 'USER',
      actorId: userId,
      action: 'RECIPIENT_SAVED',
      subjectType: 'RECIPIENT',
      subjectId: row.id,
      // The masked account and the country are enough to identify the row in an
      // investigation; the number itself is not recorded here.
      after: { method: row.method, country: row.country, maskedAccount: row.maskedAccount },
    });

    return toResponse(row);
  }

  async list(userId: string): Promise<RecipientResponse[]> {
    const rows = await this.prisma.recipient.findMany({
      where: { userId, archivedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toResponse);
  }

  async get(userId: string, recipientId: string) {
    const row = await this.prisma.recipient.findUnique({ where: { id: recipientId } });
    if (row === null || row.userId !== userId || row.archivedAt !== null) {
      throw new NotFoundException({ code: 'RECIPIENT_NOT_FOUND', message: 'No such recipient' });
    }
    return row;
  }

  async archive(userId: string, recipientId: string): Promise<void> {
    const row = await this.get(userId, recipientId);
    await this.prisma.recipient.update({
      where: { id: row.id },
      data: { archivedAt: new Date() },
    });
    await this.audit.record({
      actorType: 'USER',
      actorId: userId,
      action: 'RECIPIENT_ARCHIVED',
      subjectType: 'RECIPIENT',
      subjectId: row.id,
    });
  }

  /** Full details, for an outbound payout call only. */
  async detailsForPayout(recipientId: string): Promise<RecipientDetails> {
    const row = await this.prisma.recipient.findUniqueOrThrow({ where: { id: recipientId } });
    const details = await this.partitions.recipientDetails(row.piiToken, row.piiPartition);
    if (details === null) {
      throw new NotFoundException({
        code: 'RECIPIENT_DETAILS_MISSING',
        message: 'Recipient details are not available in their residency partition',
      });
    }
    return details as RecipientDetails;
  }

  /**
   * What a given destination can be paid into.
   *
   * Served per country. It used to return every Nigerian bank alongside every
   * Ghanaian network regardless of where the recipient lived, which was
   * harmless with two destinations and offers a Ghanaian operator to somebody
   * adding a Beninese wallet with five. At fifteen it would be unusable.
   *
   * The known set is `PAYOUT_MARKETS` from the adapters rather than a list
   * kept here: a destination with no rail has no institutions to offer, and
   * that is exactly the question the registry already answers.
   */
  institutions(country: string): {
    banks: Array<{ code: string; name: string }>;
    networks: Array<{ code: string; name: string }>;
  } {
    if (!PAYOUT_MARKETS.includes(country as PayoutMarket)) {
      return { banks: [], networks: [] };
    }
    return institutionsForDestination(country as PayoutMarket);
  }
}

function identifierOf(details: RecipientDetailsDto): string {
  return details.method === 'BANK_ACCOUNT' ? details.accountNumber : details.msisdn;
}

function toResponse(row: {
  id: string;
  method: string;
  country: string;
  maskedAccount: string;
  resolvedName: string | null;
  nickname: string | null;
  createdAt: Date;
}): RecipientResponse {
  return {
    id: row.id,
    method: row.method as 'BANK_ACCOUNT' | 'MOBILE_MONEY',
    country: row.country as CountryCode,
    maskedAccount: row.maskedAccount,
    resolvedName: row.resolvedName,
    nickname: row.nickname,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Compare what the sender typed with what the institution returned.
 *
 * Deliberately lenient about ordering and middle names — "ADEBAYO OKONKWO" and
 * "OKONKWO ADEBAYO CHUKWU" are the same person, and a strict comparison would
 * teach senders to click through the warning. Two shared name tokens is the
 * bar.
 */
export function namesLookAlike(declared: string, resolved: string): boolean {
  const tokenise = (value: string): string[] =>
    value
      .toUpperCase()
      .replace(/[^A-Z ]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 1);

  const declaredTokens = new Set(tokenise(declared));
  const resolvedTokens = tokenise(resolved);
  if (declaredTokens.size === 0 || resolvedTokens.length === 0) return false;

  const shared = resolvedTokens.filter((token) => declaredTokens.has(token)).length;
  return shared >= Math.min(2, Math.min(declaredTokens.size, resolvedTokens.length));
}
