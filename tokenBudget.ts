import type { Request, Response, NextFunction } from "express";

export const DAILY_TOKEN_BUDGET = 50_000;

type Usage = { day: string; tokens: number };
const usageByKey = new Map<string, Usage>();

const today = () => new Date().toISOString().slice(0, 10);

const getUsedToday = (key: string): number => {
  const entry = usageByKey.get(key);
  return entry && entry.day === today() ? entry.tokens : 0;
};

export const recordUsage = (key: string, tokens: number) => {
  const day = today();
  const entry = usageByKey.get(key);
  const current = entry && entry.day === day ? entry.tokens : 0;
  usageByKey.set(key, { day, tokens: current + tokens });
};

export const usageKey = (req: Request, res: Response) =>
  res.locals.session?.user.id
    ? `user:${res.locals.session.user.id}`
    : `ip:${req.ip ?? "unknown"}`;

export const tokenBudget = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const key = usageKey(req, res);
  if (getUsedToday(key) >= DAILY_TOKEN_BUDGET) {
    return res
      .status(429)
      .json({ error: "Daily usage limit reached. Please try again tomorrow." });
  }
  next();
};
