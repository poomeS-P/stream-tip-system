import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3300),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3300"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  
  // Security Tokens (Must be separate as requested)
  ADMIN_TOKEN: z.string().min(16, "ADMIN_TOKEN should be at least 16 characters for security"),
  OVERLAY_TOKEN: z.string().min(16, "OVERLAY_TOKEN should be at least 16 characters for security"),
  
  // Stripe Sandbox
  STRIPE_SECRET_KEY: z.string().min(1, "STRIPE_SECRET_KEY is required"),
  STRIPE_WEBHOOK_SECRET: z.string().min(1, "STRIPE_WEBHOOK_SECRET is required"),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  
  DEFAULT_CURRENCY: z.string().default("THB"),
});

export const env = envSchema.parse({
  PORT: process.env.PORT,
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  DATABASE_URL: process.env.DATABASE_URL,
  ADMIN_TOKEN: process.env.ADMIN_TOKEN,
  OVERLAY_TOKEN: process.env.OVERLAY_TOKEN,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  DEFAULT_CURRENCY: process.env.DEFAULT_CURRENCY,
});
