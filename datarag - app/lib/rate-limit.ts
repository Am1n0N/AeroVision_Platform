// lib/rate-limit.ts - Improved rate limiting
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

// Different rate limits for different endpoints
const RATE_LIMITS = {
  chat_sessions: { requests: 10, window: 60 }, // 10 requests per minute for sessions
  send_message: { requests: 20, window: 60 }, // 20 messages per minute
  update_session: { requests: 30, window: 60 }, // 30 updates per minute
  delete_session: { requests: 5, window: 60 }, // 5 deletes per minute
  default: { requests: 100, window: 60 }, // Default fallback
};

export async function rateLimit(
  identifier: string,
  type: keyof typeof RATE_LIMITS = 'default'
): Promise<{ success: boolean; limit: number; remaining: number; reset: Date }> {
  const { requests, window } = RATE_LIMITS[type];
  const key = `rate_limit:${type}:${identifier}`;

  try {
    // Use Redis pipeline for atomic operations
    const pipeline = redis.pipeline();
    const now = Date.now();
    const windowStart = now - (window * 1000);

    // Remove old entries and count current requests
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zcard(key);
    pipeline.zadd(key, { score: now, member: `${now}-${Math.random()}` });
    pipeline.expire(key, window);

    const results = await pipeline.exec();

    const currentRequests = (results[1] as number) || 0;
    const remaining = Math.max(0, requests - currentRequests - 1);
    const reset = new Date(now + (window * 1000));

    const success = currentRequests < requests;

    return {
      success,
      limit: requests,
      remaining,
      reset,
    };
  } catch (error) {
    console.error('Rate limiting error:', error);
    // On error, allow the request but log it
    return {
      success: true,
      limit: requests,
      remaining: requests - 1,
      reset: new Date(Date.now() + (window * 1000)),
    };
  }
}

// Specialized rate limiters for different actions
export const chatRateLimiters = {
  sessions: (userId: string) => rateLimit(userId, 'chat_sessions'),
  sendMessage: (userId: string) => rateLimit(userId, 'send_message'),
  updateSession: (userId: string) => rateLimit(userId, 'update_session'),
  deleteSession: (userId: string) => rateLimit(userId, 'delete_session'),
};

// Enhanced auth and rate limit handler
export async function handleAuthAndRateLimit(
  request: Request,
  type: keyof typeof RATE_LIMITS = 'default'
): Promise<{
  user: any;
  success: boolean;
  error?: Response;
}> {
  try {
    const { currentUser } = await import("@clerk/nextjs");
    const user = await currentUser();

    if (!user?.id) {
      return {
        user: null,
        success: false,
        error: new Response("Unauthorized", { status: 401 }),
      };
    }

    // Apply specific rate limit based on action type
    const rateLimitResult = await rateLimit(user.id, type);

    if (!rateLimitResult.success) {
      return {
        user,
        success: false,
        error: new Response("Too Many Requests", {
          status: 429,
          headers: {
            'X-RateLimit-Limit': rateLimitResult.limit.toString(),
            'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
            'X-RateLimit-Reset': rateLimitResult.reset.toISOString(),
            'Retry-After': '60',
          }
        }),
      };
    }

    return { user, success: true };
  } catch (error: any) {
    console.error("Authentication or Rate Limit Check Failed:", error);
    return {
      user: null,
      success: false,
      error: new Response(`Authentication error: ${error.message}`, { status: 500 }),
    };
  }
}
