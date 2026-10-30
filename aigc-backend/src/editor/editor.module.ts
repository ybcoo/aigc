import { Module } from '@nestjs/common';
import { EditorController } from './editor.controller';
import { EditorService } from './editor.service';

@Module({ controllers: [EditorController], providers: [EditorService], exports: [EditorService] })
export class EditorModule {}
