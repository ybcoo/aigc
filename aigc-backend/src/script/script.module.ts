import { Module } from '@nestjs/common';
import { GenerationProvider } from '../generation/generation.provider';
import { ScriptController } from './script.controller';
import { ScriptService } from './script.service';

@Module({ controllers: [ScriptController], providers: [ScriptService, GenerationProvider], exports: [ScriptService] })
export class ScriptModule {}
