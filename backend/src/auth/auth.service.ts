import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email already registered');

    const hash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        passwordHash: hash,
      },
      select: { id: true, email: true, name: true, plan: true },
    });

    const token = this.signToken(user.id, user.email);
    return { user, token };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const token = this.signToken(user.id, user.email);
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        buildsUsed: user.buildsUsed,
        buildsLimit: user.buildsLimit,
        avatarUrl: user.avatarUrl,
      },
      token,
    };
  }

  async githubCallback(githubProfile: any) {
    const { id, emails, displayName, photos } = githubProfile;
    const email = emails?.[0]?.value;

    let user = await this.prisma.user.findUnique({
      where: { githubId: String(id) },
    });

    if (!user && email) {
      user = await this.prisma.user.findUnique({ where: { email } });
    }

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: email || `github_${id}@apkfactory.local`,
          name: displayName,
          githubId: String(id),
          avatarUrl: photos?.[0]?.value,
        },
      });
    } else {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          githubId: String(id),
          avatarUrl: photos?.[0]?.value,
          name: user.name || displayName,
        },
      });
    }

    const token = this.signToken(user.id, user.email);
    return { user, token };
  }

  async createApiKey(userId: string, name: string) {
    const rawKey = `apk_${uuidv4().replace(/-/g, '')}`;
    const keyHash = await bcrypt.hash(rawKey, 10);
    const apiKey = await this.prisma.apiKey.create({
      data: { name, keyHash, userId },
      select: { id: true, name: true, createdAt: true },
    });
    return { ...apiKey, key: rawKey }; // Only returned once
  }

  async getProfile(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        plan: true,
        buildsUsed: true,
        buildsLimit: true,
        avatarUrl: true,
        createdAt: true,
        apiKeys: { select: { id: true, name: true, lastUsedAt: true, createdAt: true } },
      },
    });
  }

  private signToken(userId: string, email: string) {
    return this.jwt.sign(
      { sub: userId, email },
      {
        secret: this.config.get('JWT_SECRET'),
        expiresIn: this.config.get('JWT_EXPIRY', '7d'),
      },
    );
  }
}
