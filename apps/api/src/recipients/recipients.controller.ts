import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  BankListResponse,
  CreateRecipientRequest,
  NameEnquiryRequest,
  NameEnquiryResponse,
  RecipientResponse,
  createRecipientRequestSchema,
  nameEnquiryRequestSchema,
} from '@morapay/contracts';
import { RecipientsService } from './recipients.service';
import { AuthenticatedUser, CurrentUser, JwtAuthGuard, VerifiedUserGuard } from '../auth/guards';
import { zodBody } from '../common/zod.pipe';

@Controller('recipients')
@UseGuards(JwtAuthGuard, VerifiedUserGuard)
export class RecipientsController {
  constructor(private readonly recipients: RecipientsService) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<{ recipients: RecipientResponse[] }> {
    return { recipients: await this.recipients.list(user.id) };
  }

  /**
   * Name enquiry, before the sender commits (BUILD_PLAN 7.2).
   *
   * Deliberately a separate call from creating the recipient, so the UI can
   * show "ADEBAYO O." and wait for a human to agree before anything is saved.
   */
  @Post('name-enquiry')
  @HttpCode(200)
  async nameEnquiry(
    @Body(zodBody(nameEnquiryRequestSchema)) body: NameEnquiryRequest,
  ): Promise<NameEnquiryResponse> {
    return this.recipients.nameEnquiry(body.details);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createRecipientRequestSchema)) body: CreateRecipientRequest,
  ): Promise<RecipientResponse> {
    return this.recipients.create(user.id, body.details, body.nickname);
  }

  @Delete(':id')
  @HttpCode(204)
  async archive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    await this.recipients.archive(user.id, id);
  }
}

/** Institution lists. Public: a sender needs them before they have an account. */
@Controller('institutions')
export class InstitutionsController {
  constructor(private readonly recipients: RecipientsService) {}

  /**
   * `?country=GH` returns the institutions of one destination.
   *
   * The parameter is required in practice — an omitted country returns an empty
   * list rather than everything, because "everything" is what the old shape
   * returned and it offered Nigerian banks to somebody paying a Beninese
   * wallet. An empty list is a visible bug; a wrong list is not.
   */
  @Get()
  list(@Query('country') country?: string): BankListResponse {
    return this.recipients.institutions(country ?? '');
  }
}
