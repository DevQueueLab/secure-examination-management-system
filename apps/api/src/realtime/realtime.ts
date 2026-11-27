import type { Server } from 'socket.io';

/** Room naming is centralised so emitters and the join authorizer cannot drift apart. */
export const rooms = {
  examStaff: (examId: string) => `exam:${examId}:staff`,
  examCandidates: (examId: string) => `exam:${examId}:candidates`,
  attempt: (attemptId: string) => `attempt:${attemptId}`,
  user: (userId: string) => `user:${userId}`,
};

/**
 * Push channel for live monitoring, announcements and attempt control. Payloads must never contain
 * answer keys or unpublished scores; candidates also re-sync over HTTP, so pushes are a speed-up, not a dependency.
 */
export class Realtime {
  private io: Server | null = null;

  attach(io: Server) {
    this.io = io;
  }

  toExamStaff(examId: string, event: string, payload: unknown) {
    this.io?.to(rooms.examStaff(examId)).emit(event, payload);
  }
  toExamCandidates(examId: string, event: string, payload: unknown) {
    this.io?.to(rooms.examCandidates(examId)).emit(event, payload);
  }
  toAttempt(attemptId: string, event: string, payload: unknown) {
    this.io?.to(rooms.attempt(attemptId)).emit(event, payload);
  }
  toUser(userId: string, event: string, payload: unknown) {
    this.io?.to(rooms.user(userId)).emit(event, payload);
  }
}
