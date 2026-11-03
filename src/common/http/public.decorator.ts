import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'pulso:isPublic';

/** Opts a route out of the global bearer-token guard. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);
