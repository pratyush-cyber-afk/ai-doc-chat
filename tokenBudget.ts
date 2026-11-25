import type { Request, Response, NextFunction } from "express";
import { pool } from "./db/client";

export const DAILY_TOKEN_BUDGET = 50_000;

export const usageKey = (req: Request, res: Response) =>
  res.locals.session?.user.id
    ? `user:${res.locals.session.user.id}`
    : `ip:${req.ip ?? "unknown"}`;

const getUsedToday = async (key: string): Promise<number> => {
  const { rows } = await pool.query<{ tokens: string }>(
    `SELECT tokens FROM usage WHERE usage_key = $1 AND day = current_date`,
    [key],
  );
  return rows[0] ? Number(rows[0].tokens) : 0;
};

export const recordUsage = async (key: string, tokens: number) => {
  await pool.query(
    `INSERT INTO usage (usage_key, day, tokens)
     VALUES ($1, current_date, $2)
     ON CONFLICT (usage_key, day)
     DO UPDATE SET tokens = usage.tokens + EXCLUDED.tokens`,
    [key, tokens],
  );
};

export const tokenBudget = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const key = usageKey(req, res);
  try {
    if ((await getUsedToday(key)) >= DAILY_TOKEN_BUDGET) {
      return res.status(429).json({
        error: "Daily usage limit reached. Please try again tomorrow.",
      });
    }
  } catch (err) {
    console.error("Token budget check failed:", err);
  }
  next();
};
