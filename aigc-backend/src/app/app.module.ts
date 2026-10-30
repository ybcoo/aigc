import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import { AIConfigModule } from '../ai-config/ai-config.module';
import { CanvasModule } from '../canvas/canvas.module';
import { GenerationModule } from '../generation/generation.module';
import { EditorModule } from '../editor/editor.module';
import { StorageModule } from '../storage/storage.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    StorageModule,
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
    AIConfigModule,
    CanvasModule,
    GenerationModule,
    EditorModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
