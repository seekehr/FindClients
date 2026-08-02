import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import type { AuthedRequestUser } from '../types';

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, 10);

export const verifyPassword = (plain: string, hash: string): Promise<boolean> =>
  bcrypt.compare(plain, hash);

export function signToken(user: AuthedRequestUser): string {
  return jwt.sign(user, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] });
}

export function verifyToken(token: string): AuthedRequestUser {
  const payload = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload & AuthedRequestUser;
  return { id: payload.id, email: payload.email, plan: payload.plan };
}
