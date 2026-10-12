/** Whether a failed query carries Postgres SQLSTATE `code`, on the error itself or (drizzle-wrapped) on its `cause`. */
function hasPgCode(err: unknown, code: string): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === code || e?.cause?.code === code;
}

export const isUniqueViolation = (err: unknown) => hasPgCode(err, "23505");

export const isForeignKeyViolation = (err: unknown) => hasPgCode(err, "23503");
