import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UsePipes,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ComposeService } from './compose.service';

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

const updateFileBodySchema = z.object({
  content: z.string(),
});
type UpdateFileBody = z.infer<typeof updateFileBodySchema>;

const createStackBodySchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9_-]+$/, {
    message: 'Stack name must only contain lowercase letters, numbers, hyphens, or underscores',
  }),
  path: z.string().optional(),
  content: z.string().optional(),
});
type CreateStackBody = z.infer<typeof createStackBodySchema>;

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller('compose')
export class ComposeController {
  constructor(private readonly compose: ComposeService) {}

  /** GET /api/compose — list all stacks */
  @Get()
  async list() {
    return this.compose.listStacks();
  }

  /** POST /api/compose — register new stack */
  @Post()
  @UsePipes(new ZodValidationPipe(createStackBodySchema))
  async create(@Body() body: CreateStackBody) {
    const path = body.path ?? ComposeService.defaultStackPath(body.name);
    return this.compose.createStack({ name: body.name, path, content: body.content });
  }

  /** GET /api/compose/:key — get single stack (key = numeric id or name) */
  @Get(':key')
  async get(@Param('key') key: string) {
    return this.compose.getStack(key);
  }

  /** DELETE /api/compose/:id — unregister stack (must be numeric SQLite id) */
  @Delete(':id')
  @HttpCode(204)
  async unregister(@Param('id') id: string) {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) {
      throw new Error('Stack id must be numeric for unregister');
    }
    await this.compose.unregisterStack(numId);
  }

  /** GET /api/compose/:key/file — read compose file content */
  @Get(':key/file')
  async getFile(@Param('key') key: string) {
    return this.compose.readComposeFile(key);
  }

  /** PUT /api/compose/:key/file — update compose file */
  @Put(':key/file')
  @HttpCode(204)
  async updateFile(@Param('key') key: string, @Body() body: UpdateFileBody) {
    // Manual validation so we can use the pipe only on a body parameter
    const parsed = updateFileBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new Error('content field is required');
    }
    await this.compose.writeComposeFile(key, parsed.data.content);
  }

  /** POST /api/compose/:key/validate — semantic validation via docker compose config */
  @Post(':key/validate')
  async validate(@Param('key') key: string) {
    return this.compose.validate(key);
  }
}
