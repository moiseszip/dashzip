import { IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** Resposta do navegador (JSON do WebAuthn); a biblioteca confere o formato. */
type CeremonyResponse = Record<string, any>;

export class RegistrationVerifyDto {
  @IsUUID()
  challengeId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsObject()
  response!: CeremonyResponse;
}

export class AuthenticationVerifyDto {
  @IsUUID()
  challengeId!: string;

  @IsObject()
  response!: CeremonyResponse;
}

/** Confirmação com passkey, exigida só para remover o último segundo fator. */
export class RemovePasskeyDto {
  @IsOptional()
  @IsUUID()
  challengeId?: string;

  @IsOptional()
  @IsObject()
  response?: CeremonyResponse;
}
