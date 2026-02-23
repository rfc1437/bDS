import { z } from 'zod';

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

export const macroContextV1Schema = z
  .object({
    env: z
      .object({
        isPreview: z.boolean(),
        mainLanguage: z.string().min(1).optional(),
        hook: z.string().min(1).optional(),
        source: z
          .object({
            kind: z.string().min(1),
            id: z.string().min(1).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    params: z.record(z.string(), jsonValueSchema).optional(),
    data: z.record(z.string(), jsonValueSchema).optional(),
  })
  .strict();

export const macroResultV1Schema = z
  .object({
    html: z.string(),
    data: z.record(z.string(), jsonValueSchema).optional(),
    warnings: z.array(z.string()).optional(),
  })
  .strict();

export type MacroContextV1 = z.infer<typeof macroContextV1Schema>;
export type MacroResultV1 = z.infer<typeof macroResultV1Schema>;

export function parseMacroContextV1(value: unknown): MacroContextV1 {
  const parsed = macroContextV1Schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid macro context: ${parsed.error.issues[0]?.message ?? 'schema validation failed'}`);
  }
  return parsed.data;
}

export function parseMacroResultV1(value: unknown): MacroResultV1 {
  const parsed = macroResultV1Schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid macro result: ${parsed.error.issues[0]?.message ?? 'schema validation failed'}`);
  }
  return parsed.data;
}
