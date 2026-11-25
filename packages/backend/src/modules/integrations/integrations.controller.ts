import { Controller, Get, Post, Patch, Delete, Body, Param, Query, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IntegrationsService } from './integrations.service';
import { SaveCheckoutDto } from './dto/save-checkout.dto';
import { ToggleCheckoutDto } from './dto/toggle-checkout.dto';

@Controller('integrations')
@UseGuards(AuthGuard)
export class IntegrationsController {
  constructor(private integrations: IntegrationsService) {}

  @Get('checkout')
  listCheckout(@CurrentUser('id') userId: string, @Query('workspace_id') workspaceId?: string) {
    return this.integrations.listCheckoutIntegrations(userId, workspaceId);
  }

  @Post('checkout')
  saveCheckout(@CurrentUser('id') userId: string, @Body() body: SaveCheckoutDto) {
    return this.integrations.saveCheckoutIntegration(userId, body);
  }

  @Patch('checkout/:id/toggle')
  toggleCheckout(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ToggleCheckoutDto,
  ) {
    return this.integrations.toggleCheckoutIntegration(userId, id, body.is_active);
  }

  @Delete('checkout/:id')
  deleteCheckout(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.integrations.deleteCheckoutIntegration(userId, id);
  }
}
