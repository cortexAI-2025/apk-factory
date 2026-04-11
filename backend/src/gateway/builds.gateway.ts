import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: 'builds',
})
export class BuildsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(BuildsGateway.name);
  private readonly buildRooms = new Map<string, Set<string>>();

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth?.token ||
        client.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwt.verify(token, {
        secret: this.config.get('JWT_SECRET'),
      });
      client.data.userId = payload.sub;
      this.logger.log(`Client connected: ${client.id} (user: ${payload.sub})`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    // Remove from all rooms
    for (const [buildId, sockets] of this.buildRooms) {
      sockets.delete(client.id);
      if (sockets.size === 0) this.buildRooms.delete(buildId);
    }
  }

  @SubscribeMessage('subscribe:build')
  handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { buildId: string },
  ) {
    const room = `build:${data.buildId}`;
    client.join(room);

    if (!this.buildRooms.has(data.buildId)) {
      this.buildRooms.set(data.buildId, new Set());
    }
    this.buildRooms.get(data.buildId).add(client.id);

    this.logger.log(`Client ${client.id} subscribed to build ${data.buildId}`);
    return { subscribed: true, buildId: data.buildId };
  }

  @SubscribeMessage('unsubscribe:build')
  handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { buildId: string },
  ) {
    client.leave(`build:${data.buildId}`);
    this.buildRooms.get(data.buildId)?.delete(client.id);
    return { unsubscribed: true };
  }

  // Called by the worker to push real-time updates
  emitBuildLog(buildId: string, log: { level: string; message: string; timestamp: string }) {
    this.server.to(`build:${buildId}`).emit('build:log', { buildId, ...log });
  }

  emitBuildStatus(buildId: string, status: string, metadata?: Record<string, any>) {
    this.server.to(`build:${buildId}`).emit('build:status', { buildId, status, ...metadata });
  }

  emitBuildComplete(buildId: string, result: {
    status: string;
    apkUrl?: string;
    qrCodeUrl?: string;
    duration?: number;
    errorMessage?: string;
  }) {
    this.server.to(`build:${buildId}`).emit('build:complete', { buildId, ...result });
  }

  emitFixApplied(buildId: string, fix: {
    attempt: number;
    description: string;
    filesModified: string[];
  }) {
    this.server.to(`build:${buildId}`).emit('build:fix', { buildId, ...fix });
  }
}
