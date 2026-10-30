import { Module } from '@nestjs/common';
import { AIConfigController } from './ai-config.controller';
import { AIConfigService } from './ai-config.service';

@Module({
  controllers: [AIConfigController],
  providers: [AIConfigService],
  exports: [AIConfigService],
})
export class AIConfigModule {}
