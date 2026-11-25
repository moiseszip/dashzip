import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { RulesCronController } from '../rules.controller';
import { RulesService } from '../rules.service';

describe('RulesCronController', () => {
  const tick = jest.fn();
  const rpc = jest.fn();
  const controller = new RulesCronController(
    { tick } as unknown as RulesService,
    { getClient: () => ({ rpc }) } as unknown as SupabaseService,
  );

  beforeEach(() => jest.resetAllMocks());

  it('rejeita chamada sem bearer e não consulta o banco', async () => {
    await expect(controller.tick(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(rpc).not.toHaveBeenCalled();
    expect(tick).not.toHaveBeenCalled();
  });

  it('só executa após validação do resumo no Vault', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    tick.mockResolvedValue({ executed: 0 });
    await expect(controller.tick('Bearer token-de-teste')).resolves.toEqual({ executed: 0 });
    expect(rpc).toHaveBeenCalledWith('verify_dash_rules_cron', {
      p_digest: createHash('sha256').update('token-de-teste').digest('hex'),
    });
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('mantém o agendamento fechado quando o Vault rejeita o token ou está indisponível', async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null }).mockResolvedValueOnce({ data: null, error: {} });
    await expect(controller.tick('Bearer incorreto')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.tick('Bearer token-de-teste')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(tick).not.toHaveBeenCalled();
  });
});
