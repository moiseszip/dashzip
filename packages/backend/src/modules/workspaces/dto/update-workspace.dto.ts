import { IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

/** Renomear, trocar o fuso e/ou o emoji do painel. Pelo menos um. */
export class UpdateWorkspaceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  /** Fuso IANA (ex.: America/Sao_Paulo). Validado no serviço contra o Intl. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  /** Emoji antes do nome; string vazia ou null tira o emoji. Validado no serviço. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(16)
  emoji?: string | null;
}
