import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Public } from '../common/http/public.decorator';
import { AuthService } from './auth.service';
import { TokenRequestDto, TokenResponseDto } from './dto/token-request.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('token')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TokenResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unknown API key' })
  issueToken(@Body() body: TokenRequestDto): Promise<TokenResponseDto> {
    return this.auth.issueToken(body.apiKey, body.scopes);
  }
}
