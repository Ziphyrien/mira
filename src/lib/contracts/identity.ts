import { z } from "zod";

export const KeyInput = z.object({ key: z.string().min(16).max(64) });
export const LoginInput = z.object({ token: z.string().min(1).max(200) });
