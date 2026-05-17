import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UsePipes,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  chmodSchema,
  chownSchema,
  compressSchema,
  extractSchema,
  listQuerySchema,
  mkdirSchema,
  pathOnlySchema,
  renameSchema,
  writeSchema,
  type ChmodInput,
  type ChownInput,
  type CompressInput,
  type ExtractInput,
  type ListQuery,
  type MkdirInput,
  type PathOnlyInput,
  type RenameInput,
  type WriteInput,
} from '@dinopanel/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { FilesService } from './files.service';

@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Get('list')
  async list(@Query('path') path: string, @Query('showHidden') showHidden?: string) {
    const parsed: ListQuery = listQuerySchema.parse({
      path,
      showHidden: showHidden === 'true' || showHidden === '1',
    });
    return this.files.list(parsed.path, parsed.showHidden);
  }

  @Get('read')
  async read(@Query('path') path: string) {
    pathOnlySchema.parse({ path });
    return this.files.readText(path);
  }

  @Post('write')
  @UsePipes(new ZodValidationPipe(writeSchema))
  @HttpCode(204)
  async write(@Body() body: WriteInput) {
    await this.files.write(body.path, body.content);
  }

  @Post('mkdir')
  @UsePipes(new ZodValidationPipe(mkdirSchema))
  @HttpCode(204)
  async mkdir(@Body() body: MkdirInput) {
    await this.files.mkdir(body.path, body.recursive);
  }

  @Post('rename')
  @UsePipes(new ZodValidationPipe(renameSchema))
  @HttpCode(204)
  async rename(@Body() body: RenameInput) {
    await this.files.rename(body.from, body.to);
  }

  @Post('copy')
  @UsePipes(new ZodValidationPipe(renameSchema))
  @HttpCode(204)
  async copy(@Body() body: RenameInput) {
    await this.files.copy(body.from, body.to);
  }

  @Delete()
  @UsePipes(new ZodValidationPipe(pathOnlySchema))
  @HttpCode(204)
  async remove(@Body() body: PathOnlyInput) {
    await this.files.remove(body.path);
  }

  @Post('chmod')
  @UsePipes(new ZodValidationPipe(chmodSchema))
  @HttpCode(204)
  async chmod(@Body() body: ChmodInput) {
    await this.files.chmod(body.path, body.mode);
  }

  @Post('chown')
  @UsePipes(new ZodValidationPipe(chownSchema))
  @HttpCode(204)
  async chown(@Body() body: ChownInput) {
    await this.files.chown(body.path, body.uid, body.gid);
  }

  @Post('upload')
  async upload(
    @Req() req: FastifyRequest,
    @Query('path') targetDir: string,
    @Headers('x-filename') filename: string | undefined,
  ) {
    if (!targetDir) {
      throw new BadRequestException('path query required');
    }
    if (!filename) {
      throw new BadRequestException('X-Filename header required');
    }
    const saved = await this.files.saveUpload(targetDir, filename, req.raw);
    return { path: saved };
  }

  @Get('download')
  async download(@Query('path') path: string, @Res({ passthrough: false }) res: FastifyReply) {
    pathOnlySchema.parse({ path });
    const { stream, filename } = this.files.createDownloadStream(path);
    res.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.header('Content-Type', 'application/octet-stream');
    return res.send(stream);
  }

  @Post('archive-download')
  @UsePipes(new ZodValidationPipe(compressSchema.omit({ dest: true })))
  async archiveDownload(
    @Body() body: Omit<CompressInput, 'dest'>,
    @Res({ passthrough: false }) res: FastifyReply,
  ) {
    const { stream, filename } = await this.files.createArchiveStream(body.paths, body.format);
    res.header('Content-Disposition', `attachment; filename="${filename}"`);
    res.header('Content-Type', body.format === 'zip' ? 'application/zip' : 'application/gzip');
    return res.send(stream);
  }

  @Post('compress')
  @UsePipes(new ZodValidationPipe(compressSchema))
  @HttpCode(204)
  async compress(@Body() body: CompressInput) {
    await this.files.compressToDisk(body.paths, body.dest, body.format);
  }

  @Post('extract')
  @UsePipes(new ZodValidationPipe(extractSchema))
  @HttpCode(204)
  async extract(@Body() body: ExtractInput) {
    await this.files.extract(body.archive, body.dest);
  }
}
