import type { Server as HttpServer } from 'node:http';
import { and, eq } from 'drizzle-orm';
import { Server } from 'socket.io';
import { z } from 'zod';
import type { Container } from '../container';
import { attempts } from '../db/schema';
import { logger } from '../lib/logger';
import { canAccessExam } from '../modules/exams/exam-access';
import { SESSION_COOKIE } from '../modules/auth/session.service';
import type { AuthContext } from '../types/auth';
import { rooms } from './realtime';

const joinSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('exam-staff'), examId: z.string().uuid() }),
  z.object({ kind: z.literal('attempt'), attemptId: z.string().uuid() }),
]);

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/** Socket.IO with session authentication on the handshake and server-side authorization of every room join. */
export function attachSocketServer(http: HttpServer, c: Container, allowedOrigins: string[]) {
  const io = new Server(http, {
    path: '/socket.io',
    cors: { origin: allowedOrigins, credentials: true },
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });

  io.use(async (socket, next) => {
    try {
      const token = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE);
      const auth = token ? await c.sessions.resolve(token) : null;
      if (!auth) return next(new Error('UNAUTHENTICATED'));
      socket.data.auth = auth;
      next();
    } catch (err) {
      next(err as Error);
    }
  });

  io.on('connection', (socket) => {
    const auth = socket.data.auth as AuthContext;
    void socket.join(rooms.user(auth.user.id));

    socket.on('join', async (raw: unknown, ack?: (res: { ok: boolean; error?: string }) => void) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const parsed = joinSchema.safeParse(raw);
      if (!parsed.success) return reply({ ok: false, error: 'BAD_REQUEST' });
      try {
        if (parsed.data.kind === 'exam-staff') {
          const allowed = auth.permissions.has('monitor.view') && (await canAccessExam(c.db, auth, parsed.data.examId));
          if (!allowed) return reply({ ok: false, error: 'FORBIDDEN' });
          await socket.join(rooms.examStaff(parsed.data.examId));
          return reply({ ok: true });
        }
        const [attempt] = await c.db
          .select({ id: attempts.id, examId: attempts.examId })
          .from(attempts)
          .where(and(eq(attempts.id, parsed.data.attemptId), eq(attempts.userId, auth.user.id)))
          .limit(1);
        if (!attempt) return reply({ ok: false, error: 'FORBIDDEN' });
        await socket.join(rooms.attempt(attempt.id));
        await socket.join(rooms.examCandidates(attempt.examId));
        return reply({ ok: true });
      } catch (err) {
        logger.error({ err }, 'socket join failed');
        return reply({ ok: false, error: 'INTERNAL' });
      }
    });
  });

  c.realtime.attach(io);
  return io;
}
