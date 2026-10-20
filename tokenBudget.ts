import type { Request, Response, NextFunction } from "express";

export const DAILY_TOKEN_BUDGET = 50_000;

type Usage = { day: string; tokens: number };
const usageByIp = new Map<string, Usage>();

const today = () => new Date().toISOString().slice(0, 10);

const getUsedToday = (ip: string): number => {
  const entry = usageByIp.get(ip);
  return entry && entry.day === today() ? entry.tokens : 0;
};

export const recordUsage = (ip: string, tokens: number) => {
  const day = today();
  const entry = usageByIp.get(ip);
  const current = entry && entry.day === day ? entry.tokens : 0;
  usageByIp.set(ip, { day, tokens: current + tokens });
};

export const tokenBudget = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const ip = req.ip ?? "unknown";
  if (getUsedToday(ip) >= DAILY_TOKEN_BUDGET) {
    return res
      .status(429)
      .json({ error: "Daily usage limit reached. Please try again tomorrow." });
  }
  next();
};
