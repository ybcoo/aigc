import { Module } from '@nestjs/common';
import { CanvasModule } from '../canvas/canvas.module';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';
import { GenerationProvider } from './generation.provider';
import { EditorModule } from '../editor/editor.module';
import { ScriptModule } from '../script/script.module';

@Module({ imports: [CanvasModule, EditorModule, ScriptModule], controllers: [GenerationController], providers: [GenerationService, GenerationProvider] })
export class GenerationModule {}
