import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UsePipes } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ImagesService } from './images.service';

const tagBodySchema = z.object({
  repo: z.string().min(1),
  tag: z.string().optional(),
});
type TagBody = z.infer<typeof tagBodySchema>;

@Controller('images')
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  @Get()
  async list() {
    return this.images.list();
  }

  @Get(':id')
  async inspect(@Param('id') id: string) {
    return this.images.inspect(id);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @Query('force') force?: string,
    @Query('noprune') noprune?: string,
  ) {
    await this.images.remove(id, {
      force: force === 'true' || force === '1',
      noprune: noprune === 'true' || noprune === '1',
    });
  }

  @Post(':id/tag')
  @HttpCode(204)
  @UsePipes(new ZodValidationPipe(tagBodySchema))
  async tag(@Param('id') id: string, @Body() body: TagBody) {
    await this.images.tag(id, body.repo, body.tag);
  }
}
