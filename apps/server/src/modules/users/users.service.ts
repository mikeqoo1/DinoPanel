import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import { DRIZZLE_DB, type Db } from '../../database/db.module';
import { users, type User } from '../../database/schema';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class UsersService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Db) {}

  async findById(id: number): Promise<User | undefined> {
    return this.db.query.users.findFirst({ where: eq(users.id, id) });
  }

  async findByUsername(username: string): Promise<User | undefined> {
    return this.db.query.users.findFirst({ where: eq(users.username, username) });
  }

  async create(username: string, plainPassword: string): Promise<User> {
    const existing = await this.findByUsername(username);
    if (existing) throw new ConflictException('Username already exists');

    const passwordHash = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
    const [user] = await this.db
      .insert(users)
      .values({ username, passwordHash })
      .returning();
    if (!user) throw new Error('Failed to create user');
    return user;
  }

  async verifyPassword(user: User, plainPassword: string): Promise<boolean> {
    return bcrypt.compare(plainPassword, user.passwordHash);
  }

  async changePassword(userId: number, oldPassword: string, newPassword: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const ok = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!ok) throw new ConflictException('Old password mismatch');

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.db
      .update(users)
      .set({ passwordHash: newHash, updatedAt: Date.now() })
      .where(eq(users.id, userId));
  }

  async hasAnyUser(): Promise<boolean> {
    const row = await this.db.query.users.findFirst();
    return !!row;
  }
}
